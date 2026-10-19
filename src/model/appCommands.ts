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
      ensure(command.binding.blockId === command.block.id, 'Binding must target the added block')
      spec.blocks.push(clone(command.block)); spec.relations.push(clone(command.binding))
      if (command.position) state.blockPositions[command.block.id] = clone(command.position)
      break
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
        ensure(!spec.blocks.some(b => bound.has(b.id) && (b.type === 'metric' ? b.aggregation !== 'count' && b.fieldId === command.fieldId : b.type !== 'pomodoro' && b.fieldIds.includes(command.fieldId))), 'Field referenced by block', 'FIELD_REFERENCED')
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
