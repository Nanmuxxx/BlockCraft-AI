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
/** Trusted bridge closure; never reconstructed from model or HTTP JSON. */
export interface TrustedPlanGuard { validate(): void; expiresAt: number }
export interface HostPreview {
  planId: string
  title: string
  summary: string
  changes: Array<{ operation: string; target: string; description: string; before?: string; after?: string }>
}
export type HostPhase = 'IDLE' | 'REQUESTING' | 'PREVIEW' | 'CONFIRMING' | 'APPLIED' | 'CANCELLED' | 'STALE' | 'REQUEST_FAILED' | 'PREVIEW_REJECTED' | 'COMMIT_FAILED' | 'COMMIT_OUTCOME_UNKNOWN'
export interface HostView {
  phase: HostPhase
  requestId: string | null
  lastApplied: { requestId: string; planId: string; receipt: Extract<RuntimeResult, { ok: true }> } | null
  context: MochiHostContext
  epoch: number
  mode: 'blocks' | 'run'
  anchor: MochiAnchor | null
  preview: HostPreview | null
  busy: boolean
  ignoredSuggestionIds: string[]
  error: { code: string; message: string } | null
  receipt: RuntimeResult | null
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function projection(planId: string, plan: DeepReadonly<AppChangePlan>): HostPreview {
  const changes: HostPreview['changes'] = [
    ...plan.diff.presentationChanges.map(change => ({ operation: 'configureBlockPresentation', target: change.blockId, description: '调整展示属性', before: JSON.stringify(change.before ?? {}), after: JSON.stringify(change.after) })),
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
  type Entry = { guard?: TrustedPlanGuard; plan: DeepReadonly<AppChangePlan>; epoch: number; authorization: ReturnType<AppRuntime['customProject']['getAuthorization']>; authorizationKey: string; status: 'pending' | 'confirming' | 'committed' | 'cancelled' | 'rejected' | 'unknown' }
  const entries = new Map<string, Entry>()
  let selectedBlockId: string | null = null
  let authorizationKey = '' // Invalidation identity only; never a source of authority.
  let mode: HostView['mode'] = 'blocks'
  let epoch = 0
  let sequence = 0
  let activeId: string | null = null
  let pending: { requestId: string; epoch: number; controller: AbortController } | null = null
  let committing: Entry | null = null
  let disposed = false
  let observedRevision = runtime.getSnapshot().revision
  let observedAuthorization = runtime.customProject?.getAuthorization()
  let view: HostView

  const customInstances = () => runtime.customProject?.getSnapshot().custom.instances ?? []
  const exists = (id: string | null) => runtime.getSnapshot().spec.blocks.some(block => block.id === id) || customInstances().some(instance => instance.id === id)
  function context(): MochiHostContext {
    const { spec, revision } = runtime.getSnapshot()
    return { appId: spec.id, instanceId, revision, selectedBlockId,
      blocks: [...spec.blocks.map(block => ({ id: block.id, name: block.name, type: block.type, ...('fieldIds' in block ? { fieldIds: [...block.fieldIds] } : {}) })), ...customInstances().map(instance => ({ id: instance.id, name: '自定义积木', type: 'custom' }))],
      relations: spec.relations.map(({ blockId, entityId }) => ({ blockId, entityId })),
      entities: spec.entities.map(entity => ({ id: entity.id, name: entity.name, fields: entity.fields.map(({ id, name, type }) => ({ id, name, type })) })),
    }
  }
  function publish(patch: Partial<HostView> = {}) {
    if (disposed) return
    const next = { ...view, ...patch, context: context(), mode, epoch }
    view = freeze({ ...next, busy: next.phase === 'REQUESTING' || next.phase === 'CONFIRMING' })
    // UI observers must not turn a successful Runtime commit into an exception.
    for (const listener of [...listeners]) {
      if (disposed) break
      try { listener() } catch { /* An observer has no authority over the transaction. */ }
    }
  }
  function alive() { ensure(!disposed, 'Mochi host has been disposed', 'HOST_DISPOSED') }
  // Detach ownership before abort: abort handlers may synchronously reenter the host.
  function detach() {
    epoch++
    const controller = pending?.controller
    pending = null
    if (activeId) {
      const entry = entries.get(activeId)!
      if (entry.status === 'pending') { planner.cancel(entry.plan); entry.status = 'cancelled' }
    }
    activeId = null
    return controller
  }
  function invalidate(error: HostView['error'] = null) {
    const controller = detach()
    publish({ phase: view.requestId ? 'STALE' : 'IDLE', anchor: null, preview: null, receipt: null, error })
    controller?.abort()
  }
  function failure(error: unknown, fallback: string, message: string) {
    return error instanceof AppSpecError ? error : new AppSpecError(fallback, message)
  }
  function entryFor(planId: string) {
    alive()
    const entry = entries.get(planId)
    ensure(entry, 'Unknown or foreign planId', 'PLAN_NOT_OWNED')
    return entry
  }
  function sameContext(entry: Entry) {
    const snapshot = runtime.getSnapshot()
    return entry.epoch === epoch && entry.authorizationKey === authorizationKey && entry.authorization === runtime.customProject.getAuthorization() && entry.plan.scope.selectedBlockId === selectedBlockId && entry.plan.appId === snapshot.spec.id && entry.plan.request.baseRevision === snapshot.revision
  }
  function current(entry: Entry, planId: string) {
    ensure(entry.status === 'pending' && activeId === planId, 'Plan is no longer pending', 'PLAN_NOT_PENDING')
    if (!sameContext(entry)) {
      const problem = new AppSpecError('CONTEXT_CHANGED', 'Context changed; request a new preview')
      // Runtime observers may throw before this Host receives a revision. Retire
      // the owned handle before notifying UI; a listener may start a newer request.
      invalidate({ code: problem.code, message: problem.message })
      throw problem
    }
  }

  view = freeze({ context: context(), epoch, mode, phase: 'IDLE', requestId: null, lastApplied: null, anchor: null, preview: null, busy: false, ignoredSuggestionIds: [], error: null, receipt: null })
  const unsubscribe = runtime.subscribe(() => {
    const snapshot = runtime.getSnapshot()
    const authorization = runtime.customProject?.getAuthorization()
    if (snapshot.revision === observedRevision && authorization === observedAuthorization) return
    observedRevision = snapshot.revision
    const authorizationChanged = authorization !== observedAuthorization
    observedAuthorization = authorization
    // Only the commit's own revision notification belongs to its receipt.
    // Authorization changes must retire the handle even while confirming.
    if (committing && !authorizationChanged) return
    if (!exists(selectedBlockId)) selectedBlockId = null
    invalidate()
  })

  const callbacks = {
    // The optional UI context is a display projection, never trusted scope.
    async onRequestPlan(prompt: string, _untrustedContext?: unknown, guard?: TrustedPlanGuard): Promise<void> {
      alive()
      const prepare = () => {
        guard?.validate()
        ensure(!committing, 'A confirmation is in progress', 'PLAN_NOT_PENDING')
        ensure(!runtime.customProject.getAuthorization().readOnly, '项目为只读，无法请求修改。', 'READ_ONLY')
        ensure(typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 4000, 'Expected a short nonempty instruction', 'INVALID_PROMPT')
        const snapshot = runtime.getSnapshot()
        ensure(selectedBlockId !== null, 'Select a block before requesting a plan', 'SELECTION_REQUIRED')
        ensure(!customInstances().some(instance => instance.id === selectedBlockId), '自定义积木请使用参数面板；修改计划尚未开放此权限。', 'CUSTOM_SCOPE_UNAVAILABLE')
        ensure(snapshot.spec.blocks.find(b => b.id === selectedBlockId)?.type !== 'pomodoro', '可信番茄钟暂不支持 AI 修改计划。', 'TIMER_SCOPE_UNAVAILABLE')
        const entityId = resolveBlockEntityId(snapshot, selectedBlockId)
        return { snapshot, scope: { selectedBlockId, allowedBlockIds: [selectedBlockId], allowedEntityIds: [entityId] } }
      }
      let prepared: ReturnType<typeof prepare>
      try { prepared = prepare() } catch (error) {
        // An invalid new input cannot take ownership from a valid in-flight plan.
        // A rejected input alongside a preview is feedback, not a new attempt:
        // preserve its handle, phase and identity while notifying the composer.
        if (!pending && !committing) {
          const problem = failure(error, 'INVALID_PROMPT', '请求无效，尚未提交。')
          publish({ ...(!activeId ? { phase: 'REQUEST_FAILED' as const, requestId: `${instanceId}-${++sequence}`, receipt: null } : {}), error: { code: problem.code, message: problem.message } })
        }
        throw error
      }
      const { snapshot, scope } = prepared
      const authorization = runtime.customProject.getAuthorization()
      const previous = detach()
      const attempt = { requestId: `${instanceId}-${++sequence}`, epoch, controller: new AbortController() }
      const requestContext = freeze(context())
      pending = attempt
      const ownsRequest = () => !disposed && pending === attempt && epoch === attempt.epoch && !attempt.controller.signal.aborted
      const requestContextIsCurrent = () => runtime.getSnapshot() === snapshot && runtime.customProject.getAuthorization() === authorization
      const checkRequestContext = () => {
        if (requestContextIsCurrent()) return
        invalidate({ code: 'CONTEXT_CHANGED', message: 'Context changed; request a new preview' })
        throw new AppSpecError('CONTEXT_CHANGED', 'Discarded plan request after an unobserved context change')
      }
      publish({ phase: 'REQUESTING', requestId: attempt.requestId, preview: null, anchor: null, error: null, receipt: null })
      previous?.abort()
      let stage: HostPhase = 'REQUEST_FAILED'
      let stopWaiting: () => void = () => {}
      try {
        ensure(ownsRequest(), 'Discarded obsolete plan request', 'CONTEXT_CHANGED')
        checkRequestContext()
        guard?.validate()
        const retired = new Promise<never>((_, reject) => {
          stopWaiting = () => reject(new AppSpecError('CONTEXT_CHANGED', 'Discarded obsolete plan request'))
          attempt.controller.signal.addEventListener('abort', stopWaiting, { once: true })
          if (attempt.controller.signal.aborted) stopWaiting()
        })
        // Attach both handlers even if the provider synchronously aborts/throws.
        // Cancellation retires this wait; late provider rejection stays consumed.
        let operation: Promise<unknown>
        try { operation = Promise.resolve(provider(Object.freeze({ prompt: prompt.trim(), requestId: attempt.requestId, context: requestContext, snapshot: freeze(structuredClone(snapshot)), signal: attempt.controller.signal }))) }
        catch (error) { operation = Promise.reject(error) }
        const input = await Promise.race([retired, operation])
        ensure(ownsRequest(), 'Discarded obsolete plan response', 'CONTEXT_CHANGED')
        checkRequestContext()
        guard?.validate()
        stage = 'PREVIEW_REJECTED'
        const result = planner.preview(input, scope)
        if (!result.ok) throw new AppSpecError(result.error.code, result.error.message)
        if (result.plan.request.requestId !== attempt.requestId || result.plan.request.baseRevision !== snapshot.revision) {
          planner.cancel(result.plan)
          throw new AppSpecError('PLAN_BINDING_MISMATCH', 'Provider changed the host requestId or revision')
        }
        const planId = `${attempt.requestId}-plan`
        entries.set(planId, { guard, plan: result.plan, epoch, authorization, authorizationKey, status: 'pending' })
        activeId = planId
        pending = null
        publish({ phase: 'PREVIEW', preview: projection(planId, result.plan), error: null })
      } catch (error) {
        // Obsolete resolve/reject/catch never publish, including busy cleanup.
        if (!ownsRequest()) throw error
        pending = null
        const problem = failure(error, 'PLAN_PROVIDER_FAILED', '计划请求失败；尚未提交此请求。')
        publish({ phase: stage, preview: null, error: { code: problem.code, message: problem.message } })
        throw problem
      } finally { attempt.controller.signal.removeEventListener('abort', stopWaiting) }
    },
    async onConfirm(planId: string): Promise<void> {
      const entry = entryFor(planId)
      if (entry.status === 'committed') return
      current(entry, planId)
      try { entry.guard?.validate() } catch (error) {
        const problem = failure(error, 'SUGGESTION_EXPIRED', '建议已失效，请重新分析。')
        invalidate({ code: problem.code, message: problem.message })
        throw problem
      }
      ensure(!committing, 'A confirmation is in progress', 'PLAN_NOT_PENDING')
      entry.status = 'confirming'
      committing = entry
      publish({ phase: 'CONFIRMING', receipt: null, error: null })
      // A synchronous observer can change selection/authorization or dispose here.
      if (disposed || activeId !== planId || !sameContext(entry)) {
        committing = null
        planner.cancel(entry.plan)
        entry.status = 'cancelled'
        if (!disposed && activeId === planId) invalidate({ code: 'CONTEXT_CHANGED', message: 'Context changed before confirmation' })
        throw new AppSpecError('CONTEXT_CHANGED', 'Context changed before confirmation')
      }
      try { entry.guard?.validate() } catch (error) {
        committing = null
        planner.cancel(entry.plan)
        entry.status = 'cancelled'
        const problem = failure(error, 'SUGGESTION_EXPIRED', '建议已失效，请重新分析。')
        invalidate({ code: problem.code, message: problem.message })
        throw problem
      }
      const before = runtime.getSnapshot()
      let result: RuntimeResult
      try {
        result = planner.confirm(entry.plan) // Original handle, no reconstruction or await.
      } catch {
        entry.status = 'unknown'
        committing = null
        if (activeId === planId) activeId = null
        const problem = new AppSpecError('COMMIT_OUTCOME_UNKNOWN', '提交结果未确认。应用可能已改变；请核对当前状态，勿重试旧计划。')
        if (view.requestId === entry.plan.request.requestId) publish({ phase: 'COMMIT_OUTCOME_UNKNOWN', preview: null, receipt: null, error: { code: problem.code, message: problem.message } })
        throw problem
      }
      committing = null
      if (activeId === planId) activeId = null
      if (result.ok) {
        entry.status = 'committed'
        const lastApplied = { requestId: entry.plan.request.requestId, planId, receipt: result }
        if (entry.epoch === epoch) publish({ phase: 'APPLIED', preview: null, receipt: result, lastApplied, error: null })
        else publish({ lastApplied }) // A changed context receives history only.
        return
      }
      const unchanged = before === runtime.getSnapshot()
      entry.status = unchanged ? 'rejected' : 'unknown'
      const problem = unchanged ? new AppSpecError(result.error.code, result.error.message)
        : new AppSpecError('COMMIT_OUTCOME_UNKNOWN', '失败回执与应用状态不一致。请核对当前状态，勿重试旧计划。')
      if (view.requestId === entry.plan.request.requestId) publish({ phase: unchanged ? 'COMMIT_FAILED' : 'COMMIT_OUTCOME_UNKNOWN', preview: null, receipt: unchanged ? result : null, error: { code: problem.code, message: problem.message } })
      throw problem
    },
    onCancel(planId: string): void {
      const entry = entryFor(planId)
      if (entry.status === 'cancelled') return
      current(entry, planId)
      const controller = detach()
      publish({ phase: 'CANCELLED', preview: null, anchor: null, error: null, receipt: null })
      controller?.abort()
    },
    onIgnore(suggestionId: string): void {
      alive()
      if (!view.ignoredSuggestionIds.includes(suggestionId)) publish({ ignoredSuggestionIds: [...view.ignoredSuggestionIds, suggestionId] })
    },
  }
  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) { alive(); listeners.add(listener); return () => { listeners.delete(listener) } },
    callbacks,
    cancelRequest(requestId: string) {
      alive()
      if (!pending || pending.requestId !== requestId) return
      const controller = detach()
      publish({ phase: 'CANCELLED', preview: null, anchor: null, error: null, receipt: null })
      controller?.abort()
    },
    setAuthorizationContextKey(key: string) {
      alive()
      if (key === authorizationKey) return
      authorizationKey = key
      invalidate()
    },
    setSelection(blockId: string | null) {
      alive()
      if (blockId !== null && !customInstances().some(instance => instance.id === blockId) && runtime.getSnapshot().spec.blocks.find(b => b.id === blockId)?.type !== 'pomodoro') resolveBlockEntityId(runtime.getSnapshot(), blockId)
      if (blockId === selectedBlockId) return
      selectedBlockId = blockId
      invalidate()
    },
    setMode(next: HostView['mode']) {
      alive()
      ensure(next === 'blocks' || next === 'run', 'Unknown workshop mode')
      if (next === mode) return
      mode = next
      publish({ anchor: null }) // View-only changes preserve the request/plan and epoch.
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
      disposed = true
      const controller = detach()
      unsubscribe(); listeners.clear()
      view = freeze({ ...view, epoch, phase: 'CANCELLED', anchor: null, preview: null, busy: false, receipt: null })
      controller?.abort()
    },
  }
}
