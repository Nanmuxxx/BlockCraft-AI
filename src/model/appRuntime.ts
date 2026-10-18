import type { BlockSpec, EntityRecord, FieldSpec, FieldValue, ProjectState } from './appSpec'
import { createCommandSession, processCommand, type CommandSession } from './appCommands'
import { createProjectSession, type CustomProjectSession } from './customProjectSession'
import { CustomBlockError } from '../custom-block/json'
import type { WriteAuthorization } from '../integrations/custom-block-bc/owner'
import { AppSpecError, assertProjectState, ensure } from './appSpecValidation'

export type RecordChange =
  | { type: 'create'; entityId: string; record: EntityRecord }
  | { type: 'update'; entityId: string; recordId: string; values: EntityRecord['values'] }
  | { type: 'delete'; entityId: string; recordId: string }

/** Atomic business-data transaction; failed validation leaves the original untouched. */
export function applyRecordChange(state: ProjectState, change: RecordChange): ProjectState {
  ensure(state.spec.entities.some(entity => entity.id === change.entityId), '未知实体')
  ensure(state.revision < Number.MAX_SAFE_INTEGER, '版本号已用尽')
  const next = structuredClone(state)
  const rows = next.records[change.entityId] ?? (next.records[change.entityId] = [])
  if (change.type === 'create') rows.push(structuredClone(change.record))
  else {
    const index = rows.findIndex(row => row.id === change.recordId)
    ensure(index >= 0, '记录不存在，请重新打开编辑')
    if (change.type === 'delete') rows.splice(index, 1)
    else rows[index].values = structuredClone(change.values)
  }
  next.revision++
  assertProjectState(next)
  return next
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

export type RuntimeResult =
  | { ok: true; duplicate: boolean; committedRevision: number }
  | { ok: false; error: { code: string; message: string } }

export interface AppRuntime {
  customProject: CustomProjectSession
  getSnapshot: () => ProjectState
  subscribe: (listener: () => void) => () => void
  executeCommand: (request: unknown, authorization?: WriteAuthorization) => RuntimeResult
  updateRecords: (change: RecordChange) => RuntimeResult
  moveBlock: (blockId: string, position: { x: number; y: number }) => RuntimeResult
  timerAction: (blockId: string, action: 'start' | 'pause' | 'reset') => RuntimeResult
  canUndo: () => boolean
  /** B1 compatibility: record transaction, throwing AppSpecError on rejection. */
  dispatch: (change: RecordChange) => void
}

/** One session owns state, history and receipts for both B and C. */
export function createAppRuntime(initial: ProjectState): AppRuntime {
  const initialSession = createCommandSession(initial)
  let metadata: Omit<CommandSession, 'state'> = freeze({ history: initialSession.history, receipts: initialSession.receipts })
  const project = createProjectSession(initial, () => { metadata = freeze({ ...metadata, history: [] }) })
  const session = (): CommandSession => ({ ...metadata, state: project.getBaseSnapshot() })
  const publish = (next: CommandSession, expected: ReturnType<CustomProjectSession['getSnapshot']>, authorization: WriteAuthorization) => project.commitBuiltin(next.state, () => {
    metadata = freeze({ history: next.history, receipts: next.receipts })
  }, expected, authorization)
  // Full-state command history cannot cross a later data/layout transaction.
  // Keep receipts so retries across this boundary remain idempotent.
  const mutate = (apply: (state: ProjectState) => ProjectState): RuntimeResult => {
    const expected = project.owner.getSnapshot(), authorization = project.owner.getAuthorization()
    let state: ProjectState
    try { state = apply(project.getBaseSnapshot()) }
    catch (error) {
      if (!(error instanceof AppSpecError) && !(error instanceof CustomBlockError)) throw error
      return { ok: false, error: { code: error.code, message: error.message } }
    }
    try { return publish({ ...session(), state, history: [] }, expected, authorization) }
    catch (error) {
      if (!(error instanceof CustomBlockError)) throw error
      return { ok: false, error: { code: error.code, message: error.message } }
    }
  }
  const updateRecords = (change: RecordChange) => mutate(state => applyRecordChange(state, change))
  return {
    customProject: project.owner,
    getSnapshot: project.getBaseSnapshot,
    subscribe: project.owner.subscribe,
    canUndo: () => metadata.history.length > 0,
    executeCommand(request, authorization = project.owner.getAuthorization()) {
      const expected = project.owner.getSnapshot()
      const result = processCommand(session(), request)
      if (!result.ok) return { ok: false, error: result.error }
      if (!result.duplicate) {
        try { return publish(result.session, expected, authorization) }
        catch (error) {
          if (!(error instanceof CustomBlockError)) throw error
          return { ok: false, error: { code: error.code, message: error.message } }
        }
      }
      return { ok: true, duplicate: result.duplicate, committedRevision: result.committedRevision }
    },
    updateRecords,
    timerAction(blockId, action) {
      return mutate(state => {
        const block = state.spec.blocks.find(b => b.id === blockId)
        ensure(block?.type === 'pomodoro' && state.spec.version === 2, 'Unknown timer')
        ensure(['start', 'pause', 'reset'].includes(action), 'Unknown timer action')
        const now = Date.now()
        const timer = state.timers?.[blockId] ?? { remainingMs: block.durationSeconds * 1000, startedAt: null }
        const remainingMs = timerRemaining(timer, now)
        const next = structuredClone(state)
        next.timers ??= {}
        next.timers[blockId] = action === 'reset' ? { remainingMs: block.durationSeconds * 1000, startedAt: null }
          : action === 'pause' ? { remainingMs, startedAt: null }
            : { remainingMs, startedAt: remainingMs > 0 ? now : null }
        next.revision++
        assertProjectState(next)
        return next
      })
    },
    moveBlock(blockId, position) {
      return mutate(state => {
        ensure(state.spec.blocks.some(block => block.id === blockId), 'Unknown position block')
        ensure(state.revision < Number.MAX_SAFE_INTEGER, 'Revision exhausted')
        const next = structuredClone(state)
        next.blockPositions[blockId] = structuredClone(position)
        next.revision++
        assertProjectState(next)
        return next
      })
    },
    dispatch(change: RecordChange) {
      const result = updateRecords(change)
      if (!result.ok) throw new AppSpecError(result.error.code, result.error.message)
    },
  }
}

export function metricValue(state: ProjectState, block: Extract<BlockSpec, { type: 'metric' }>): number {
  const binding = state.spec.relations.find(relation => relation.blockId === block.id)!
  const rows = state.records[binding.entityId] ?? []
  if (block.aggregation === 'count') return rows.length
  const values = rows.map(row => row.values[block.fieldId]).filter((value): value is number => typeof value === 'number')
  const sum = values.reduce((total, value) => total + value, 0)
  return block.aggregation === 'sum' ? sum : values.length ? sum / values.length : 0
}

export type FieldDraft = Record<string, string | boolean>
/** Convert input controls only at the boundary; validation also runs on the whole next state. */
export function parseFieldDraft(fields: FieldSpec[], draft: FieldDraft): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {}
  for (const field of fields) {
    const raw = draft[field.id]
    if (raw === undefined || raw === '') {
      ensure(!field.required, `请填写${field.name}`)
      continue
    }
    if (field.type === 'boolean') {
      ensure(typeof raw === 'boolean', `${field.name}必须为是或否`)
      values[field.id] = raw
    } else {
      ensure(typeof raw === 'string', `${field.name}格式错误`)
      if (field.type === 'number') {
        ensure(raw.trim() !== '' && Number.isFinite(Number(raw)), `${field.name}必须为有效数字`)
        values[field.id] = Number(raw)
      } else {
        ensure(!field.required || raw.trim() !== '', `请填写${field.name}`)
        if (field.type === 'select') ensure(field.options.includes(raw), `请选择有效的${field.name}`)
        if (field.type === 'date') ensure(/^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw, `${field.name}必须为有效日期`)
        values[field.id] = raw
      }
    }
  }
  return values
}

/** A repaint clock never owns or commits project data. Hidden B/C views use this same anchor. */
export function timerRemaining(timer: import('./appSpec').TimerState, now: number): number {
  return Math.max(0, timer.remainingMs - (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt)))
}
