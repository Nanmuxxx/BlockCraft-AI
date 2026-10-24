import type { AppSpec, CommandRequest, ProjectState } from './appSpec'

export const PROJECT_ASSET_LIMITS = Object.freeze({ maxCount: 32, maxBytesEach: 512 * 1024, maxBytesTotal: 1024 * 1024 })

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
const ASSET_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
function decodedDataUrlBytes(value: unknown): number {
  ensure(typeof value === 'string', 'Invalid image data URL')
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value)
  ensure(match && match[2].length % 4 === 0, 'Invalid image data URL')
  const payload = match[2]
  ensure(!/=/.test(payload.slice(0, -2)), 'Invalid image data URL')
  const bytes = Math.floor(payload.length * 3 / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
  ensure(bytes > 0 && bytes <= PROJECT_ASSET_LIMITS.maxBytesEach, 'Image asset exceeds per-file limit')
  const decoded = atob(payload)
  const startsWith = (signature: number[]) => signature.every((byte, index) => decoded.charCodeAt(index) === byte)
  if (match[1] === 'image/png') ensure(startsWith([137, 80, 78, 71, 13, 10, 26, 10]), 'PNG signature mismatch')
  if (match[1] === 'image/jpeg') ensure(startsWith([255, 216, 255]), 'JPEG signature mismatch')
  if (match[1] === 'image/gif') ensure(decoded.startsWith('GIF87a') || decoded.startsWith('GIF89a'), 'GIF signature mismatch')
  if (match[1] === 'image/webp') ensure(decoded.startsWith('RIFF') && decoded.slice(8, 12) === 'WEBP', 'WebP signature mismatch')
  return bytes
}
function asset(value: unknown) {
  object(value); keys(value, ['id', 'name', 'mimeType', 'dataUrl'], ['altText'])
  id(value.id); label(value.name); ensure(value.name.length <= 160, 'Asset name too long')
  ensure(ASSET_MIME_TYPES.includes(value.mimeType as typeof ASSET_MIME_TYPES[number]), 'Unsupported image type')
  ensure(typeof value.dataUrl === 'string' && value.dataUrl.startsWith(`data:${value.mimeType};base64,`), 'Image MIME/data mismatch')
  const bytes = decodedDataUrlBytes(value.dataUrl)
  ensure(bytes > 0 && bytes <= PROJECT_ASSET_LIMITS.maxBytesEach, 'Image asset exceeds per-file limit')
  if (hasOwn(value, 'altText')) ensure(typeof value.altText === 'string' && value.altText.length <= 240, 'Alt text too long')
}
function assetRegistry(value: unknown, spec: AppSpec) {
  if (value === undefined) {
    ensure(spec.blocks.every(block => block.type !== 'gallery' || block.imageIds.length === 0), 'Gallery references unknown image asset')
    return
  }
  object(value)
  const entries = Object.entries(value)
  ensure(entries.length <= PROJECT_ASSET_LIMITS.maxCount, 'Too many image assets')
  let total = 0
  const ids = new Set<string>()
  for (const [key, item] of entries) {
    id(key); asset(item); ensure((item as Obj).id === key, 'Asset key does not match ID')
    ids.add(key); total += decodedDataUrlBytes((item as Obj).dataUrl)
  }
  ensure(total <= PROJECT_ASSET_LIMITS.maxBytesTotal, 'Image assets exceed project limit')
  for (const block of spec.blocks) if (block.type === 'gallery') {
    for (const imageId of block.imageIds) ensure(ids.has(imageId), 'Gallery references unknown image asset')
  }
}
function field(value: unknown) {
  object(value); keys(value, ['id', 'name', 'type', 'required'], value.type === 'select' ? ['options'] : [])
  id(value.id); label(value.name); ensure(typeof value.required === 'boolean', 'Invalid required flag')
  ensure(['text', 'number', 'boolean', 'date', 'select'].includes(value.type as string), 'Unsupported field type')
  if (value.type === 'select') { array(value.options); ensure(value.options.length > 0, 'Empty select options'); value.options.forEach(label); unique(value.options) }
}
function presentation(value: unknown) {
  object(value); keys(value, [], ['buttonText', 'backgroundColor', 'textColor', 'borderRadius'])
  ensure(Object.keys(value).length > 0, 'Empty presentation patch')
  if (hasOwn(value, 'buttonText')) { label(value.buttonText); ensure((value.buttonText as string).length <= 120, 'Button text too long') }
  for (const key of ['backgroundColor', 'textColor']) if (hasOwn(value, key)) ensure(typeof value[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(value[key] as string), 'Expected six-digit hex color')
  if (hasOwn(value, 'borderRadius')) ensure(Number.isInteger(value.borderRadius) && (value.borderRadius as number) >= 0 && (value.borderRadius as number) <= 32, 'Radius outside 0–32')
}
function block(value: unknown) {
  object(value)
  if (value.type === 'pomodoro') {
    keys(value, ['id', 'name', 'type', 'protocolVersion', 'durationSeconds'])
    ensure(value.protocolVersion === 1, 'Unsupported pomodoro protocol')
    ensure(Number.isInteger(value.durationSeconds) && (value.durationSeconds as number) >= 1 && (value.durationSeconds as number) <= 7200, 'Duration must be 1–7200 seconds')
    ensure(typeof value.name === 'string' && value.name.length <= 120, 'Title too long')
  } else if (value.type === 'gallery') {
    keys(value, ['id', 'name', 'type', 'protocolVersion', 'imageIds', 'layout', 'interaction'], ['presentation'])
    ensure(value.protocolVersion === 1, 'Unsupported gallery protocol')
    ids(value.imageIds); ensure(value.imageIds.length <= PROJECT_ASSET_LIMITS.maxCount, 'Gallery has too many images'); ensure(value.layout === 'grid', 'Unsupported gallery layout')
    ensure(value.interaction === 'preview', 'Unsupported gallery interaction')
  } else if (value.type === 'filter' || value.type === 'details') {
    keys(value, ['id', 'name', 'type', 'fieldIds', value.type === 'filter' ? 'targetBlockIds' : 'sourceBlockId'], ['presentation'])
    ids(value.fieldIds); ensure(value.fieldIds.length > 0, 'Empty view fields')
    if (value.type === 'filter') { ids(value.targetBlockIds); ensure(value.targetBlockIds.length > 0, 'Filter needs explicit targets') }
    else id(value.sourceBlockId)
  } else if (value.type === 'chart') {
    keys(value, ['id', 'name', 'type', 'chartType', 'groupFieldId', 'aggregation', 'targetBlockIds'], ['valueFieldId', 'presentation'])
    ensure(value.chartType === 'bar' || value.chartType === 'line', 'Unsupported chart type')
    id(value.groupFieldId); ids(value.targetBlockIds)
    ensure(['count', 'sum', 'average'].includes(value.aggregation as string), 'Unsupported chart aggregation')
    if (value.aggregation === 'count') ensure(!hasOwn(value, 'valueFieldId'), 'Count forbids valueFieldId')
    else id(value.valueFieldId)
  } else if (value.type === 'list' || value.type === 'form') {
    keys(value, ['id', 'name', 'type', 'fieldIds'], ['presentation']); ids(value.fieldIds); ensure(value.fieldIds.length > 0, 'Empty display fields')
  } else {
    ensure(value.type === 'metric', 'Unsupported block type')
    keys(value, ['id', 'name', 'type', 'aggregation'], value.aggregation === 'count' ? ['presentation'] : ['fieldId', 'presentation'])
    ensure(['count', 'sum', 'average'].includes(value.aggregation as string), 'Unsupported aggregation')
    if (value.aggregation !== 'count') id(value.fieldId)
  }
  if (hasOwn(value, 'presentation')) {
    presentation(value.presentation)
    ensure(value.type === 'form' || !(value.presentation as Obj).buttonText, 'Button text requires form')
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
    if (b.type === 'pomodoro' || b.type === 'gallery') {
      if (b.type === 'pomodoro') ensure(spec.version === 2, 'Pomodoro requires AppSpec v2')
      ensure(links.length === 0, `${b.type} cannot bind CRUD entities`)
      continue
    }
    ensure(links.length === 1, 'Block requires exactly one binding')
    const entity = spec.entities.find(e => e.id === links[0].entityId)!
    const refs = b.type === 'chart' ? [b.groupFieldId, ...(b.valueFieldId ? [b.valueFieldId] : [])] : b.type === 'metric' ? (b.aggregation === 'count' ? [] : [b.fieldId]) : b.fieldIds
    for (const ref of refs) {
      const f = entity.fields.find(f => f.id === ref)
      ensure(f, 'Unknown field in bound entity')
      if (b.type === 'metric') ensure(f.type === 'number', 'Numeric metric requires number field')
    }
    if (b.type === 'chart' && b.aggregation !== 'count') ensure(entity.fields.find(f => f.id === b.valueFieldId)?.type === 'number', 'Chart values require a numeric field')
    if (b.type === 'filter' || b.type === 'chart') {
      for (const targetId of b.targetBlockIds) {
        const target = spec.blocks.find(item => item.id === targetId)
        ensure(target && target.id !== b.id && (target.type === 'list' || target.type === 'metric' || (b.type === 'filter' && target.type === 'chart')), 'Unsupported interaction target')
        ensure(spec.relations.find(r => r.blockId === targetId)?.entityId === entity.id, 'Interaction requires the same entity')
      }
    }
    if (b.type === 'details') {
      ensure(spec.blocks.find(item => item.id === b.sourceBlockId)?.type === 'list', 'Details source must be a list')
      ensure(spec.relations.find(r => r.blockId === b.sourceBlockId)?.entityId === entity.id, 'Details source requires the same entity')
    }
    if (b.type === 'form') ensure(entity.fields.filter(f => f.required).every(f => refs.includes(f.id)), 'Form must expose all required fields')
  }
}
export function assertProjectState(value: unknown): asserts value is ProjectState {
  object(value); keys(value, ['revision', 'spec', 'records', 'blockPositions'], ['timers', 'assets']); revision(value.revision); assertAppSpec(value.spec)
  object(value.records); object(value.blockPositions)
  assetRegistry(value.assets, value.spec)
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
      case 'addBlock': {
        keys(c, ['type', 'block'], ['binding', 'position']); block(c.block)
        const addedBlock = c.block as AppSpec['blocks'][number]
        if (addedBlock.type === 'gallery' || addedBlock.type === 'pomodoro') ensure(!hasOwn(c, 'binding'), `${addedBlock.type} blocks cannot bind entities`)
        else { ensure(hasOwn(c, 'binding'), 'Data block requires binding'); binding(c.binding); }
        if (hasOwn(c, 'position')) position(c.position)
        break
      }
      case 'removeBlock': keys(c, ['type', 'blockId']); id(c.blockId); break
      case 'reorderBlocks': keys(c, ['type', 'blockIds']); ids(c.blockIds); break
      case 'configureMetric':
        keys(c, ['type', 'blockId', 'aggregation'], c.aggregation === 'count' ? [] : ['fieldId']); id(c.blockId)
        ensure(['count', 'sum', 'average'].includes(c.aggregation as string), 'Unsupported aggregation')
        if (c.aggregation !== 'count') id(c.fieldId)
        break
      case 'addField': keys(c, ['type', 'entityId', 'field']); id(c.entityId); field(c.field); break
      case 'updateField': keys(c, ['type', 'entityId', 'fieldId', 'field']); id(c.entityId); id(c.fieldId); field(c.field); break
      case 'removeField': keys(c, ['type', 'entityId', 'fieldId']); id(c.entityId); id(c.fieldId); break
      case 'configureBlockPresentation': keys(c, ['type', 'blockId', 'presentation']); id(c.blockId); presentation(c.presentation); break
      case 'configureBlockFields': keys(c, ['type', 'blockId', 'fieldIds']); id(c.blockId); ids(c.fieldIds); break
      case 'configureView':
        keys(c, ['type', 'blockId', 'block']); id(c.blockId); block(c.block)
        ensure(['filter', 'chart', 'details'].includes((c.block as Obj).type as string), 'Unsupported view configuration')
        ensure((c.block as Obj).id === c.blockId, 'View ID is immutable')
        break
      case 'configureGallery': keys(c, ['type', 'blockId', 'imageIds'], ['layout']); id(c.blockId); ids(c.imageIds); if (hasOwn(c, 'layout')) ensure(c.layout === 'grid', 'Unsupported gallery layout'); break
      case 'addProjectAsset': keys(c, ['type', 'asset']); asset(c.asset); break
      case 'removeProjectAsset': keys(c, ['type', 'assetId']); id(c.assetId); break
      case 'undo': keys(c, ['type']); ensure(value.commands.length === 1, 'Undo must be a standalone request'); break
      default: ensure(false, 'Unsupported command')
    }
  }
}
