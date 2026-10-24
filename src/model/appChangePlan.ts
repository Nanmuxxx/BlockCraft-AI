import type { AppCommand, BlockSpec, CommandRequest, FieldSpec, ProjectState } from './appSpec'
import type { AppRuntime, RuntimeResult } from './appRuntime'
import type { WriteAuthorization } from '../integrations/custom-block-bc/owner'
import { createCommandSession, processCommand } from './appCommands'
import { AppSpecError, assertCommandRequest, assertProjectState, ensure } from './appSpecValidation'
import type { CustomProject } from '../custom-block/types'
import { CustomBlockError } from '../custom-block/json'
import { projectBuiltinChange } from './appProjectCommands'
import { getAppCapability, getBlockCapabilityId } from './appCapabilities'

export const AI_CHANGE_COMMANDS = Object.freeze(['addField', 'configureBlockFields', 'configureBlockPresentation', 'configureGallery', 'addBlock', 'removeBlock', 'configureMetric', 'reorderBlocks'] as const)
export type AiChangeCommand = Extract<AppCommand, { type: typeof AI_CHANGE_COMMANDS[number] }>
export type AiChangeRequest = Omit<CommandRequest, 'commands'> & { commands: AiChangeCommand[] }
/** Bounded recursion also supports the recursive JSON object schemas in custom snapshots. */
export type DeepReadonly<T, Depth extends unknown[] = []> = Depth['length'] extends 12 ? T : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K], [...Depth, unknown]> } : T

/** JSON returned by a future model adapter. Capability declarations never grant permissions. */
export interface AppChangeCandidate {
  request: AiChangeRequest
  capabilityIds: string[]
}
/** Supplied ONLY by trusted host code, independently of the model response.
 * Entity permission includes schema effects on every block sharing that entity.
 * Block permission includes direct display edits/removal, not schema permission.
 */
export interface AppChangeScope {
  selectedBlockId: string | null
  allowedBlockIds: readonly string[]
  allowedEntityIds: readonly string[]
}
export interface UnsupportedOperation { capabilityId: string; reason: string }
export interface AppChangeDiff {
  presentationChanges: { blockId: string; before: BlockSpec['presentation']; after: BlockSpec['presentation'] }[]
  galleryChanges: { blockId: string; before: { imageIds: string[]; layout: 'grid' }; after: { imageIds: string[]; layout: 'grid' } }[]
  metricChanges: { blockId: string; before: { aggregation: 'count' | 'sum' | 'average'; fieldId?: string }; after: { aggregation: 'count' | 'sum' | 'average'; fieldId?: string } }[]
  orderChanges: { before: CustomProject['renderOrder']; after: CustomProject['renderOrder'] } | null
  addedBlocks: BlockSpec[]
  removedBlocks: BlockSpec[]
  addedFields: { entityId: string; field: FieldSpec }[]
  blockFieldChanges: { blockId: string; before: string[]; after: string[] }[]
  affectedEntityIds: string[]
  affectedBlockIds: string[]
  sharedEntityImpacts: {
    entityId: string
    addedFieldIds: string[]
    boundBlockIds: string[]
    outsideDirectScopeBlockIds: string[]
    retainedRecordCount: number
  }[]
  recordsPreserved: true
}
/** A display projection and an opaque confirmation handle, valid only in its owning planner.
 * Reconstructing/deserializing this object does NOT produce a confirmable plan.
 */
export interface AppChangePlan {
  version: 1
  appId: string
  request: DeepReadonly<AiChangeRequest>
  capabilityIds: readonly string[]
  scope: DeepReadonly<AppChangeScope>
  before: DeepReadonly<ProjectState>
  after: DeepReadonly<ProjectState>
  beforeProject: DeepReadonly<CustomProject>
  afterProject: DeepReadonly<CustomProject>
  diff: DeepReadonly<AppChangeDiff>
  unsupportedOperations: readonly UnsupportedOperation[]
}
export type PlanStatus = 'pending' | 'confirming' | 'committed' | 'cancelled' | 'stale' | 'rejected'
type Failure = { ok: false; error: { code: string; message: string } }
export type PreviewResult = { ok: true; plan: DeepReadonly<AppChangePlan> } | (Failure & { unsupportedOperations: readonly UnsupportedOperation[] })
export interface AppChangePlanner {
  preview: (candidate: unknown, trustedScope: AppChangeScope) => PreviewResult
  confirm: (plan: DeepReadonly<AppChangePlan>) => RuntimeResult
  cancel: (plan: DeepReadonly<AppChangePlan>) => { ok: true } | Failure
  getStatus: (plan: DeepReadonly<AppChangePlan>) => PlanStatus | 'unknown'
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function fail(error: unknown): Failure {
  if (!(error instanceof AppSpecError) && !(error instanceof CustomBlockError)) throw error
  return { ok: false, error: { code: error.code, message: error.message } }
}
/** Read data descriptors only. Reject executable values, accessors, cycles and oversized input
 * before calling the common JSON protocol validator. Strings are opaque text, never evaluated;
 * consumers must render them as text or controlled values, never as HTML or executable code.
 */
function copyJson(input: unknown): unknown {
  const ancestors = new Set<object>()
  let nodes = 0
  function visit(value: unknown, depth: number): unknown {
    ensure(++nodes <= 10000 && depth <= 32, 'Plan input exceeds limits', 'UNSAFE_INPUT')
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'number') { ensure(Number.isFinite(value), 'Non-JSON number', 'UNSAFE_INPUT'); return value }
    if (typeof value === 'string') {
      ensure(value.length <= 4000, 'Plan string exceeds length limit', 'UNSAFE_INPUT')
      return value
    }
    ensure(value && typeof value === 'object', 'Only JSON data is allowed', 'UNSAFE_INPUT')
    ensure(!ancestors.has(value), 'Cyclic input', 'UNSAFE_INPUT')
    const array = Array.isArray(value)
    ensure(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype) || (!array && Object.getPrototypeOf(value) === null), 'Only plain JSON containers are allowed', 'UNSAFE_INPUT')
    ancestors.add(value)
    const entries: [string, unknown][] = []
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue
      ensure(typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key), 'Unsafe property', 'UNSAFE_INPUT')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      ensure(descriptor.enumerable && 'value' in descriptor, 'Accessors and hidden properties are forbidden', 'UNSAFE_INPUT')
      entries.push([key, visit(descriptor.value, depth + 1)])
    }
    ancestors.delete(value)
    if (array) {
      ensure(entries.length === value.length && entries.every(([key], i) => key === String(i)), 'Only dense JSON arrays are allowed', 'UNSAFE_INPUT')
      return entries.map(([, item]) => item)
    }
    return Object.fromEntries(entries)
  }
  return visit(input, 0)
}
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object')
  ensure(Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)), `Expected only: ${keys.join(', ')}`)
}
function stringIds(value: unknown): asserts value is string[] {
  ensure(Array.isArray(value) && value.every(id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(id) && !['constructor', 'prototype'].includes(id)), 'Invalid ID list')
  ensure(new Set(value).size === value.length, 'Duplicate ID')
}
/** Resolve by stable ID, never display name or the first matching binding. */
export function resolveBlockEntityId(state: ProjectState, blockId: string): string {
  ensure(state.spec.blocks.some(block => block.id === blockId), `Unknown block: ${blockId}`, 'UNKNOWN_TARGET')
  ensure(!['gallery', 'pomodoro'].includes(state.spec.blocks.find(block => block.id === blockId)!.type), `Block has no entity binding: ${blockId}`, 'INVALID_BINDING')
  const bindings = state.spec.relations.filter(binding => binding.blockId === blockId)
  ensure(bindings.length === 1 && state.spec.entities.some(entity => entity.id === bindings[0].entityId), `Block requires one valid entity binding: ${blockId}`, 'INVALID_BINDING')
  return bindings[0].entityId
}
function validateScope(state: ProjectState, input: AppChangeScope): AppChangeScope {
  const scope = copyJson(input)
  object(scope, ['selectedBlockId', 'allowedBlockIds', 'allowedEntityIds'])
  stringIds(scope.allowedBlockIds); stringIds(scope.allowedEntityIds)
  ensure(scope.selectedBlockId === null || typeof scope.selectedBlockId === 'string', 'Invalid selected block')
  scope.allowedBlockIds.forEach(id => {
    const block = state.spec.blocks.find(block => block.id === id)
    ensure(block, `Unknown scope block: ${id}`, 'UNKNOWN_TARGET')
    if (block.type !== 'gallery' && block.type !== 'pomodoro') resolveBlockEntityId(state, id)
  })
  ensure(scope.allowedEntityIds.every(id => state.spec.entities.some(entity => entity.id === id)), 'Unknown scope entity', 'UNKNOWN_TARGET')
  if (scope.selectedBlockId !== null) {
    ensure(scope.allowedBlockIds.includes(scope.selectedBlockId), 'Selected block is outside scope', 'SCOPE_VIOLATION')
    const selected = state.spec.blocks.find(block => block.id === scope.selectedBlockId)!
    if (selected.type !== 'gallery' && selected.type !== 'pomodoro') ensure(scope.allowedEntityIds.includes(resolveBlockEntityId(state, scope.selectedBlockId)), 'Selected entity is outside scope', 'SCOPE_VIOLATION')
  }
  return scope as unknown as AppChangeScope
}
function validateTargets(state: ProjectState, request: AiChangeRequest, scope: AppChangeScope, project: CustomProject) {
  const existingIds = new Set([state.spec.id, ...state.spec.entities.flatMap(entity => [entity.id, ...entity.fields.map(field => field.id)]), ...state.spec.blocks.map(block => block.id), ...state.spec.relations.map(binding => binding.id), ...project.custom.instances.map(instance => instance.id)])
  const removed = new Set<string>(), added = new Map<string, Extract<AiChangeCommand, { type: 'addBlock' }>>()
  let order = project.renderOrder.filter(item => item.kind === 'builtin').map(item => item.id)
  function reserve(id: string) {
    ensure(!existingIds.has(id), `ID already used in snapshot or batch: ${id}`, 'INVALID_TARGET')
    existingIds.add(id)
  }
  for (const command of request.commands) {
    let entityId: string | null
    if (command.type === 'reorderBlocks') {
      ensure(command.blockIds.length === order.length && command.blockIds.every(id => order.includes(id)), 'Order must contain every builtin block exactly once', 'INVALID_ORDER')
      // Direct block authority permits moving these blocks only; passive siblings
      // retain their relative reading order, even though the payload is complete.
      const fixed = (ids: readonly string[]) => ids.filter(id => !scope.allowedBlockIds.includes(id) && !added.has(id))
      ensure(JSON.stringify(fixed(order)) === JSON.stringify(fixed(command.blockIds)), 'Order changes blocks outside direct scope', 'SCOPE_VIOLATION')
      order = [...command.blockIds]
      continue
    }
    if (command.type === 'addField') {
      entityId = command.entityId
      reserve(command.field.id)
    } else if (command.type === 'addBlock') {
      ensure(!['filter', 'chart', 'details'].includes(command.block.type), 'Interactive view AI edits are not enabled; use the properties panel', 'AI_COMMAND_FORBIDDEN')
      ensure(command.block.type !== 'pomodoro', 'Pomodoro AI edits are not enabled', 'AI_COMMAND_FORBIDDEN')
      if (command.block.type === 'gallery') {
        ensure(!('binding' in command), 'Gallery blocks cannot bind entities', 'INVALID_BINDING')
        entityId = null
        ensure(command.block.imageIds.every(id => Object.prototype.hasOwnProperty.call(state.assets ?? {}, id)), 'Gallery references an unknown project asset', 'UNKNOWN_TARGET')
      } else {
        const binding = 'binding' in command ? command.binding : undefined
        ensure(binding, 'Data block requires an entity binding', 'INVALID_BINDING')
        entityId = binding.entityId
        ensure(binding.blockId === command.block.id, 'Binding must target added block', 'INVALID_BINDING')
        reserve(binding.id)
      }
      reserve(command.block.id)
      added.set(command.block.id, command); order.push(command.block.id)
    } else {
      ensure(scope.allowedBlockIds.includes(command.blockId) || added.has(command.blockId), `Block outside direct scope: ${command.blockId}`, 'SCOPE_VIOLATION')
      ensure(!removed.has(command.blockId), 'Cannot target a removed block', 'INVALID_TARGET')
      const addedCommand = added.get(command.blockId)
      const target = state.spec.blocks.find(block => block.id === command.blockId) ?? addedCommand?.block
      ensure(target, `Unknown block: ${command.blockId}`, 'UNKNOWN_TARGET')
      ensure(!['filter', 'chart', 'details'].includes(target.type), 'Interactive view AI edits are not enabled; use the properties panel', 'AI_COMMAND_FORBIDDEN')
      ensure(target.type !== 'pomodoro', 'Pomodoro AI edits are not enabled', 'AI_COMMAND_FORBIDDEN')
      entityId = target.type === 'gallery' ? null : addedCommand && 'binding' in addedCommand ? addedCommand.binding.entityId : resolveBlockEntityId(state, command.blockId)
      if (command.type === 'configureGallery') {
        ensure(target.type === 'gallery', 'Gallery configuration requires a gallery block', 'INVALID_TARGET')
        ensure(command.imageIds.every(id => Object.prototype.hasOwnProperty.call(state.assets ?? {}, id)), 'Gallery references an unknown project asset', 'UNKNOWN_TARGET')
      }
      if (command.type === 'removeBlock') { ensure(!added.has(command.blockId), 'Cannot add and remove the same block in one plan', 'INVALID_TARGET'); removed.add(command.blockId); order = order.filter(id => id !== command.blockId) }
    }
    if (entityId !== null) {
      ensure(scope.allowedEntityIds.includes(entityId), `Entity outside scope: ${entityId}`, 'SCOPE_VIOLATION')
      ensure(state.spec.entities.some(entity => entity.id === entityId), 'New entities are not supported', 'UNKNOWN_TARGET')
    }
  }
}
function diff(before: ProjectState, after: ProjectState, request: AiChangeRequest, scope: AppChangeScope, beforeProject: CustomProject, afterProject: CustomProject): AppChangeDiff {
  const addedBlocks = after.spec.blocks.filter(block => !before.spec.blocks.some(old => old.id === block.id))
  const removedBlocks = before.spec.blocks.filter(block => !after.spec.blocks.some(next => next.id === block.id))
  const addedFields = after.spec.entities.flatMap(entity => entity.fields.filter(field => !before.spec.entities.find(old => old.id === entity.id)!.fields.some(old => old.id === field.id)).map(field => ({ entityId: entity.id, field })))
  const blockFieldChanges = after.spec.blocks.flatMap(block => {
    const old = before.spec.blocks.find(old => old.id === block.id)
    return old && (old.type === 'form' || old.type === 'list') && (block.type === 'form' || block.type === 'list') && JSON.stringify(old.fieldIds) !== JSON.stringify(block.fieldIds)
      ? [{ blockId: block.id, before: old.fieldIds, after: block.fieldIds }] : []
  })
  const affectedEntityIds = new Set<string>()
  const affectedBlockIds = new Set<string>()
  for (const command of request.commands) {
    if (command.type === 'reorderBlocks') {
      const beforeIds = beforeProject.renderOrder.map(item => item.id), afterIds = afterProject.renderOrder.map(item => item.id)
      afterIds.forEach((id, index) => { if (id !== beforeIds[index]) affectedBlockIds.add(id) })
    }
    else if (command.type === 'addField') affectedEntityIds.add(command.entityId)
    else if (command.type === 'addBlock') {
      if ('binding' in command && command.binding) affectedEntityIds.add(command.binding.entityId)
      affectedBlockIds.add(command.block.id)
    }
    else {
      const target = before.spec.blocks.find(block => block.id === command.blockId)
      if (target && target.type !== 'gallery' && target.type !== 'pomodoro') affectedEntityIds.add(resolveBlockEntityId(before, command.blockId))
      affectedBlockIds.add(command.blockId)
    }
  }
  const sharedEntityImpacts = [...new Set(addedFields.map(item => item.entityId))].map(entityId => {
    const boundBlockIds = [...new Set([...before.spec.relations, ...after.spec.relations].filter(binding => binding.entityId === entityId).map(binding => binding.blockId))]
    boundBlockIds.forEach(id => affectedBlockIds.add(id))
    return { entityId, addedFieldIds: addedFields.filter(item => item.entityId === entityId).map(item => item.field.id), boundBlockIds,
      outsideDirectScopeBlockIds: boundBlockIds.filter(id => !scope.allowedBlockIds.includes(id) && !addedBlocks.some(block => block.id === id)),
      retainedRecordCount: (before.records[entityId] ?? []).length }
  })
  ensure(JSON.stringify(before.records) === JSON.stringify(after.records), 'Plan must preserve all records', 'SCOPE_VIOLATION')
  const presentationChanges = after.spec.blocks.flatMap(block => {
    const old = before.spec.blocks.find(old => old.id === block.id)
    return old && JSON.stringify(old.presentation) !== JSON.stringify(block.presentation) ? [{ blockId: block.id, before: old.presentation, after: block.presentation }] : []
  })
  const galleryChanges = after.spec.blocks.flatMap(block => {
    const old = before.spec.blocks.find(old => old.id === block.id)
    return old?.type === 'gallery' && block.type === 'gallery'
      && (JSON.stringify(old.imageIds) !== JSON.stringify(block.imageIds) || old.layout !== block.layout)
      ? [{ blockId: block.id, before: { imageIds: old.imageIds, layout: old.layout }, after: { imageIds: block.imageIds, layout: block.layout } }] : []
  })
  const metricConfig = (block: Extract<BlockSpec, { type: 'metric' }>) => block.aggregation === 'count' ? { aggregation: block.aggregation } : { aggregation: block.aggregation, fieldId: block.fieldId }
  const metricChanges = after.spec.blocks.flatMap(block => {
    const old = before.spec.blocks.find(old => old.id === block.id)
    return old?.type === 'metric' && block.type === 'metric' && JSON.stringify(metricConfig(old)) !== JSON.stringify(metricConfig(block)) ? [{ blockId: block.id, before: metricConfig(old), after: metricConfig(block) }] : []
  })
  const orderChanges = JSON.stringify(beforeProject.renderOrder) === JSON.stringify(afterProject.renderOrder) ? null : { before: beforeProject.renderOrder, after: afterProject.renderOrder }
  return { presentationChanges, galleryChanges, metricChanges, orderChanges, addedBlocks, removedBlocks, addedFields, blockFieldChanges, affectedEntityIds: [...affectedEntityIds], affectedBlockIds: [...affectedBlockIds], sharedEntityImpacts, recordsPreserved: true }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

/** One planner per Runtime instance. No network, no UI, no mutation until confirm(). */
export function createAppChangePlanner(runtime: AppRuntime): AppChangePlanner {
  type Entry = { plan: DeepReadonly<AppChangePlan>; status: PlanStatus; fingerprint: string; authorization?: WriteAuthorization; receipt?: Extract<RuntimeResult, { ok: true }> }
  const plans = new WeakMap<object, Entry>()
  const requests = new Map<string, Entry>()
  const entryFor = (plan: DeepReadonly<AppChangePlan>) => {
    const entry = plans.get(plan)
    ensure(entry, 'Plan does not belong to this planner / Runtime instance', 'PLAN_NOT_OWNED')
    return entry
  }
  return {
    preview(input, trustedScope) {
      const unsupportedOperations: UnsupportedOperation[] = []
      try {
        const candidate = copyJson(input)
        object(candidate, ['request', 'capabilityIds'])
        stringIds(candidate.capabilityIds)
        for (const id of candidate.capabilityIds) {
          const capability = getAppCapability(id)
          if (!capability || capability.status === 'unsupported') unsupportedOperations.push({ capabilityId: id, reason: capability?.reason ?? 'Unknown capability; not executable.' })
        }
        ensure(unsupportedOperations.length === 0, 'Requested capability is not supported', 'UNSUPPORTED_CAPABILITY')
        assertCommandRequest(candidate.request)
        ensure(candidate.request.commands.length <= 100, 'Too many commands')
        ensure(candidate.request.commands.every(command => (AI_CHANGE_COMMANDS as readonly string[]).includes(command.type)), 'AI command is not allowlisted', 'AI_COMMAND_FORBIDDEN')
        const request = candidate.request as AiChangeRequest
        // Every added block must declare an implemented primitive or supported semantic recipe.
        const declaredPrimitives = new Set(candidate.capabilityIds.flatMap(id => {
          const capability = getAppCapability(id)!
          return capability.kind === 'primitive' ? [capability.id] : capability.status === 'supported' ? capability.primitives : []
        }))
        for (const command of request.commands) if (command.type === 'addBlock') {
          ensure(declaredPrimitives.has(getBlockCapabilityId(command.block)), 'Added block requires a matching supported capability declaration', 'UNSUPPORTED_CAPABILITY')
        }
        const snapshot = runtime.getSnapshot()
        assertProjectState(snapshot)
        ensure(request.baseRevision === snapshot.revision, 'Stale baseRevision; generate a new preview', 'REVISION_CONFLICT')
        const scope = validateScope(snapshot, trustedScope)
        const beforeProject = runtime.customProject.getSnapshot()
        validateTargets(snapshot, request, scope, beforeProject)
        const fingerprint = canonical({ candidate, scope })
        const previous = requests.get(request.requestId)
        if (previous) {
          ensure(previous.fingerprint === fingerprint, 'requestId already reserved for a different plan or scope', 'REQUEST_ID_CONFLICT')
          ensure(previous.status === 'pending', `Plan is ${previous.status}; use a new requestId`, 'PLAN_NOT_PENDING')
          return { ok: true, plan: previous.plan }
        }
        const result = processCommand(createCommandSession(snapshot), request)
        if (!result.ok) return { ok: false, error: result.error, unsupportedOperations }
        const before = structuredClone(snapshot)
        const afterProject = projectBuiltinChange(beforeProject, result.session.state, request.commands)
        const plan = freeze({ version: 1 as const, appId: snapshot.spec.id, request, capabilityIds: candidate.capabilityIds, scope,
          before, after: result.session.state, beforeProject: structuredClone(beforeProject), afterProject, diff: diff(before, result.session.state, request, scope, beforeProject, afterProject), unsupportedOperations })
        const entry: Entry = { plan, status: 'pending', fingerprint, authorization: runtime.customProject?.getAuthorization() }
        plans.set(plan, entry); requests.set(request.requestId, entry)
        return { ok: true, plan }
      } catch (error) { return { ...fail(error), unsupportedOperations } }
    },
    confirm(plan) {
      try {
        const entry = entryFor(plan)
        if (entry.status === 'committed') return { ...entry.receipt!, duplicate: true }
        ensure(entry.status === 'pending', `Plan is ${entry.status}`, 'PLAN_NOT_PENDING')
        const snapshot = runtime.getSnapshot()
        if (snapshot.revision !== entry.plan.request.baseRevision || snapshot.spec.id !== entry.plan.appId || canonical(runtime.customProject.getSnapshot()) !== canonical(entry.plan.beforeProject)) {
          entry.status = 'stale'
          return { ok: false, error: { code: 'REVISION_CONFLICT', message: 'Runtime changed after preview; a new plan and confirmation are required.' } }
        }
        entry.status = 'confirming'
        // Exact frozen object from preview. Never refresh the revision or regenerate commands.
        const result = runtime.executeCommand(entry.plan.request, entry.authorization)
        entry.status = result.ok ? 'committed' : 'rejected'
        if (result.ok) entry.receipt = result
        return result
      } catch (error) { return fail(error) }
    },
    cancel(plan) {
      try {
        const entry = entryFor(plan)
        if (entry.status === 'cancelled') return { ok: true }
        ensure(entry.status === 'pending', `Plan is ${entry.status}`, 'PLAN_NOT_PENDING')
        entry.status = 'cancelled'
        return { ok: true }
      } catch (error) { return fail(error) }
    },
    getStatus: plan => plans.get(plan)?.status ?? 'unknown',
  }
}
