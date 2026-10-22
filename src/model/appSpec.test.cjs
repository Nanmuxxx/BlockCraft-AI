const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { assertAppSpec, assertProjectState, assertCommandRequest } = require('./appSpecValidation.ts')
const { createCommandSession, processCommand } = require('./appCommands.ts')
const { createClubRegistrationExample, createReadingLogExample } = require('./appSpecExamples.ts')
const fresh = () => createCommandSession(createReadingLogExample())
const run = (session, commands, requestId = 'request-1', baseRevision = session.state.revision) => processCommand(session, { requestId, baseRevision, commands })
const add = { type: 'addField', entityId: 'books', field: { id: 'author', name: '作者', type: 'text', required: false } }
const remove = { type: 'removeBlock', blockId: 'reading-history' }
const undo = { type: 'undo' }
function success(result) { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.session }
function failure(result, session, code) { assert.equal(result.ok, false); assert.strictEqual(result.session, session); if (code) assert.equal(result.error.code, code) }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }

test('both handwritten examples validate and fresh examples are isolated', () => {
  for (const factory of [createClubRegistrationExample, createReadingLogExample]) {
    const state = factory(); assertAppSpec(state.spec); assertProjectState(state)
    state.spec.name = 'changed'; assert.notEqual(factory().spec.name, 'changed')
  }
})
test('atomic addField and display configuration, inputs are never mutated', () => {
  const session = freeze(fresh())
  const commands = freeze([add, { type: 'configureBlockFields', blockId: 'bookshelf', fieldIds: ['book-title', 'author'] }])
  const next = success(run(session, commands))
  assert.equal(next.state.revision, 1); assert.equal(next.history.length, 1)
  assert.deepEqual(next.state.spec.blocks[0].fieldIds, ['book-title', 'author'])
  assert.deepEqual(next.state.records, session.state.records)
  assert.equal(session.state.spec.entities[0].fields.length, 2)
})
test('same-type block instances bind independently; deletion keeps business records', () => {
  const session = fresh()
  const next = success(run(session, [{ type: 'addBlock', block: { id: 'second-bookshelf', type: 'list', name: '另一个书架', fieldIds: ['book-title'] }, binding: { id: 'second-binding', type: 'dataBinding', blockId: 'second-bookshelf', entityId: 'books' }, position: { x: .5, y: .7 } }]))
  assert.equal(next.state.spec.blocks.filter(b => b.type === 'list').length, 3)
  const removed = success(run(next, [{ type: 'removeBlock', blockId: 'second-bookshelf' }], 'request-2'))
  assert.ok(!removed.state.spec.relations.some(r => r.blockId === 'second-bookshelf'))
  assert.equal(removed.state.blockPositions['second-bookshelf'], undefined)
  assert.deepEqual(removed.state.records, session.state.records)
  const restored = success(run(removed, [undo], 'request-3'))
  assert.deepEqual(restored.state.spec, next.state.spec)
  assert.deepEqual(restored.state.blockPositions, next.state.blockPositions)
})
test('field updates preserve ID and reject record-incompatible changes', () => {
  const session = fresh()
  success(run(session, [{ type: 'updateField', entityId: 'books', fieldId: 'book-title', field: { id: 'book-title', name: '标题', type: 'text', required: true } }]))
  for (const field of [{ id: 'renamed', name: '标题', type: 'text', required: true }, { id: 'book-title', name: '标题', type: 'number', required: true }]) {
    failure(run(session, [{ type: 'updateField', entityId: 'books', fieldId: 'book-title', field }]), session)
  }
})
test('referenced and populated fields cannot be removed; unused fields can', () => {
  const session = fresh()
  failure(run(session, [{ type: 'removeField', entityId: 'reading-sessions', fieldId: 'minutes' }]), session, 'FIELD_REFERENCED')
  failure(run(session, [{ type: 'configureBlockFields', blockId: 'bookshelf', fieldIds: ['book-title'] }, { type: 'removeField', entityId: 'books', fieldId: 'book-status' }]), session, 'FIELD_REFERENCED')
  const next = success(run(session, [add]))
  const removed = success(run(next, [{ type: 'removeField', entityId: 'books', fieldId: 'author' }], 'request-2'))
  assert.deepEqual(removed.state.spec, session.state.spec)
})
test('exact retries deduplicate before revision check, even after later commits and undo', () => {
  const session = success(run(fresh(), [add]))
  const later = success(run(session, [remove], 'request-2'))
  const restored = success(run(later, [undo], 'request-3'))
  const retry = run(restored, [add], 'request-1', 0)
  assert.equal(retry.ok, true); assert.equal(retry.duplicate, true); assert.equal(retry.committedRevision, 1)
  assert.strictEqual(retry.session, restored); assert.equal(restored.state.revision, 3)
  failure(run(restored, [remove], 'request-1', 0), restored, 'REQUEST_ID_CONFLICT')
  failure(run(restored, [add], 'request-1', 3), restored, 'REQUEST_ID_CONFLICT')
})
test('JSON key order does not alter retry identity', () => {
  const session = success(run(fresh(), [add]))
  const reordered = { field: { required: false, type: 'text', name: '作者', id: 'author' }, entityId: 'books', type: 'addField' }
  assert.equal(run(session, [reordered], 'request-1', 0).duplicate, true)
})
test('stale requests fail and failed requests do not reserve an ID', () => {
  const session = fresh()
  failure(run(session, [add], 'request-1', 9), session, 'REVISION_CONFLICT')
  success(run(session, [add]))
})
test('batch failure rolls back spec, records, positions, history, receipts and revision', () => {
  const session = freeze(fresh()); const before = JSON.stringify(session)
  failure(run(session, [remove, add, { type: 'removeBlock', blockId: 'missing' }]), session)
  assert.equal(JSON.stringify(session), before)
  failure(run(session, [add, add]), session)
  success(run(session, [add]))
})
test('undo restores whole batch and increments revision; no redo toggle', () => {
  const initial = fresh()
  const first = success(run(initial, [add, remove]))
  const second = success(run(first, [undo], 'undo-1'))
  assert.deepEqual({ ...second.state, revision: 0 }, initial.state)
  assert.equal(second.state.revision, 2); assert.equal(second.history.length, 0)
  failure(run(second, [undo], 'undo-2'), second, 'NOTHING_TO_UNDO')
  assert.equal(run(second, [undo], 'undo-1', 1).duplicate, true)
  assert.equal(run(second, [add, remove], 'request-1', 0).duplicate, true)
})
test('multiple undo operations restore prior snapshots in order', () => {
  const first = success(run(fresh(), [add]))
  const second = success(run(first, [remove], 'request-2'))
  const third = success(run(second, [undo], 'undo-1'))
  assert.deepEqual(third.state.spec, first.state.spec)
  const fourth = success(run(third, [undo], 'undo-2'))
  assert.deepEqual(fourth.state.spec, fresh().state.spec); assert.equal(fourth.state.revision, 4)
})
const invalidStates = {
  'unsupported version': s => { s.spec.version = 3 },
  'duplicate global ID': s => { s.spec.blocks[0].id = s.spec.entities[0].id },
  'duplicate field ID across entities': s => { s.spec.entities[1].fields[0].id = 'book-title' },
  'unknown entity binding': s => { s.spec.relations[0].entityId = 'absent' },
  'unknown block binding': s => { s.spec.relations[0].blockId = 'absent' },
  'missing binding': s => { s.spec.relations.pop() },
  'duplicate binding': s => { s.spec.relations.push({ ...s.spec.relations[0], id: 'extra-binding' }) },
  'cross entity field': s => { s.spec.blocks[0].fieldIds = ['minutes'] },
  'duplicate display field': s => { s.spec.blocks[0].fieldIds = ['book-title', 'book-title'] },
  'empty display fields': s => { s.spec.blocks[0].fieldIds = [] },
  'metric nonnumber field': s => { s.spec.blocks[3].fieldId = 'notes' },
  'form excludes required field': s => { s.spec.blocks[2].fieldIds = ['notes'] },
  'unsupported field': s => { s.spec.entities[0].fields[0].type = 'code' },
  'empty select': s => { s.spec.entities[0].fields[1].options = [] },
  'duplicate options': s => { s.spec.entities[0].fields[1].options = ['想读', '想读'] },
  'invalid required flag': s => { s.spec.entities[0].fields[0].required = 'true' },
  'invalid number': s => { s.records['reading-sessions'][0].values.minutes = Infinity },
  'invalid date': s => { s.records['reading-sessions'][0].values['reading-date'] = '2026-02-30' },
  'invalid select': s => { s.records.books[0].values['book-status'] = '未知' },
  'missing required value': s => { delete s.records.books[0].values['book-title'] },
  'unknown record entity': s => { s.records.unknown = [] },
  'unknown record field': s => { s.records.books[0].values.unknown = 'x' },
  'duplicate record ID': s => { s.records.books.push(s.records.books[0]) },
  'invalid coordinates': s => { s.blockPositions.bookshelf = { x: -1, y: 0 } },
  'dangling position': s => { s.blockPositions.unknown = { x: 0, y: 0 } },
  'invalid revision': s => { s.revision = 0.5 },
  'unexpected executable configuration': s => { s.spec.script = 'alert(1)' },
}
for (const [name, mutate] of Object.entries(invalidStates)) test(`validation rejects ${name}`, () => {
  const state = createReadingLogExample(); mutate(state); assert.throws(() => assertProjectState(state), { name: 'AppSpecError' })
})
test('boolean, text and leap date values are checked without coercion', () => {
  const state = createClubRegistrationExample(); state.records.applicants[0].values.available = 'true'
  assert.throws(() => assertProjectState(state))
  const reading = createReadingLogExample(); reading.records['reading-sessions'][0].values['reading-date'] = '2024-02-29'
  assertProjectState(reading)
  reading.records.books[0].values['book-title'] = 123; assert.throws(() => assertProjectState(reading))
})
test('untrusted malformed requests fail cleanly', () => {
  const session = fresh()
  for (const input of [null, [], {}, { requestId: 'r', baseRevision: 0, commands: [] }, { requestId: 'r', baseRevision: 0, commands: [null] }, { requestId: 'r', baseRevision: 0, commands: [{ type: 'eval', code: 'x' }] }, { requestId: 'constructor', baseRevision: 0, commands: [undo] }, { requestId: 'r', baseRevision: 0, commands: [add, undo] }]) {
    assert.throws(() => assertCommandRequest(input)); failure(processCommand(session, input), session)
  }
})
test('new required fields and narrowed select options cannot invalidate existing records', () => {
  const session = fresh()
  failure(run(session, [{ ...add, field: { ...add.field, required: true } }]), session)
  failure(run(session, [{ type: 'updateField', entityId: 'books', fieldId: 'book-status', field: { id: 'book-status', name: '状态', type: 'select', required: false, options: ['想读'] } }]), session)
})
test('unsupported targets and bad addBlock bindings are rejected', () => {
  const session = fresh()
  for (const command of [
    { ...add, entityId: 'missing' },
    { type: 'updateField', entityId: 'books', fieldId: 'missing', field: add.field },
    { type: 'configureBlockFields', blockId: 'reading-total', fieldIds: ['minutes'] },
    { type: 'addBlock', block: { id: 'new-list', name: '列表', type: 'list', fieldIds: ['book-title'] }, binding: { id: 'new-binding', type: 'dataBinding', blockId: 'bookshelf', entityId: 'books' } },
  ]) failure(run(session, [command]), session)
})

const image = (id = 'photo') => ({ id, name: '图片', altText: '说明', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
const gallery = (imageIds = []) => ({ id: 'photos', name: '图片画廊', type: 'gallery', protocolVersion: 1, imageIds, layout: 'grid', interaction: 'preview' })
test('v1 gallery needs no binding and old projects remain compatible', () => {
  const state = createReadingLogExample()
  assert.equal(state.assets, undefined)
  assertProjectState(state)
  state.spec.blocks.push(gallery())
  assertProjectState(state)
  state.spec.relations.push({ id: 'gallery-binding', type: 'dataBinding', blockId: 'photos', entityId: 'books' })
  assert.throws(() => assertProjectState(state), /cannot bind/)
})
test('gallery image references must resolve even when assets is omitted', () => {
  const state = createReadingLogExample()
  state.spec.blocks.push(gallery(['photo']))
  assert.throws(() => assertProjectState(state), /unknown image asset/)
  state.assets = { photo: image() }
  assertProjectState(state)
  state.assets.photo.id = 'other'
  assert.throws(() => assertProjectState(state), /does not match/)
})
test('image asset registry accepts raster signatures and rejects active or mismatched input', () => {
  const signatures = { 'image/png': [137,80,78,71,13,10,26,10], 'image/jpeg': [255,216,255], 'image/gif': [...Buffer.from('GIF89a')], 'image/webp': [...Buffer.from('RIFF0000WEBP')] }
  for (const [mimeType, signature] of Object.entries(signatures)) {
    const state = createReadingLogExample()
    state.assets = { photo: { ...image(), mimeType, dataUrl: `data:${mimeType};base64,${Buffer.from(signature).toString('base64')}` } }
    assertProjectState(state)
  }
  for (const asset of [
    { ...image(), mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { ...image(), dataUrl: 'https://example.com/image.png' },
    { ...image(), dataUrl: 'data:image/png;base64,SGVsbG8=' },
    { ...image(), dataUrl: 'data:image/png;base64,!!!=' },
    { ...image(), dataUrl: 'data:image/jpeg;base64,/9j/' },
  ]) {
    const state = createReadingLogExample(); state.assets = { photo: asset }
    assert.throws(() => assertProjectState(state), { name: 'AppSpecError' })
  }
})
test('image count, per-file and aggregate byte limits are enforced before commit', () => {
  const { PROJECT_ASSET_LIMITS: limits } = require('./appSpecValidation.ts')
  const sizedImage = (id, size) => { const bytes = Buffer.alloc(size); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); return { ...image(id), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` } }
  const state = createReadingLogExample()
  state.assets = Object.fromEntries(Array.from({ length: limits.maxCount + 1 }, (_, i) => [`p${i}`, image(`p${i}`)]))
  assert.throws(() => assertProjectState(state), /Too many/)
  state.assets = { photo: sizedImage('photo', limits.maxBytesEach + 1) }
  assert.throws(() => assertProjectState(state), /per-file/)
  state.assets = { one: sizedImage('one', limits.maxBytesEach), two: sizedImage('two', limits.maxBytesEach), three: image('three') }
  assert.throws(() => assertProjectState(state), /project limit/)
})
test('asset import, gallery configuration, reference protection and undo are atomic', () => {
  const initial = freeze(fresh())
  const added = success(run(initial, [{ type: 'addProjectAsset', asset: image() }, { type: 'addBlock', block: gallery(['photo']) }]))
  assert.equal(added.state.assets.photo.id, 'photo')
  assert.equal(added.state.spec.relations.length, initial.state.spec.relations.length)
  failure(run(added, [{ type: 'removeProjectAsset', assetId: 'photo' }], 'remove-ref'), added, 'ASSET_REFERENCED')
  failure(run(added, [{ type: 'addProjectAsset', asset: image() }], 'duplicate'), added, 'ID_CONFLICT')
  failure(run(added, [{ type: 'configureGallery', blockId: 'photos', imageIds: ['missing'] }], 'missing'), added)
  failure(run(initial, [{ type: 'addProjectAsset', asset: image() }, { type: 'configureGallery', blockId: 'missing', imageIds: ['photo'] }]), initial)
  const removed = success(run(added, [{ type: 'configureGallery', blockId: 'photos', imageIds: [] }, { type: 'removeProjectAsset', assetId: 'photo' }], 'remove'))
  assert.deepEqual(removed.state.assets, {})
  assert.deepEqual(success(run(removed, [undo], 'undo-assets')).state.assets, added.state.assets)
  assert.throws(() => assertCommandRequest({ requestId: 'bound', baseRevision: 0, commands: [{ type: 'addBlock', block: gallery(), binding: { id: 'forbidden', type: 'dataBinding', blockId: 'photos', entityId: 'books' } }] }), /cannot bind/)
})
