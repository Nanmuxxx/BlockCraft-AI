import type { AppSpec, CommandRequest, ProjectState } from './appSpec'

export class AppSpecError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'AppSpecError' }
}
export function ensure(condition: unknown, message: string, code = 'VALIDATION'): asserts condition {
  if (!condition) throw new AppSpecError(code, message)
}
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
type Obj = Record<string, unknown>
function object(value: unknown): asserts value is Obj {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object')
  ensure(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'Expected plain JSON object')
}
function keys(value: Obj, required: string[], optional: string[] = []) {
  ensure(required.every(k => hasOwn(value, k)), `Missing keys: ${required.join(', ')}`)
  ensure(Object.keys(value).every(k => required.includes(k) || optional.includes(k)), 'Unknown property')
}
function label(value: unknown): asserts value is string { ensure(typeof value === 'string' && value.trim().length > 0, 'Expected nonempty string') }
function id(value: unknown): asserts value is string {
  ensure(typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value), 'Invalid stable ID')
}
function array(value: unknown): asserts value is unknown[] { ensure(Array.isArray(value), 'Expected array') }
function unique(values: unknown[]) { ensure(new Set(values).size === values.length, 'Duplicate ID or value') }
function ids(value: unknown): asserts value is string[] { array(value); value.forEach(id); unique(value) }
function revision(value: unknown) { ensure(Number.isSafeInteger(value) && (value as number) >= 0, 'Invalid revision') }
function field(value: unknown) {
  object(value); keys(value, ['id', 'name', 'type', 'required'], value.type === 'select' ? ['options'] : [])
  id(value.id); label(value.name); ensure(typeof value.required === 'boolean', 'Invalid required flag')
  ensure(['text', 'number', 'boolean', 'date', 'select'].includes(value.type as string), 'Unsupported field type')
  if (value.type === 'select') { array(value.options); ensure(value.options.length > 0, 'Empty select options'); value.options.forEach(label); unique(value.options) }
}
function block(value: unknown) {
  object(value)
  if (value.type === 'pomodoro') {
    keys(value, ['id', 'name', 'type', 'protocolVersion', 'durationSeconds'])
    ensure(value.protocolVersion === 1, 'Unsupported pomodoro protocol')
    ensure(Number.isInteger(value.durationSeconds) && (value.durationSeconds as number) >= 1 && (value.durationSeconds as number) <= 7200, 'Duration must be 1–7200 seconds')
    ensure(typeof value.name === 'string' && value.name.length <= 120, 'Title too long')
  } else if (value.type === 'list' || value.type === 'form') {
    keys(value, ['id', 'name', 'type', 'fieldIds']); ids(value.fieldIds); ensure(value.fieldIds.length > 0, 'Empty display fields')
  } else {
    ensure(value.type === 'metric', 'Unsupported block type')
    keys(value, ['id', 'name', 'type', 'aggregation'], value.aggregation === 'count' ? [] : ['fieldId'])
    ensure(['count', 'sum', 'average'].includes(value.aggregation as string), 'Unsupported aggregation')
    if (value.aggregation !== 'count') id(value.fieldId)
  }
  id(value.id); label(value.name)
}
function binding(value: unknown) {
  object(value); keys(value, ['id', 'type', 'blockId', 'entityId']); id(value.id); id(value.blockId); id(value.entityId)
  ensure(value.type === 'dataBinding', 'Unsupported relation type')
}
function position(value: unknown) {
  object(value); keys(value, ['x', 'y'])
  for (const axis of ['x', 'y']) ensure(typeof value[axis] === 'number' && Number.isFinite(value[axis]) && value[axis] >= 0 && value[axis] <= 1, 'Position outside [0,1]')
}
/** Throws AppSpecError; no coercion, evaluation, or default insertion. */
export function assertAppSpec(value: unknown): asserts value is AppSpec {
  object(value); keys(value, ['version', 'id', 'name', 'entities', 'blocks', 'relations'])
  ensure(value.version === 1 || value.version === 2, 'Unsupported AppSpec version'); id(value.id); label(value.name)
  array(value.entities); array(value.blocks); array(value.relations)
  const globalIds: unknown[] = [value.id]
  for (const entity of value.entities) {
    object(entity); keys(entity, ['id', 'name', 'fields']); id(entity.id); label(entity.name); array(entity.fields)
    entity.fields.forEach(field); globalIds.push(entity.id, ...entity.fields.map(f => (f as Obj).id))
  }
  value.blocks.forEach(block); value.relations.forEach(binding)
  globalIds.push(...value.blocks.map(b => (b as Obj).id), ...value.relations.map(r => (r as Obj).id)); unique(globalIds)
  const spec = value as unknown as AppSpec
  for (const relation of spec.relations) {
    ensure(spec.blocks.some(b => b.id === relation.blockId), 'Unknown relation block')
    ensure(spec.entities.some(e => e.id === relation.entityId), 'Unknown relation entity')
  }
  for (const b of spec.blocks) {
    const links = spec.relations.filter(r => r.blockId === b.id)
    if (b.type === 'pomodoro') {
      ensure(spec.version === 2, 'Pomodoro requires AppSpec v2')
      ensure(links.length === 0, 'Pomodoro cannot bind CRUD entities')
      continue
    }
    ensure(links.length === 1, 'Block requires exactly one binding')
    const entity = spec.entities.find(e => e.id === links[0].entityId)!
    const refs = b.type === 'metric' ? (b.aggregation === 'count' ? [] : [b.fieldId]) : b.fieldIds
    for (const ref of refs) {
      const f = entity.fields.find(f => f.id === ref)
      ensure(f, 'Unknown field in bound entity')
      if (b.type === 'metric') ensure(f.type === 'number', 'Numeric metric requires number field')
    }
    if (b.type === 'form') ensure(entity.fields.filter(f => f.required).every(f => refs.includes(f.id)), 'Form must expose all required fields')
  }
}
export function assertProjectState(value: unknown): asserts value is ProjectState {
  object(value); keys(value, ['revision', 'spec', 'records', 'blockPositions'], ['timers']); revision(value.revision); assertAppSpec(value.spec)
  object(value.records); object(value.blockPositions)
  if (hasOwn(value, 'timers')) {
    ensure(value.spec.version === 2, 'Timer state requires v2'); object(value.timers)
    for (const [blockId, timer] of Object.entries(value.timers)) {
      const b = value.spec.blocks.find(b => b.id === blockId)
      ensure(b?.type === 'pomodoro', 'Dangling timer state')
      object(timer); keys(timer, ['remainingMs', 'startedAt'])
      ensure(typeof timer.remainingMs === 'number' && Number.isFinite(timer.remainingMs) && timer.remainingMs >= 0 && timer.remainingMs <= b.durationSeconds * 1000, 'Invalid remaining time')
      ensure(timer.startedAt === null || (typeof timer.startedAt === 'number' && Number.isSafeInteger(timer.startedAt) && timer.startedAt >= 0 && timer.startedAt <= Number.MAX_SAFE_INTEGER - 7200000), 'Invalid start time')
    }
  }
  for (const [entityId, rows] of Object.entries(value.records)) {
    const entity = value.spec.entities.find(e => e.id === entityId); ensure(entity, 'Unknown records entity'); array(rows)
    const rowIds: unknown[] = []
    for (const row of rows) {
      object(row); keys(row, ['id', 'values']); id(row.id); rowIds.push(row.id); object(row.values)
      ensure(Object.keys(row.values).every(key => entity.fields.some(f => f.id === key)), 'Unknown record field')
      for (const f of entity.fields) {
        const present = hasOwn(row.values, f.id)
        ensure(present || !f.required, 'Missing required record field')
        if (!present) continue
        const v = row.values[f.id]
        if (f.type === 'number') ensure(typeof v === 'number' && Number.isFinite(v), 'Invalid number')
        else if (f.type === 'boolean') ensure(typeof v === 'boolean', 'Invalid boolean')
        else {
          ensure(typeof v === 'string', 'Invalid string')
          if (f.required) ensure(v.trim().length > 0, 'Empty required field')
          if (f.type === 'select') ensure(f.options.includes(v), 'Unknown select option')
          if (f.type === 'date') ensure(/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Invalid calendar date')
        }
      }
    }
    unique(rowIds)
  }
  for (const [blockId, p] of Object.entries(value.blockPositions)) { ensure(value.spec.blocks.some(b => b.id === blockId), 'Unknown position block'); position(p) }
}
export function assertCommandRequest(value: unknown): asserts value is CommandRequest {
  object(value); keys(value, ['requestId', 'baseRevision', 'commands']); id(value.requestId); revision(value.baseRevision); array(value.commands)
  ensure(value.commands.length > 0, 'Empty command batch')
  for (const c of value.commands) {
    object(c)
    switch (c.type) {
      case 'addBlock': keys(c, ['type', 'block', 'binding'], ['position']); block(c.block); binding(c.binding); if (hasOwn(c, 'position')) position(c.position); break
      case 'removeBlock': keys(c, ['type', 'blockId']); id(c.blockId); break
      case 'addField': keys(c, ['type', 'entityId', 'field']); id(c.entityId); field(c.field); break
      case 'updateField': keys(c, ['type', 'entityId', 'fieldId', 'field']); id(c.entityId); id(c.fieldId); field(c.field); break
      case 'removeField': keys(c, ['type', 'entityId', 'fieldId']); id(c.entityId); id(c.fieldId); break
      case 'configureBlockFields': keys(c, ['type', 'blockId', 'fieldIds']); id(c.blockId); ids(c.fieldIds); break
      case 'undo': keys(c, ['type']); ensure(value.commands.length === 1, 'Undo must be a standalone request'); break
      default: ensure(false, 'Unsupported command')
    }
  }
}
