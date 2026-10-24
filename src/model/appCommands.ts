import type { AppCommand, ProjectState } from './appSpec'
import { AppSpecError, assertCommandRequest, assertProjectState, ensure } from './appSpecValidation'

export interface CommandSession {
  state: ProjectState
  history: ProjectState[]
  receipts: Record<string, { fingerprint: string; revision: number }>
}
export type CommandResult =
  | { ok: true; session: CommandSession; duplicate: boolean; committedRevision: number }
  | { ok: false; session: CommandSession; error: { code: string; message: string } }
const clone = <T>(value: T): T => structuredClone(value)
/** Canonical JSON property order: equivalent JSON objects have the same identity. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export function createCommandSession(state: ProjectState): CommandSession {
  assertProjectState(state)
  return { state: clone(state), history: [], receipts: {} }
}
function apply(state: ProjectState, command: Exclude<AppCommand, { type: 'undo' }>) {
  const { spec } = state
  switch (command.type) {
    case 'configureBlockPresentation': {
      const block = spec.blocks.find(block => block.id === command.blockId)
      ensure(block && block.type !== 'pomodoro', 'Unsupported presentation target')
      ensure(command.presentation.buttonText === undefined || block.type === 'form', 'Button text requires a form')
      block.presentation = { ...block.presentation, ...clone(command.presentation) }
      break
    }
    case 'addBlock':
      if (command.block.type === 'gallery' || command.block.type === 'pomodoro') {
        ensure(!('binding' in command) || command.binding === undefined, `${command.block.type} blocks cannot bind entities`)
      } else {
        const binding = 'binding' in command ? command.binding : undefined
        ensure(binding, 'Data block requires binding')
        ensure(binding.blockId === command.block.id, 'Binding must target the added block')
        spec.relations.push(clone(binding))
      }
      spec.blocks.push(clone(command.block))
      if (command.position) state.blockPositions[command.block.id] = clone(command.position)
      break
    case 'reorderBlocks': {
      ensure(command.blockIds.length === spec.blocks.length && new Set(command.blockIds).size === spec.blocks.length && command.blockIds.every(id => spec.blocks.some(block => block.id === id)), 'Order must contain every builtin block exactly once', 'INVALID_ORDER')
      spec.blocks = command.blockIds.map(id => spec.blocks.find(block => block.id === id)!)
      break
    }
    case 'configureMetric': {
      const block = spec.blocks.find(block => block.id === command.blockId)
      ensure(block?.type === 'metric', 'Metric configuration requires a metric block', 'INVALID_TARGET')
      if (command.aggregation !== 'count') {
        const binding = spec.relations.find(relation => relation.blockId === block.id)
        const field = spec.entities.find(entity => entity.id === binding?.entityId)?.fields.find(field => field.id === command.fieldId)
        ensure(field?.type === 'number', 'Numeric metric requires a number field from its bound entity', 'INVALID_TARGET')
      }
      const { fieldId: _previousField, ...rest } = block as typeof block & { fieldId?: string }
      spec.blocks[spec.blocks.indexOf(block)] = command.aggregation === 'count' ? { ...rest, aggregation: 'count' } : { ...rest, aggregation: command.aggregation, fieldId: command.fieldId }
      break
    }
    case 'removeBlock':
      ensure(spec.blocks.some(b => b.id === command.blockId), 'Unknown block')
      spec.blocks = spec.blocks.filter(b => b.id !== command.blockId)
      spec.relations = spec.relations.filter(r => r.blockId !== command.blockId)
      delete state.blockPositions[command.blockId]
      if (state.timers) delete state.timers[command.blockId]
      break
    case 'configureBlockFields': {
      const b = spec.blocks.find(b => b.id === command.blockId)
      ensure(b && (b.type === 'list' || b.type === 'form'), 'Display fields require list or form')
      b.fieldIds = [...command.fieldIds]
      break
    }
    case 'configureView': {
      const index = spec.blocks.findIndex(block => block.id === command.blockId)
      ensure(index >= 0 && spec.blocks[index].type === command.block.type, 'View type and ID are immutable', 'INVALID_TARGET')
      spec.blocks[index] = clone(command.block)
      break
    }
    case 'configureGallery': {
      const block = spec.blocks.find(block => block.id === command.blockId)
      ensure(block?.type === 'gallery', 'Gallery configuration requires a gallery block')
      block.imageIds = [...command.imageIds]
      if (command.layout !== undefined) block.layout = command.layout
      break
    }
    case 'addProjectAsset': {
      state.assets ??= {}
      ensure(!Object.prototype.hasOwnProperty.call(state.assets, command.asset.id), 'Asset ID already exists', 'ID_CONFLICT')
      state.assets[command.asset.id] = clone(command.asset)
      break
    }
    case 'removeProjectAsset': {
      ensure(state.assets && Object.prototype.hasOwnProperty.call(state.assets, command.assetId), 'Unknown image asset')
      ensure(!spec.blocks.some(block => block.type === 'gallery' && block.imageIds.includes(command.assetId)), 'Image asset is still used by a gallery', 'ASSET_REFERENCED')
      delete state.assets![command.assetId]
      break
    }
    case 'addField':
    case 'updateField':
    case 'removeField': {
      const e = spec.entities.find(e => e.id === command.entityId)
      ensure(e, 'Unknown entity')
      if (command.type === 'addField') { e.fields.push(clone(command.field)); break }
      const index = e.fields.findIndex(f => f.id === command.fieldId)
      ensure(index >= 0, 'Unknown field')
      if (command.type === 'updateField') {
        ensure(command.field.id === command.fieldId, 'Field ID is immutable')
        e.fields[index] = clone(command.field)
      } else {
        const bound = new Set(spec.relations.filter(r => r.entityId === e.id).map(r => r.blockId))
        ensure(!spec.blocks.some(b => bound.has(b.id) && (b.type === 'metric' ? b.aggregation !== 'count' && b.fieldId === command.fieldId : b.type === 'chart' ? b.groupFieldId === command.fieldId || b.valueFieldId === command.fieldId : (b.type === 'list' || b.type === 'form' || b.type === 'filter' || b.type === 'details') && b.fieldIds.includes(command.fieldId))), 'Field referenced by block', 'FIELD_REFERENCED')
        ensure(!(state.records[e.id] ?? []).some(row => Object.prototype.hasOwnProperty.call(row.values, command.fieldId)), 'Field contains business data', 'FIELD_REFERENCED')
        e.fields.splice(index, 1)
      }
      break
    }
  }
}
/** Pure transaction. Persist the entire returned session only on success. */
export function processCommand(session: CommandSession, input: unknown): CommandResult {
  try {
    assertCommandRequest(input)
    const fingerprint = canonical(input)
    const receipt = Object.prototype.hasOwnProperty.call(session.receipts, input.requestId) ? session.receipts[input.requestId] : undefined
    if (receipt) {
      ensure(receipt.fingerprint === fingerprint, 'requestId already used for a different payload', 'REQUEST_ID_CONFLICT')
      return { ok: true, session, duplicate: true, committedRevision: receipt.revision }
    }
    ensure(input.baseRevision === session.state.revision, 'Stale baseRevision', 'REVISION_CONFLICT')
    ensure(session.state.revision < Number.MAX_SAFE_INTEGER, 'Revision exhausted')
    const next = clone(session)
    if (input.commands[0].type === 'undo') {
      const previous = next.history.pop()
      ensure(previous, 'Nothing to undo', 'NOTHING_TO_UNDO')
      next.state = previous
    } else {
      next.history.push(clone(session.state))
      for (const command of input.commands) {
        ensure(command.type !== 'undo', 'Undo must be standalone')
        apply(next.state, command)
      }
    }
    next.state.revision = session.state.revision + 1
    assertProjectState(next.state)
    next.receipts[input.requestId] = { fingerprint, revision: next.state.revision }
    return { ok: true, session: next, duplicate: false, committedRevision: next.state.revision }
  } catch (error) {
    if (!(error instanceof AppSpecError)) throw error
    return { ok: false, session, error: { code: error.code, message: error.message } }
  }
}
