import type { BlockSpec, EntityRecord, FieldValue, ProjectState } from './appSpec'
import { AppSpecError, ensure } from './appSpecValidation'

export interface InteractionState {
  filters: Record<string, { query: string; values: Record<string, FieldValue> }>
  chartSelections: Record<string, FieldValue>
  records: Record<string, string>
}
export type InteractionAction =
  | { type: 'filter'; blockId: string; query: string; values: Record<string, FieldValue> }
  | { type: 'chartSelect'; blockId: string; value: FieldValue | null }
  | { type: 'selectRecord'; blockId: string; recordId: string | null }
const empty = (): InteractionState => ({ filters: {}, chartSelections: {}, records: {} })
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function boundEntityId(state: ProjectState, blockId: string): string | undefined {
  return state.spec.relations.find(r => r.blockId === blockId)?.entityId
}
/** Every propagation edge is declared and schema-validated; there is no event code. */
export function visibleRecords(state: ProjectState, view: InteractionState, blockId: string): EntityRecord[] {
  const entityId = boundEntityId(state, blockId)
  let rows = state.records[entityId ?? ''] ?? []
  for (const source of state.spec.blocks) {
    if (source.type === 'filter' && source.targetBlockIds.includes(blockId)) {
      const filter = view.filters[source.id]
      if (!filter) continue
      const query = filter.query.trim().toLocaleLowerCase()
      rows = rows.filter(row => (!query || source.fieldIds.some(id => String(row.values[id] ?? '').toLocaleLowerCase().includes(query)))
        && Object.entries(filter.values).every(([id, value]) => row.values[id] === value))
    }
    if (source.type === 'chart' && source.targetBlockIds.includes(blockId) && Object.prototype.hasOwnProperty.call(view.chartSelections, source.id)) {
      rows = rows.filter(row => row.values[source.groupFieldId] === view.chartSelections[source.id])
    }
  }
  return rows
}
export interface ChartPoint { key: string; label: string; category: FieldValue; value: number }
export function chartPoints(state: ProjectState, view: InteractionState, block: Extract<BlockSpec, { type: 'chart' }>): ChartPoint[] {
  const buckets = new Map<string, { category: FieldValue; count: number; sum: number; numbers: number }>()
  for (const row of visibleRecords(state, view, block.id)) {
    const category = row.values[block.groupFieldId]
    if (category === undefined) continue
    const key = JSON.stringify(category)
    const bucket = buckets.get(key) ?? { category, count: 0, sum: 0, numbers: 0 }
    bucket.count++
    const value = block.valueFieldId ? row.values[block.valueFieldId] : undefined
    if (typeof value === 'number') { bucket.sum += value; bucket.numbers++ }
    buckets.set(key, bucket)
  }
  return [...buckets].sort(([a, x], [b, y]) => typeof x.category === 'number' && typeof y.category === 'number' ? x.category - y.category : a < b ? -1 : a > b ? 1 : 0).map(([key, b]) => ({ key, category: b.category,
    label: typeof b.category === 'boolean' ? b.category ? '是' : '否' : String(b.category),
    value: block.aggregation === 'count' ? b.count : block.aggregation === 'sum' ? b.sum : b.numbers ? b.sum / b.numbers : 0 }))
}
export function selectedRecord(state: ProjectState, view: InteractionState, block: Extract<BlockSpec, { type: 'details' }>): EntityRecord | undefined {
  return visibleRecords(state, view, block.sourceBlockId).find(row => row.id === view.records[block.sourceBlockId])
}
/** View interactions are immutable session state: no business writes/revision/undo invalidation. */
export function createInteractions(read: () => ProjectState, subscribe: (listener: () => void) => () => void) {
  let view = freeze(empty())
  let spec = JSON.stringify(read().spec)
  const listeners = new Set<() => void>()
  subscribe(() => {
    const next = JSON.stringify(read().spec)
    if (next === spec) return
    spec = next; view = freeze(empty()); listeners.forEach(listener => listener())
  })
  return {
    getInteractionSnapshot: () => view,
    subscribeInteractions: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    interact(input: InteractionAction) {
      try {
        ensure(input && typeof input === 'object' && !Array.isArray(input) && Object.getPrototypeOf(input) === Object.prototype, 'Invalid interaction')
        const state = read(), block = state.spec.blocks.find(b => b.id === input.blockId)
        ensure(block, 'Interaction block no longer exists', 'INVALID_TARGET')
        const next = structuredClone(view)
        if (input.type === 'filter') {
          ensure(Object.keys(input).sort().join() === 'blockId,query,type,values', 'Unknown interaction property')
          ensure(block.type === 'filter' && typeof input.query === 'string' && input.query.length <= 200, 'Invalid search filter')
          ensure(input.values && Object.getPrototypeOf(input.values) === Object.prototype, 'Invalid filter values')
          const entity = state.spec.entities.find(e => e.id === boundEntityId(state, block.id))!
          for (const [id, value] of Object.entries(input.values)) {
            const field = entity.fields.find(f => f.id === id)
            ensure(block.fieldIds.includes(id) && field, 'Filter field is outside declared scope')
            ensure(field.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : field.type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string' && value.length <= 1000, 'Invalid filter value')
            if (field.type === 'select') ensure(field.options.includes(value as string), 'Unknown filter option')
            if (field.type === 'date') ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Invalid filter date')
          }
          next.filters[block.id] = { query: input.query, values: structuredClone(input.values) }
        } else if (input.type === 'chartSelect') {
          ensure(Object.keys(input).sort().join() === 'blockId,type,value', 'Unknown interaction property')
          ensure(block.type === 'chart', 'Selection requires chart')
          if (input.value === null) delete next.chartSelections[block.id]
          else {
            ensure(chartPoints(state, view, block).some(point => point.category === input.value), 'Chart category no longer exists')
            next.chartSelections[block.id] = input.value
          }
        } else if (input.type === 'selectRecord') {
          ensure(Object.keys(input).sort().join() === 'blockId,recordId,type', 'Unknown interaction property')
          ensure(block.type === 'list', 'Record selection requires list')
          if (input.recordId === null) delete next.records[block.id]
          else {
            ensure(visibleRecords(state, view, block.id).some(row => row.id === input.recordId), 'Record is missing or filtered out')
            next.records[block.id] = input.recordId
          }
        } else ensure(false, 'Unsupported interaction')
        if (JSON.stringify(next) !== JSON.stringify(view)) { view = freeze(next); listeners.forEach(listener => listener()) }
        return { ok: true as const }
      } catch (error) {
        if (!(error instanceof AppSpecError)) throw error
        return { ok: false as const, error: { code: error.code, message: error.message } }
      }
    },
  }
}
