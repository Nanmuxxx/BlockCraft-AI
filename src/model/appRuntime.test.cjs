const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { createAppRuntime, applyRecordChange, metricValue, parseFieldDraft } = require('./appRuntime.ts')
const { createClubRegistrationExample, createReadingLogExample } = require('./appSpecExamples.ts')

test('shared entity CRUD publishes one snapshot and immediately updates derived metrics', () => {
  const initial = createClubRegistrationExample()
  const runtime = createAppRuntime(initial)
  const metric = initial.spec.blocks[2]
  let notifications = 0
  const unsubscribe = runtime.subscribe(() => notifications++)
  runtime.dispatch({ type: 'create', entityId: 'applicants', record: { id: 'new-applicant', values: { 'applicant-name': '小张', department: '策划部', available: false } } })
  assert.equal(runtime.getSnapshot().records.applicants.length, 2)
  assert.equal(metricValue(runtime.getSnapshot(), metric), 2)
  runtime.dispatch({ type: 'update', entityId: 'applicants', recordId: 'new-applicant', values: { 'applicant-name': '小李', department: '技术部' } })
  assert.equal(runtime.getSnapshot().records.applicants[1].values['applicant-name'], '小李')
  runtime.dispatch({ type: 'delete', entityId: 'applicants', recordId: 'new-applicant' })
  assert.equal(metricValue(runtime.getSnapshot(), metric), 1)
  assert.equal(runtime.getSnapshot().revision, 3)
  assert.equal(notifications, 3)
  assert.equal(initial.records.applicants.length, 1)
  assert.ok(Object.isFrozen(runtime.getSnapshot().records.applicants[0].values))
  unsubscribe()
  runtime.dispatch({ type: 'delete', entityId: 'applicants', recordId: 'applicant-001' })
  assert.equal(notifications, 3)
})
test('invalid writes, duplicate IDs and missing targets are atomic and do not notify', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const before = runtime.getSnapshot()
  let notifications = 0
  runtime.subscribe(() => notifications++)
  for (const change of [
    { type: 'create', entityId: 'applicants', record: { id: 'bad', values: {} } },
    { type: 'create', entityId: 'applicants', record: before.records.applicants[0] },
    { type: 'update', entityId: 'applicants', recordId: 'applicant-001', values: { 'applicant-name': 'x', department: '不存在' } },
    { type: 'delete', entityId: 'missing', recordId: 'x' },
    { type: 'delete', entityId: 'applicants', recordId: 'missing' },
  ]) {
    assert.throws(() => runtime.dispatch(change))
    assert.strictEqual(runtime.getSnapshot(), before)
  }
  assert.equal(notifications, 0)
})
test('sum and average derive from actual records, optional numbers and empty data', () => {
  let state = createReadingLogExample()
  const sum = state.spec.blocks[3]
  const average = { ...sum, aggregation: 'average' }
  state = applyRecordChange(state, { type: 'create', entityId: 'reading-sessions', record: { id: 's2', values: { 'reading-date': '2026-10-18', minutes: 15.5 } } })
  assert.equal(metricValue(state, sum), 45.5)
  assert.equal(metricValue(state, average), 22.75)
  state = applyRecordChange(state, { type: 'update', entityId: 'reading-sessions', recordId: 's2', values: { 'reading-date': '2026-10-18', minutes: 0 } })
  assert.equal(metricValue(state, sum), 30)
  state.records['reading-sessions'] = []
  assert.equal(metricValue(state, average), 0)
  state.spec.entities[1].fields[1].required = false
  state.records['reading-sessions'] = [{ id: 'empty-number', values: { 'reading-date': '2026-10-18' } }]
  assert.equal(metricValue(state, sum), 0)
  assert.equal(metricValue(state, average), 0)
})
test('input boundary handles five field types, required false, zero and invalid calendars', () => {
  const fields = [
    { id: 'text', name: '文本', type: 'text', required: true },
    { id: 'number', name: '数值', type: 'number', required: true },
    { id: 'boolean', name: '布尔', type: 'boolean', required: true },
    { id: 'date', name: '日期', type: 'date', required: true },
    { id: 'select', name: '选项', type: 'select', required: false, options: ['a'] },
  ]
  const draft = { text: '<script>只是文本</script>', number: '0', boolean: false, date: '2024-02-29', select: '' }
  assert.deepEqual(parseFieldDraft(fields, draft), { text: draft.text, number: 0, boolean: false, date: draft.date })
  for (const invalid of [{ text: ' ' }, { number: 'Infinity' }, { number: ' ' }, { boolean: 'false' }, { date: '2026-02-30' }, { select: 'b' }]) {
    assert.throws(() => parseFieldDraft(fields, { ...draft, ...invalid }))
  }
})
test('projects and caller values are isolated, clearing optional values is supported', () => {
  const one = createAppRuntime(createReadingLogExample())
  const two = createAppRuntime(createReadingLogExample())
  const values = { 'book-title': '独立书目' }
  one.dispatch({ type: 'update', entityId: 'books', recordId: 'book-001', values })
  values['book-title'] = 'outside mutation'
  assert.equal(one.getSnapshot().records.books[0].values['book-title'], '独立书目')
  assert.equal(one.getSnapshot().records.books[0].values['book-status'], undefined)
  assert.equal(two.getSnapshot().records.books[0].values['book-title'], '乡土中国')
})

const { AppRenderer } = (() => {
  require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename)
  require.extensions['.css'] = () => {}
  return require('../components/app-renderer/AppRenderer.tsx')
})()
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { toAppCanvasModules } = require('../components/blocks/app-canvas.ts')
const addNote = { type: 'addField', entityId: 'books', field: { id: 'note', name: '备注', type: 'text', required: false } }
function execute(runtime, commands, requestId = 'edit-1') {
  return runtime.executeCommand({ requestId, baseRevision: runtime.getSnapshot().revision, commands })
}

test('one session shares structural commands, C writes, layout and B projections', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  let calls = 0
  runtime.subscribe(() => calls++)
  const request = { requestId: 'add-note', baseRevision: 0, commands: [addNote] }
  assert.equal(runtime.executeCommand(request).ok, true)
  assert.equal(runtime.canUndo(), true)
  assert.equal(runtime.updateRecords({ type: 'update', entityId: 'books', recordId: 'book-001', values: { 'book-title': '共享书目', note: '真实数据' } }).ok, true)
  assert.equal(runtime.moveBlock('bookshelf', { x: 0.2, y: 0.3 }).ok, true)
  assert.equal(runtime.getSnapshot().revision, 3)
  assert.equal(calls, 3)
  const beforeRetry = runtime.getSnapshot()
  assert.deepEqual(runtime.executeCommand(request), { ok: true, duplicate: true, committedRevision: 1 })
  assert.strictEqual(runtime.getSnapshot(), beforeRetry)
  assert.equal(calls, 3)
  assert.equal(toAppCanvasModules(beforeRetry)[0].id, beforeRetry.spec.blocks[0].id)
  const html = renderToStaticMarkup(React.createElement(AppRenderer, { runtime }))
  assert.match(html, /共享书目/)
  assert.equal(execute(runtime, [{ type: 'configureBlockFields', blockId: 'bookshelf', fieldIds: ['book-title', 'note'] }], 'show-note').ok, true)
  assert.match(renderToStaticMarkup(React.createElement(AppRenderer, { runtime })), /真实数据/)
})

test('failed commands, records and moves retain snapshot, history, revision and notifications', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  execute(runtime, [addNote])
  const before = runtime.getSnapshot()
  let calls = 0
  runtime.subscribe(() => calls++)
  const failures = [
    runtime.executeCommand(null),
    runtime.executeCommand({ requestId: 'stale', baseRevision: 0, commands: [{ type: 'removeBlock', blockId: 'bookshelf' }] }),
    execute(runtime, [{ type: 'removeBlock', blockId: 'missing' }], 'missing'),
    execute(runtime, [{ type: 'removeBlock', blockId: 'bookshelf' }], 'edit-1'),
    runtime.updateRecords({ type: 'create', entityId: 'books', record: { id: 'invalid', values: {} } }),
    runtime.moveBlock('missing', { x: 0, y: 0 }),
    runtime.moveBlock('bookshelf', { x: -0.1, y: 0 }),
    runtime.moveBlock('bookshelf', { x: NaN, y: 0 }),
  ]
  assert.ok(failures.every(result => !result.ok))
  assert.equal(failures[1].error.code, 'REVISION_CONFLICT')
  assert.equal(failures[3].error.code, 'REQUEST_ID_CONFLICT')
  assert.strictEqual(runtime.getSnapshot(), before)
  assert.equal(runtime.canUndo(), true)
  assert.equal(calls, 0)
  // Rejected request IDs are not consumed.
  assert.equal(execute(runtime, [{ type: 'configureBlockFields', blockId: 'bookshelf', fieldIds: ['book-title'] }], 'missing').ok, true)
  assert.equal(calls, 1)
})

test('structural batches undo atomically with monotonic revision; duplicate undo does not publish', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  execute(runtime, [addNote, { type: 'configureBlockFields', blockId: 'bookshelf', fieldIds: ['book-title', 'note'] }])
  let calls = 0
  runtime.subscribe(() => calls++)
  const request = { requestId: 'undo-1', baseRevision: 1, commands: [{ type: 'undo' }] }
  assert.equal(runtime.executeCommand(request).ok, true)
  assert.equal(runtime.getSnapshot().revision, 2)
  assert.equal(runtime.getSnapshot().spec.entities[0].fields.some(f => f.id === 'note'), false)
  assert.equal(runtime.canUndo(), false)
  const before = runtime.getSnapshot()
  assert.equal(runtime.executeCommand(request).duplicate, true)
  assert.equal(execute(runtime, [{ type: 'undo' }], 'undo-empty').error.code, 'NOTHING_TO_UNDO')
  assert.strictEqual(runtime.getSnapshot(), before)
  assert.equal(calls, 1)
})

test('every successful record operation fences old full-state history, including legacy dispatch', () => {
  for (const change of [
    { type: 'create', entityId: 'books', record: { id: 'new-book', values: { 'book-title': '新增', note: '保留' } } },
    { type: 'update', entityId: 'books', recordId: 'book-001', values: { 'book-title': '修改', note: '保留' } },
    { type: 'delete', entityId: 'books', recordId: 'book-001' },
  ]) {
    const runtime = createAppRuntime(createReadingLogExample())
    execute(runtime, [addNote])
    runtime.dispatch(change)
    assert.equal(runtime.canUndo(), false)
    const before = runtime.getSnapshot()
    assert.equal(execute(runtime, [{ type: 'undo' }], 'unsafe-undo').error.code, 'NOTHING_TO_UNDO')
    assert.strictEqual(runtime.getSnapshot(), before)
    // A new structural operation is undoable back to the latest data baseline.
    execute(runtime, [{ type: 'removeBlock', blockId: 'bookshelf' }], 'remove-list')
    assert.equal(execute(runtime, [{ type: 'undo' }], 'safe-undo').ok, true)
    assert.deepEqual(runtime.getSnapshot().records, before.records)
    assert.deepEqual(runtime.getSnapshot().spec, before.spec)
  }
})

test('layout fences history, never changes records/bindings, and survives later structural undo', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  execute(runtime, [addNote])
  const initial = runtime.getSnapshot()
  const position = { x: 0.4, y: 0.6 }
  runtime.moveBlock('bookshelf', position)
  position.x = 1
  assert.equal(runtime.canUndo(), false)
  assert.deepEqual(runtime.getSnapshot().records, initial.records)
  assert.deepEqual(runtime.getSnapshot().spec.relations, initial.spec.relations)
  execute(runtime, [{ type: 'removeBlock', blockId: 'bookshelf' }], 'remove')
  execute(runtime, [{ type: 'undo' }], 'undo')
  assert.deepEqual(runtime.getSnapshot().blockPositions.bookshelf, { x: 0.4, y: 0.6 })
  assert.ok(Object.isFrozen(runtime.getSnapshot().spec.entities[0].fields))
})

test('revision exhaustion rejects all write paths without a notification', () => {
  const initial = createReadingLogExample()
  initial.revision = Number.MAX_SAFE_INTEGER
  const runtime = createAppRuntime(initial)
  const before = runtime.getSnapshot()
  let calls = 0
  runtime.subscribe(() => calls++)
  assert.equal(execute(runtime, [addNote]).ok, false)
  assert.equal(runtime.moveBlock('bookshelf', { x: 0, y: 0 }).ok, false)
  assert.equal(runtime.updateRecords({ type: 'delete', entityId: 'books', recordId: 'book-001' }).ok, false)
  assert.strictEqual(runtime.getSnapshot(), before)
  assert.equal(calls, 0)
})
