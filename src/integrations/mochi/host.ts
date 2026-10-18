import { createAppChangePlanner, resolveBlockEntityId, type AppChangePlan, type DeepReadonly } from '../../model/appChangePlan'
import type { AppRuntime, RuntimeResult } from '../../model/appRuntime'
import type { ProjectState } from '../../model/appSpec'
import { AppSpecError, ensure } from '../../model/appSpecValidation'

// Structural projections for PR #17. No import from the unmerged component tree.
export interface MochiHostContext {
  appId: string
  instanceId: string
  revision: number
  selectedBlockId: string | null
  blocks: Array<{ id: string; name: string; type: string; fieldIds?: string[] }>
  relations: Array<{ blockId: string; entityId: string }>
  entities: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string }> }>
}
export interface MochiAnchor {
  // CSS pixels relative to the overlay's positioned containing block (PR #17
  // uses position:absolute). The host converts DOM viewport measurements.
  x: number; y: number; width?: number; height?: number
  placement?: 'top' | 'right' | 'bottom' | 'left' | 'corner'
  visible?: boolean
}
export interface BoundAnchor {
  instanceId: string; revision: number; selectedBlockId: string; epoch: number
  rect: MochiAnchor
}
export interface PlanRequest {
  prompt: string
  requestId: string
  context: DeepReadonly<MochiHostContext>
  snapshot: DeepReadonly<ProjectState>
  signal: AbortSignal
}
/** Returns unknown JSON for Phase A validation; never receives a Runtime or authority. */
export type PlanProvider = (request: PlanRequest) => unknown | Promise<unknown>
export interface HostPreview {
  planId: string
  title: string
  summary: string
  changes: Array<{ operation: string; target: string; description: string; before?: string; after?: string }>
}
export interface HostView {
  context: MochiHostContext
  epoch: number
  mode: 'blocks' | 'run'
  anchor: MochiAnchor | null
  preview: HostPreview | null
  busy: boolean
  ignoredSuggestionIds: string[]
  error: { code: string; message: string } | null
  receipt: Extract<RuntimeResult, { ok: true }> | null
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function projection(planId: string, plan: DeepReadonly<AppChangePlan>): HostPreview {
  const changes: HostPreview['changes'] = [
    ...plan.diff.addedFields.map(({ entityId, field }) => ({ operation: 'addField', target: entityId, description: `新增字段：${field.name}`, after: JSON.stringify(field) })),
    ...plan.diff.blockFieldChanges.map(change => ({ operation: 'configureBlockFields', target: change.blockId, description: '调整显示字段', before: change.before.join(', '), after: change.after.join(', ') })),
    ...plan.diff.addedBlocks.map(block => ({ operation: 'addBlock', target: block.id, description: `新增积木：${block.name}`, after: JSON.stringify({ block, binding: plan.after.spec.relations.find(item => item.blockId === block.id), position: plan.after.blockPositions[block.id] }) })),
    ...plan.diff.removedBlocks.map(block => ({ operation: 'removeBlock', target: block.id, description: `删除积木：${block.name}；保留实体与记录`, before: JSON.stringify({ block, binding: plan.before.spec.relations.find(item => item.blockId === block.id), position: plan.before.blockPositions[block.id] }) })),
    ...plan.diff.sharedEntityImpacts.map(impact => ({ operation: 'sharedEntityImpact', target: impact.entityId, description: `共享实体影响：${impact.boundBlockIds.join(', ')}；直接授权外：${impact.outsideDirectScopeBlockIds.join(', ') || '无'}；保留 ${impact.retainedRecordCount} 条记录` })),
  ]
  return { planId, title: '修改计划（等待确认）', summary: `版本 ${plan.request.baseRevision} → ${plan.after.revision}；业务记录保持不变`, changes }
}

/** One trusted host per application Runtime, owned ABOVE the B/C mode surfaces.
 * All public data are display projections, never confirmation/authorization handles.
 */
export function createMochiHost(runtime: AppRuntime, provider: PlanProvider) {
  const instanceId = `mochi-${globalThis.crypto.randomUUID()}`
  const planner = createAppChangePlanner(runtime)
  const listeners = new Set<() => void>()
  type Entry = { plan: DeepReadonly<AppChangePlan>; epoch: number; status: 'pending' | 'confirming' | 'committed' | 'cancelled' | 'rejected'; receipt?: Extract<RuntimeResult, { ok: true }> }
  const entries = new Map<string, Entry>()
  let selectedBlockId: string | null = null
  let mode: HostView['mode'] = 'blocks'
  let epoch = 0
  let sequence = 0
  let activeId: string | null = null
  let pending: AbortController | null = null
  let disposed = false
  let observedRevision = runtime.getSnapshot().revision
  let view: HostView

  function context(): MochiHostContext {
    const { spec, revision } = runtime.getSnapshot()
    return { appId: spec.id, instanceId, revision, selectedBlockId,
      blocks: spec.blocks.map(block => ({ id: block.id, name: block.name, type: block.type, ...('fieldIds' in block ? { fieldIds: [...block.fieldIds] } : {}) })),
      relations: spec.relations.map(({ blockId, entityId }) => ({ blockId, entityId })),
      entities: spec.entities.map(entity => ({ id: entity.id, name: entity.name, fields: entity.fields.map(({ id, name, type }) => ({ id, name, type })) })),
    }
  }
  function publish(patch: Partial<HostView> = {}) {
    view = freeze({ ...view, ...patch, context: context(), mode, epoch })
    listeners.forEach(listener => listener())
  }
  function alive() { ensure(!disposed, 'Mochi host has been disposed', 'HOST_DISPOSED') }
  function invalidate() {
    epoch++
    pending?.abort(); pending = null
    if (activeId) {
      const entry = entries.get(activeId)!
      if (entry.status === 'pending') { planner.cancel(entry.plan); entry.status = 'cancelled' }
    }
    activeId = null
  }
  function report(error: unknown): never {
    const failure = error instanceof AppSpecError ? error : new AppSpecError('PLAN_PROVIDER_FAILED', '计划请求失败；已确认的应用保持不变。')
    if (!disposed) publish({ error: { code: failure.code, message: failure.message } })
    throw failure
  }
  function entryFor(planId: string) {
    alive()
    const entry = entries.get(planId)
    ensure(entry, 'Unknown or foreign planId', 'PLAN_NOT_OWNED')
    return entry
  }
  function current(entry: Entry, planId: string) {
    ensure(entry.status === 'pending' && activeId === planId, 'Plan is no longer pending', 'PLAN_NOT_PENDING')
    const snapshot = runtime.getSnapshot()
    ensure(entry.epoch === epoch && entry.plan.scope.selectedBlockId === selectedBlockId && entry.plan.appId === snapshot.spec.id && entry.plan.request.baseRevision === snapshot.revision, 'Context changed; request a new preview', 'CONTEXT_CHANGED')
  }

  view = freeze({ context: context(), epoch, mode, anchor: null, preview: null, busy: false, ignoredSuggestionIds: [], error: null, receipt: null })
  const unsubscribe = runtime.subscribe(() => {
    const snapshot = runtime.getSnapshot()
    if (snapshot.revision === observedRevision) return
    observedRevision = snapshot.revision
    invalidate()
    if (!snapshot.spec.blocks.some(block => block.id === selectedBlockId)) selectedBlockId = null
    publish({ anchor: null, preview: null, busy: false })
  })

  const callbacks = {
    // Phase B's second argument is a chat projection. Deliberately ignore it.
    async onRequestPlan(prompt: string, _untrustedContext?: unknown): Promise<void> {
      let ownedEpoch = epoch
      try {
        alive()
        ensure(typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 4000, 'Expected a short nonempty instruction', 'INVALID_PROMPT')
        ensure(!pending, 'A plan request is already in progress', 'REQUEST_BUSY')
        const snapshot = runtime.getSnapshot()
        ensure(selectedBlockId !== null, 'Select a block before requesting a plan', 'SELECTION_REQUIRED')
        const entityId = resolveBlockEntityId(snapshot, selectedBlockId)
        const scope = { selectedBlockId, allowedBlockIds: [selectedBlockId], allowedEntityIds: [entityId] }
        invalidate()
        const requestEpoch = epoch
        ownedEpoch = requestEpoch
        const requestId = `${instanceId}-${++sequence}`
        const controller = new AbortController()
        pending = controller
        publish({ busy: true, preview: null, anchor: null, error: null })
        try {
          const input = await provider(Object.freeze({ prompt: prompt.trim(), requestId, context: freeze(context()), snapshot: freeze(structuredClone(snapshot)), signal: controller.signal }))
          ensure(!disposed && requestEpoch === epoch && !controller.signal.aborted, 'Discarded obsolete plan response', 'CONTEXT_CHANGED')
          const result = planner.preview(input, scope)
          if (!result.ok) throw new AppSpecError(result.error.code, result.error.message)
          // Phase A validates unknown JSON first; only then read its sanitized request.
          if (result.plan.request.requestId !== requestId || result.plan.request.baseRevision !== snapshot.revision) {
            planner.cancel(result.plan)
            throw new AppSpecError('PLAN_BINDING_MISMATCH', 'Provider changed the host requestId or revision')
          }
          const planId = `${requestId}-plan`
          entries.set(planId, { plan: result.plan, epoch, status: 'pending' })
          activeId = planId
          publish({ preview: projection(planId, result.plan), error: null })
        } finally {
          if (pending === controller) { pending = null; publish({ busy: false }) }
        }
      } catch (error) {
        // Obsolete responses are rejected to their caller, but never published.
        if (ownedEpoch !== epoch || disposed) throw error
        report(error)
      }
    },
    async onConfirm(planId: string): Promise<void> {
      try {
        const entry = entryFor(planId)
        if (entry.status === 'committed') return
        current(entry, planId)
        // Lock BEFORE Runtime notifications, which may synchronously reenter callbacks.
        entry.status = 'confirming'
        const result = planner.confirm(entry.plan)
        if (!result.ok) {
          entry.status = 'rejected'; activeId = null
          publish({ preview: null })
          throw new AppSpecError(result.error.code, result.error.message)
        }
        entry.status = 'committed'; entry.receipt = result; activeId = null
        publish({ preview: null, receipt: result, error: null })
      } catch (error) { report(error) }
    },
    onCancel(planId: string): void {
      try {
        const entry = entryFor(planId)
        if (entry.status === 'cancelled') return
        current(entry, planId)
        invalidate()
        publish({ preview: null, busy: false, anchor: null, error: null })
      } catch (error) { report(error) }
    },
    onIgnore(suggestionId: string): void {
      alive()
      // Ignoring a suggestion never confirms/cancels a different plan or changes Runtime.
      if (!view.ignoredSuggestionIds.includes(suggestionId)) publish({ ignoredSuggestionIds: [...view.ignoredSuggestionIds, suggestionId] })
    },
  }
  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) { alive(); listeners.add(listener); return () => { listeners.delete(listener) } },
    callbacks,
    setSelection(blockId: string | null) {
      alive()
      if (blockId !== null) resolveBlockEntityId(runtime.getSnapshot(), blockId)
      if (blockId === selectedBlockId) return
      invalidate(); selectedBlockId = blockId
      publish({ anchor: null, preview: null, busy: false, error: null })
    },
    setMode(next: HostView['mode']) {
      alive()
      ensure(next === 'blocks' || next === 'run', 'Unknown workshop mode')
      if (next === mode) return
      invalidate(); mode = next
      publish({ anchor: null, preview: null, busy: false, error: null })
    },
    setAnchor(anchor: BoundAnchor | null) {
      alive()
      if (!anchor) { publish({ anchor: null }); return }
      ensure(mode === 'blocks' && anchor.instanceId === instanceId && anchor.revision === view.context.revision && anchor.selectedBlockId === selectedBlockId && anchor.epoch === epoch, 'Stale anchor measurement', 'CONTEXT_CHANGED')
      const { x, y, width = 0, height = 0 } = anchor.rect
      ensure([x, y, width, height].every(Number.isFinite) && width >= 0 && height >= 0, 'Invalid anchor rectangle')
      publish({ anchor: { ...anchor.rect } })
    },
    dispose() {
      if (disposed) return
      invalidate(); unsubscribe(); disposed = true; listeners.clear()
      view = freeze({ ...view, anchor: null, preview: null, busy: false })
    },
  }
}
