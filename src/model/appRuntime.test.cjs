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
