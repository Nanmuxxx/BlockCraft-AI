import type { BlockSpec, EntityRecord, FieldSpec, FieldValue, ProjectState } from './appSpec'
import { assertProjectState, ensure } from './appSpecValidation'

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

/** One source of truth per project. Snapshots cannot be mutated by a component. */
export function createAppRuntime(initial: ProjectState) {
  assertProjectState(initial)
  let state = freeze(structuredClone(initial))
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispatch(change: RecordChange) {
      state = freeze(applyRecordChange(state, change))
      listeners.forEach(listener => listener())
    },
  }
}
export type AppRuntime = ReturnType<typeof createAppRuntime>

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
