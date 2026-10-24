const test = require('node:test'), assert = require('node:assert/strict')
const { api, createAppRuntime, assertProjectState, copy } = require('../custom-block/fixtures.cjs')
const { interactiveFixture } = require('./fixture.ts')
const { visibleRecords, chartPoints, selectedRecord } = require('../../src/model/appInteractions.ts')
const { metricValue } = require('../../src/model/appRuntime.ts')
const { createCommandSession, processCommand } = require('../../src/model/appCommands.ts')
const { createProjectPackage, parseProjectPackage } = require('../../src/integrations/project-package/format.ts')
const emptyRegistry = { async resolve() { return undefined } }
const empty = () => ({ filters: {}, chartSelections: {}, records: {} })
const block = (state, id) => state.spec.blocks.find(b => b.id === id)
const ids = (runtime, id) => visibleRecords(runtime.getSnapshot(), runtime.getInteractionSnapshot(), id).map(r => r.id)
let sequence = 0
const execute = (runtime, commands) => runtime.executeCommand({ requestId: 'request-' + ++sequence, baseRevision: runtime.getSnapshot().revision, commands })
const content = state => { const next = copy(state); delete next.revision; return next }

test('strict new schemas reject code, unknown fields, wrong values, missing/cross-entity/self/unsupported references', () => {
  assert.doesNotThrow(() => assertProjectState(interactiveFixture()))
  const mutations = [
    s => block(s, 'search').onChange = 'fetch(secret)',
    s => block(s, 'search').fieldIds = [],
    s => block(s, 'search').fieldIds.push('department'),
    s => block(s, 'search').targetBlockIds = [],
    s => block(s, 'search').targetBlockIds = ['registration-form'],
    s => block(s, 'search').targetBlockIds = ['search'],
    s => block(s, 'search').targetBlockIds = ['missing'],
    s => block(s, 'groups').targetBlockIds = ['search'],
    s => block(s, 'groups').targetBlockIds = ['groups'],
    s => block(s, 'groups').chartType = 'pie',
    s => block(s, 'groups').aggregation = 'script',
    s => block(s, 'groups').valueFieldId = 'quantity',
    s => Object.assign(block(s, 'groups'), { aggregation: 'sum', valueFieldId: 'department' }),
    s => block(s, 'groups').aggregation = 'average',
    s => block(s, 'groups').groupFieldId = 'missing',
    s => block(s, 'details').sourceBlockId = 'groups',
    s => block(s, 'details').fieldIds = ['missing'],
    s => s.spec.relations = s.spec.relations.filter(r => r.blockId !== 'search'),
    s => { s.spec.entities.push({ id: 'other', name: '另一对象', fields: [] }); s.spec.relations.find(r => r.blockId === 'applicant-total').entityId = 'other' },
    s => { s.spec.entities.push({ id: 'other', name: '另一对象', fields: [] }); block(s, 'applicant-list').fieldIds = ['other-field']; s.spec.entities[1].fields.push({ id: 'other-field', name: '其他字段', type: 'text', required: false }); s.spec.relations.find(r => r.blockId === 'applicant-list').entityId = 'other' },
  ]
  for (const [i, mutate] of mutations.entries()) { const state = interactiveFixture(); mutate(state); assert.throws(() => assertProjectState(state), undefined, 'case ' + i) }
})

test('search/exact filters AND together, preserve false/zero, and affect only declared targets', () => {
  const runtime = createAppRuntime(interactiveFixture()), before = runtime.getSnapshot()
  assert.equal(runtime.interact({ type: 'filter', blockId: 'search', query: ' ALICE ', values: { available: false } }).ok, true)
  assert.deepEqual(ids(runtime, 'applicant-list'), ['row-c'])
  assert.equal(metricValue(before, block(before, 'applicant-total'), visibleRecords(before, runtime.getInteractionSnapshot(), 'applicant-total')), 1)
  assert.equal(ids(runtime, 'unfiltered').length, 4)
  runtime.interact({ type: 'filter', blockId: 'search', query: '', values: { available: false, quantity: 0 } })
  assert.deepEqual(ids(runtime, 'applicant-list'), ['row-b'])
  assert.equal(runtime.getSnapshot(), before)
  assert.equal(runtime.canUndo(), false)
  assert.ok(Object.isFrozen(runtime.getInteractionSnapshot().filters.search.values))
  runtime.interact({ type: 'filter', blockId: 'search', query: '', values: { joined: '2026-10-24' } })
  assert.deepEqual(ids(runtime, 'applicant-list'), ['row-a'])
  runtime.interact({ type: 'filter', blockId: 'search', query: '', values: {} })
  assert.equal(ids(runtime, 'applicant-list').length, 4)
})

test('invalid interactions never mutate project or view', () => {
  const runtime = createAppRuntime(interactiveFixture()), project = runtime.getSnapshot(), view = runtime.getInteractionSnapshot()
  for (const action of [
    { type: 'filter', blockId: 'search', query: '', values: { unknown: 'x' } },
    { type: 'filter', blockId: 'search', query: '', values: { available: 'false' } },
    { type: 'filter', blockId: 'search', query: '', values: { quantity: Infinity } },
    { type: 'filter', blockId: 'search', query: '', values: { department: '不存在' } },
    { type: 'filter', blockId: 'search', query: '', values: { joined: '2026-02-30' } },
    { type: 'filter', blockId: 'search', query: 'x'.repeat(201), values: {} },
    { type: 'filter', blockId: 'search', query: '', values: {}, script: 'x' },
    { type: 'filter', blockId: 'applicant-list', query: '', values: {} },
    { type: 'chartSelect', blockId: 'groups', value: '不存在' },
    { type: 'selectRecord', blockId: 'applicant-list', recordId: 'missing' },
    { type: 'selectRecord', blockId: 'details', recordId: 'row-a' },
    { type: 'unknown', blockId: 'search' }, null,
  ]) {
    assert.equal(runtime.interact(action).ok, false, JSON.stringify(action))
    assert.equal(runtime.getSnapshot(), project); assert.equal(runtime.getInteractionSnapshot(), view)
  }
})

test('chart count/sum/average use real records; missing values, negatives, numeric category order and empty results', () => {
  const state = interactiveFixture(), view = empty(), chart = block(state, 'groups')
  assert.deepEqual(Object.fromEntries(chartPoints(state, view, chart).map(p => [p.label, p.value])), { 宣传部: 1, 技术部: 2, 策划部: 1 })
  chart.aggregation = 'sum'; chart.valueFieldId = 'quantity'
  assert.deepEqual(Object.fromEntries(chartPoints(state, view, chart).map(p => [p.label, p.value])), { 宣传部: 0, 技术部: 10, 策划部: 0 })
  chart.aggregation = 'average'
  assert.equal(chartPoints(state, view, chart).find(p => p.label === '技术部').value, 5)
  chart.groupFieldId = 'quantity'; chart.aggregation = 'count'; delete chart.valueFieldId
  assert.deepEqual(chartPoints(state, view, chart).map(p => p.category), [-2, 0, 12])
  view.filters.search = { query: 'missing', values: {} }
  assert.deepEqual(chartPoints(state, view, chart), [])
})

test('filter → chart → explicit list/metric and list → details work with live data and clear controls', () => {
  const runtime = createAppRuntime(interactiveFixture()), state = runtime.getSnapshot(), chart = block(state, 'groups'), details = block(state, 'details')
  assert.equal(runtime.interact({ type: 'chartSelect', blockId: 'groups', value: '技术部' }).ok, true)
  assert.deepEqual(ids(runtime, 'applicant-list'), ['row-a', 'row-c'])
  assert.equal(ids(runtime, 'unfiltered').length, 4)
  assert.equal(chartPoints(state, runtime.getInteractionSnapshot(), chart).length, 3, 'chart does not filter itself')
  assert.equal(runtime.interact({ type: 'selectRecord', blockId: 'applicant-list', recordId: 'row-a' }).ok, true)
  assert.equal(selectedRecord(state, runtime.getInteractionSnapshot(), details).id, 'row-a')
  assert.equal(runtime.interact({ type: 'selectRecord', blockId: 'applicant-list', recordId: 'row-b' }).ok, false)
  runtime.interact({ type: 'filter', blockId: 'search', query: 'Alice', values: {} })
  assert.equal(selectedRecord(state, runtime.getInteractionSnapshot(), details), undefined)
  assert.deepEqual(chartPoints(state, runtime.getInteractionSnapshot(), chart).map(p => p.value), [1])
  runtime.interact({ type: 'filter', blockId: 'search', query: '', values: {} })
  const view = runtime.getInteractionSnapshot()
  runtime.dispatch({ type: 'delete', entityId: 'applicants', recordId: 'row-a' })
  assert.equal(runtime.getInteractionSnapshot(), view, 'data change retains session view')
  assert.equal(selectedRecord(runtime.getSnapshot(), view, details), undefined)
  assert.deepEqual(ids(runtime, 'applicant-list'), ['row-c'])
  runtime.interact({ type: 'chartSelect', blockId: 'groups', value: null })
  runtime.interact({ type: 'selectRecord', blockId: 'applicant-list', recordId: null })
  assert.equal(ids(runtime, 'applicant-list').length, 3)
})

test('configure/add/remove/reorder are pure-previewable, atomic, idempotent, undoable and revision-checked', () => {
  const initial = interactiveFixture(), runtime = createAppRuntime(initial), session = createCommandSession(initial)
  const updated = { ...block(initial, 'groups'), chartType: 'line', aggregation: 'sum', valueFieldId: 'quantity' }
  const request = { requestId: 'preview', baseRevision: initial.revision, commands: [{ type: 'configureView', blockId: 'groups', block: updated }] }
  const preview = processCommand(session, request)
  assert.equal(preview.ok, true); assert.deepEqual(session.state, initial); assert.deepEqual(runtime.getSnapshot(), initial)
  assert.equal(runtime.executeCommand(request).ok, true)
  assert.deepEqual(runtime.getSnapshot(), preview.session.state)
  assert.equal(runtime.executeCommand(request).duplicate, true)
  const applied = runtime.getSnapshot()
  assert.equal(runtime.executeCommand({ ...request, requestId: 'stale' }).error.code, 'REVISION_CONFLICT')
  assert.equal(runtime.getSnapshot(), applied)
  for (const commands of [
    [{ type: 'configureView', blockId: 'groups', block: { ...updated, targetBlockIds: ['details'] } }],
    [{ type: 'configureView', blockId: 'groups', block: { ...updated, id: 'different' } }],
    [{ type: 'configureView', blockId: 'details', block: { ...updated, id: 'details' } }],
    [{ type: 'configureView', blockId: 'groups', block: { ...updated, name: '暂存修改' } }, { type: 'removeBlock', blockId: 'applicant-list' }],
  ]) { assert.equal(execute(runtime, commands).ok, false); assert.equal(runtime.getSnapshot(), applied) }
  assert.equal(execute(runtime, [{ type: 'undo' }]).ok, true)
  assert.deepEqual(content(runtime.getSnapshot()), content(initial))
  for (const type of ['filter', 'chart', 'details']) {
    const added = { ...block(initial, { filter: 'search', chart: 'groups', details: 'details' }[type]), id: 'extra-' + type }
    assert.equal(execute(runtime, [{ type: 'addBlock', block: added, binding: { id: 'extra-binding-' + type, type: 'dataBinding', blockId: added.id, entityId: 'applicants' } }]).ok, true)
    assert.equal(execute(runtime, [{ type: 'removeBlock', blockId: added.id }]).ok, true)
    assert.equal(execute(runtime, [{ type: 'undo' }]).ok, true)
    assert.ok(block(runtime.getSnapshot(), added.id))
    assert.equal(execute(runtime, [{ type: 'undo' }]).ok, true)
    assert.equal(block(runtime.getSnapshot(), added.id), undefined)
  }
  const order = runtime.getSnapshot().spec.blocks.map(b => b.id).reverse()
  assert.equal(execute(runtime, [{ type: 'reorderBlocks', blockIds: order }]).ok, true)
  assert.deepEqual(runtime.customProject.getSnapshot().renderOrder.map(b => b.id), order)
  assert.equal(execute(runtime, [{ type: 'undo' }]).ok, true)
  assert.deepEqual(content(runtime.getSnapshot()), content(initial))
})

test('schema edits reset session view; session interactions preserve structural undo; write permissions remain enforced', () => {
  const runtime = createAppRuntime(interactiveFixture()), current = runtime.getSnapshot()
  execute(runtime, [{ type: 'configureView', blockId: 'groups', block: { ...block(current, 'groups'), chartType: 'line' } }])
  runtime.interact({ type: 'filter', blockId: 'search', query: 'Alice', values: {} })
  assert.equal(runtime.canUndo(), true)
  assert.equal(execute(runtime, [{ type: 'undo' }]).ok, true)
  assert.deepEqual(runtime.getInteractionSnapshot(), empty())
  runtime.customProject.setReadOnly(true)
  const before = runtime.getSnapshot()
  assert.equal(execute(runtime, [{ type: 'configureView', blockId: 'groups', block: { ...block(before, 'groups'), chartType: 'line' } }]).ok, false)
  assert.equal(runtime.getSnapshot(), before)
  assert.equal(runtime.interact({ type: 'filter', blockId: 'search', query: 'Alice', values: {} }).ok, true, 'viewing is allowed in read-only mode')
})

test('field removal detects references in every new type before modifying state', () => {
  const state = interactiveFixture()
  state.records.applicants = []
  state.spec.blocks = state.spec.blocks.filter(b => !['registration-form', 'applicant-list', 'details'].includes(b.id))
  block(state, 'groups').targetBlockIds = ['applicant-total']
  block(state, 'search').targetBlockIds = ['applicant-total', 'groups']
  state.spec.relations = state.spec.relations.filter(r => state.spec.blocks.some(b => b.id === r.blockId))
  const runtime = createAppRuntime(state), before = runtime.getSnapshot()
  assert.equal(execute(runtime, [{ type: 'removeField', entityId: 'applicants', fieldId: 'department' }]).error.code, 'FIELD_REFERENCED')
  assert.equal(runtime.getSnapshot(), before)
})

test('project ZIP retains all new config, images, records, positions and order; session-only selections reset', async () => {
  const runtime = createAppRuntime(interactiveFixture())
  execute(runtime, [{ type: 'configureView', blockId: 'groups', block: { ...block(runtime.getSnapshot(), 'groups'), aggregation: 'average', valueFieldId: 'quantity', chartType: 'line' } }])
  execute(runtime, [{ type: 'reorderBlocks', blockIds: runtime.getSnapshot().spec.blocks.map(b => b.id).reverse() }])
  runtime.moveBlock('search', { x: .2, y: .3 })
  runtime.interact({ type: 'filter', blockId: 'search', query: 'Alice', values: {} })
  const project = runtime.customProject.getSnapshot()
  const bytes = await createProjectPackage(project, emptyRegistry)
  const restored = await parseProjectPackage(bytes)
  assert.deepEqual(restored.project, project)
  const next = createAppRuntime(restored.base, restored.artifacts, restored.project)
  assert.deepEqual(next.getInteractionSnapshot(), empty())
  assert.equal(next.interact({ type: 'chartSelect', blockId: 'groups', value: '技术部' }).ok, true)
  assert.deepEqual(ids(next, 'applicant-list'), ['row-a', 'row-c'])
  assert.equal(next.getSnapshot().assets['fixture-png'].dataUrl, runtime.getSnapshot().assets['fixture-png'].dataUrl)
})
