'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { setup: customFixture, createAppRuntime } = require('../custom-block/fixtures.cjs')
const { createAppChangePlanner } = require('../../src/model/appChangePlan.ts')
const { metricValue } = require('../../src/model/appRuntime.ts')
const { projectBuiltinChange } = require('../../src/model/appProjectCommands.ts')
let sequence = 0
const gallery = id => ({ id, name: '图片', type: 'gallery', protocolVersion: 1, imageIds: [], layout: 'grid', interaction: 'preview' })
async function setup() {
  const f = await customFixture(), project = f.project
  project.base.spec.version = 2
  project.base.spec.blocks.push(gallery('photos'), { id: 'timer', name: '计时', type: 'pomodoro', protocolVersion: 1, durationSeconds: 600 })
  project.base.assets = { photo: { id: 'photo', name: '图片', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' } }
  project.base.timers = { timer: { remainingMs: 42000, startedAt: null } }
  project.base.blockPositions = { bookshelf: { x: .1, y: .7 }, photos: { x: .2, y: .1 } }
  // Deliberately different from spec.blocks, as a previously dragged project is.
  project.renderOrder = ['photos', 'reading-total', 'bookshelf', 'reading-form', 'reading-history', 'timer'].map(id => ({ kind: 'builtin', id }))
  project.renderOrder.splice(2, 0, { kind: 'custom', id: 'countdown-1' })
  const runtime = createAppRuntime({ revision: project.revision, ...project.base }, [f.entry], project)
  const planner = createAppChangePlanner(runtime)
  const scope = { selectedBlockId: null, allowedBlockIds: project.base.spec.blocks.map(b => b.id), allowedEntityIds: project.base.spec.entities.map(e => e.id) }
  let notifications = 0
  runtime.subscribe(() => notifications++)
  function preview(commands, capabilityIds = [], trusted = scope) {
    const currentScope = trusted === scope ? { ...scope, allowedBlockIds: runtime.getSnapshot().spec.blocks.map(b => b.id) } : trusted
    return planner.preview({ request: { requestId: 'contract-' + (++sequence), baseRevision: runtime.getSnapshot().revision, commands }, capabilityIds }, currentScope)
  }
  return { runtime, planner, scope, preview, notifications: () => notifications }
}
function plan(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.plan }
function reject(result, code) { assert.equal(result.ok, false); if (code) assert.equal(result.error.code, code, result.error.message) }
function content(project) { const result = structuredClone(project); delete result.revision; return result }
function confirm(s, p) { assert.equal(s.planner.confirm(p).ok, true); assert.deepEqual(s.runtime.customProject.getSnapshot(), p.afterProject) }
function undo(s) { return s.runtime.executeCommand({ requestId: 'undo-contract-' + (++sequence), baseRevision: s.runtime.getSnapshot().revision, commands: [{ type: 'undo' }] }) }

test('shared full-project projection implements one isolated atomic four-operation plan', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const commands = [
    { type: 'configureBlockFields', blockId: 'reading-form', fieldIds: ['reading-date', 'minutes'] },
    { type: 'configureGallery', blockId: 'photos', imageIds: ['photo'] },
    { type: 'configureMetric', blockId: 'reading-total', aggregation: 'average', fieldId: 'minutes' },
    { type: 'addBlock', block: gallery('new-photos') },
    { type: 'configureGallery', blockId: 'new-photos', imageIds: ['photo'] },
    { type: 'removeBlock', blockId: 'bookshelf' },
    { type: 'reorderBlocks', blockIds: ['timer', 'new-photos', 'reading-total', 'photos', 'reading-form', 'reading-history'] },
  ]
  const p = plan(s.preview(commands, ['gallery']))
  assert.strictEqual(s.runtime.customProject.getSnapshot(), before)
  assert.equal(s.notifications(), 0); assert.equal(s.runtime.canUndo(), false)
  assert.deepEqual(p.beforeProject, before)
  assert.deepEqual(p.afterProject, projectBuiltinChange(before, p.after, commands))
  assert.deepEqual(p.afterProject.custom, before.custom)
  assert.deepEqual(p.afterProject.base.assets, before.base.assets)
  assert.deepEqual(p.afterProject.base.records, before.base.records)
  assert.deepEqual(p.afterProject.renderOrder, [
    { kind: 'builtin', id: 'timer' }, { kind: 'builtin', id: 'new-photos' }, { kind: 'custom', id: 'countdown-1' },
    ...['reading-total', 'photos', 'reading-form', 'reading-history'].map(id => ({ kind: 'builtin', id })),
  ])
  assert.deepEqual(p.diff.orderChanges, { before: before.renderOrder, after: p.afterProject.renderOrder })
  assert.deepEqual(p.diff.metricChanges, [{ blockId: 'reading-total', before: { aggregation: 'sum', fieldId: 'minutes' }, after: { aggregation: 'average', fieldId: 'minutes' } }])
  assert.deepEqual(p.diff.blockFieldChanges.map(x => x.blockId), ['reading-form'])
  assert.deepEqual(p.diff.galleryChanges.map(x => x.blockId), ['photos'])
  assert.deepEqual(p.diff.addedBlocks.map(x => x.id), ['new-photos'])
  assert.deepEqual(p.diff.removedBlocks.map(x => x.id), ['bookshelf'])
  confirm(s, p); assert.equal(s.notifications(), 1)
  assert.equal(metricValue(s.runtime.getSnapshot(), s.runtime.getSnapshot().spec.blocks.find(b => b.id === 'reading-total')), 30)
  assert.equal(s.planner.confirm(p).duplicate, true); assert.equal(s.notifications(), 1)
  assert.equal(undo(s).ok, true)
  assert.deepEqual(content(s.runtime.customProject.getSnapshot()), content(before))
  assert.equal(s.runtime.getSnapshot().revision, 2); assert.equal(s.runtime.canUndo(), false)
})

test('metric aggregation switches count/sum/average, removing stale fieldId on count', async () => {
  const s = await setup()
  for (const [aggregation, value] of [['count', 1], ['sum', 30], ['average', 30], ['count', 1]]) {
    const command = { type: 'configureMetric', blockId: 'reading-total', aggregation, ...(aggregation === 'count' ? {} : { fieldId: 'minutes' }) }
    const p = plan(s.preview([command])); confirm(s, p)
    const block = s.runtime.getSnapshot().spec.blocks.find(b => b.id === 'reading-total')
    assert.equal(metricValue(s.runtime.getSnapshot(), block), value)
    assert.equal(Object.hasOwn(block, 'fieldId'), aggregation !== 'count')
  }
})

test('metric can be added and configured in the same transaction with a later added field', async () => {
  const s = await setup(), p = plan(s.preview([
    { type: 'addBlock', block: { id: 'new-metric', name: '统计', type: 'metric', aggregation: 'count' }, binding: { id: 'new-binding', type: 'dataBinding', blockId: 'new-metric', entityId: 'reading-sessions' } },
    { type: 'addField', entityId: 'reading-sessions', field: { id: 'score', name: '评分', type: 'number', required: false } },
    { type: 'configureMetric', blockId: 'new-metric', aggregation: 'average', fieldId: 'score' },
  ], ['metric-count']))
  confirm(s, p)
  assert.equal(metricValue(s.runtime.getSnapshot(), s.runtime.getSnapshot().spec.blocks.find(b => b.id === 'new-metric')), 0)
})

for (const [name, command] of [
  ['text field', { type: 'configureMetric', blockId: 'reading-total', aggregation: 'sum', fieldId: 'notes' }],
  ['field on another entity', { type: 'configureMetric', blockId: 'reading-total', aggregation: 'sum', fieldId: 'book-title' }],
  ['count carrying fieldId', { type: 'configureMetric', blockId: 'reading-total', aggregation: 'count', fieldId: 'minutes' }],
  ['missing sum field', { type: 'configureMetric', blockId: 'reading-total', aggregation: 'sum' }],
  ['non-metric target', { type: 'configureMetric', blockId: 'reading-form', aggregation: 'count' }],
  ['unknown aggregation', { type: 'configureMetric', blockId: 'reading-total', aggregation: 'median', fieldId: 'minutes' }],
]) test('illegal metric: ' + name + ' never leaves partial schema/configuration changes', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const commands = [{ type: 'addField', entityId: 'reading-sessions', field: { id: 'new-number', name: '新数值', type: 'number', required: false } }, command]
  reject(s.preview(commands))
  reject(s.runtime.executeCommand({ requestId: 'invalid-metric-' + (++sequence), baseRevision: 0, commands }))
  assert.strictEqual(s.runtime.customProject.getSnapshot(), before)
  assert.equal(s.notifications(), 0); assert.equal(s.runtime.canUndo(), false)
})

test('reorder is a full unique builtin permutation and cannot reorder unscoped siblings', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const current = before.renderOrder.filter(x => x.kind === 'builtin').map(x => x.id)
  for (const blockIds of [current.slice(1), [...current, 'unknown'], current.map((id, i) => i === 1 ? current[0] : id), current.map((id, i) => i === 1 ? 'unknown' : id)]) {
    reject(s.preview([{ type: 'reorderBlocks', blockIds }]))
    reject(s.runtime.executeCommand({ requestId: 'invalid-order-' + (++sequence), baseRevision: 0, commands: [{ type: 'reorderBlocks', blockIds }] }))
    assert.strictEqual(s.runtime.customProject.getSnapshot(), before)
  }
  const scope = { selectedBlockId: 'photos', allowedBlockIds: ['photos'], allowedEntityIds: [] }
  const unauthorized = [...current]; [unauthorized[1], unauthorized[2]] = [unauthorized[2], unauthorized[1]]
  reject(s.preview([{ type: 'reorderBlocks', blockIds: unauthorized }], [], scope), 'SCOPE_VIOLATION')
  const authorized = [...current.slice(1), 'photos']
  const p = plan(s.preview([{ type: 'reorderBlocks', blockIds: authorized }], [], scope))
  confirm(s, p)
  assert.deepEqual(s.runtime.customProject.getSnapshot().renderOrder.filter(x => x.kind === 'builtin').map(x => x.id), authorized)
})

test('reordering an already dragged project can be an actual no-op despite different spec order', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const p = plan(s.preview([{ type: 'reorderBlocks', blockIds: before.renderOrder.filter(x => x.kind === 'builtin').map(x => x.id) }]))
  assert.equal(p.diff.orderChanges, null)
  confirm(s, p)
  assert.deepEqual(s.runtime.customProject.getSnapshot().renderOrder, before.renderOrder)
})

test('positioned additions cannot implicitly reorder siblings or move retained custom slots', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const scope = { selectedBlockId: 'photos', allowedBlockIds: ['photos'], allowedEntityIds: [] }
  const p = plan(s.preview([{ type: 'addBlock', block: gallery('placed-gallery'), position: { x: .05, y: 0 } }], ['gallery'], scope))
  assert.deepEqual(p.afterProject.renderOrder, [...before.renderOrder, { kind: 'builtin', id: 'placed-gallery' }])
  assert.deepEqual(p.afterProject.base.blockPositions['placed-gallery'], { x: .05, y: 0 })
  confirm(s, p)
  assert.equal(undo(s).ok, true)
  assert.deepEqual(content(s.runtime.customProject.getSnapshot()), content(before))
  // A subsequent explicit manual drag still establishes coordinate reading order.
  assert.equal(s.runtime.moveBlock('photos', { x: .05, y: .95 }).ok, true)
  const afterDrag = s.runtime.customProject.getSnapshot()
  assert.equal(afterDrag.renderOrder[afterDrag.renderOrder.length - 1].id, 'photos')
})

test('multiple atomic commits undo complete mixed projects in reverse order', async () => {
  const s = await setup(), original = s.runtime.customProject.getSnapshot()
  confirm(s, plan(s.preview([{ type: 'removeBlock', blockId: 'bookshelf' }])))
  const first = s.runtime.customProject.getSnapshot()
  confirm(s, plan(s.preview([{ type: 'configureMetric', blockId: 'reading-total', aggregation: 'count' }])))
  assert.equal(undo(s).ok, true); assert.deepEqual(content(s.runtime.customProject.getSnapshot()), content(first))
  assert.equal(undo(s).ok, true); assert.deepEqual(content(s.runtime.customProject.getSnapshot()), content(original))
  assert.equal(s.runtime.getSnapshot().revision, 4)
  const final = s.runtime.customProject.getSnapshot(); reject(undo(s), 'NOTHING_TO_UNDO')
  assert.strictEqual(s.runtime.customProject.getSnapshot(), final)
})

test('failed confirmation does not consume runtime history or receipt and cannot auto-retry', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const p = plan(s.preview([{ type: 'configureMetric', blockId: 'reading-total', aggregation: 'count' }]))
  s.runtime.customProject.setReadOnly(true)
  reject(s.planner.confirm(p), 'READ_ONLY')
  assert.strictEqual(s.runtime.customProject.getSnapshot(), before); assert.equal(s.runtime.canUndo(), false)
  s.runtime.customProject.setReadOnly(false)
  reject(s.planner.confirm(p), 'PLAN_NOT_PENDING')
  const retry = s.runtime.executeCommand(p.request)
  assert.equal(retry.ok, true); assert.equal(retry.duplicate, false)
  assert.equal(undo(s).ok, true); assert.deepEqual(content(s.runtime.customProject.getSnapshot()), content(before))
})

test('revoked authorization after preview rejects even after read-only is restored', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const p = plan(s.preview([{ type: 'configureGallery', blockId: 'photos', imageIds: ['photo'] }]))
  s.runtime.customProject.setReadOnly(true); s.runtime.customProject.setReadOnly(false)
  reject(s.planner.confirm(p), 'AUTHORIZATION_CHANGED')
  assert.strictEqual(s.runtime.customProject.getSnapshot(), before); assert.equal(s.runtime.canUndo(), false)
})

test('stale project and unknown targets fail without overwriting later project state', async () => {
  const s = await setup(), p = plan(s.preview([{ type: 'configureMetric', blockId: 'reading-total', aggregation: 'count' }]))
  assert.equal(s.runtime.moveBlock('photos', { x: .4, y: .8 }).ok, true)
  const later = s.runtime.customProject.getSnapshot()
  reject(s.planner.confirm(p), 'REVISION_CONFLICT')
  reject(s.preview([{ type: 'removeBlock', blockId: 'missing' }]))
  assert.strictEqual(s.runtime.customProject.getSnapshot(), later)
})

test('custom ID collision fails both preview and execution without consuming request ID', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const commands = [{ type: 'addBlock', block: gallery('countdown-1') }]
  reject(s.preview(commands, ['gallery']), 'INVALID_TARGET')
  const requestId = 'collision-' + (++sequence)
  reject(s.runtime.executeCommand({ requestId, baseRevision: 0, commands }))
  assert.strictEqual(s.runtime.customProject.getSnapshot(), before); assert.equal(s.runtime.canUndo(), false)
  const result = s.runtime.executeCommand({ requestId, baseRevision: 0, commands: [{ type: 'configureMetric', blockId: 'reading-total', aggregation: 'count' }] })
  assert.equal(result.ok, true); assert.equal(result.duplicate, false)
})

test('pomodoro may remain in scope and order, while direct AI edits remain forbidden', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  for (const commands of [
    [{ type: 'removeBlock', blockId: 'timer' }],
    [{ type: 'configureBlockPresentation', blockId: 'timer', presentation: { textColor: '#222222' } }],
    [{ type: 'addBlock', block: { id: 'new-timer', type: 'pomodoro', name: '新计时', protocolVersion: 1, durationSeconds: 60 } }],
  ]) reject(s.preview(commands, commands[0].type === 'addBlock' ? ['pomodoro'] : []), 'AI_COMMAND_FORBIDDEN')
  assert.strictEqual(s.runtime.customProject.getSnapshot(), before)
  confirm(s, plan(s.preview([{ type: 'configureGallery', blockId: 'photos', imageIds: ['photo'] }])))
  assert.deepEqual(s.runtime.getSnapshot().timers, before.base.timers)
})

test('full project preview is deeply immutable, including retained custom instance state', async () => {
  const s = await setup(), p = plan(s.preview([{ type: 'configureMetric', blockId: 'reading-total', aggregation: 'count' }]))
  assert.throws(() => { p.afterProject.custom.states['countdown-1'].value.remainingSeconds = 1 }, TypeError)
  assert.throws(() => { p.afterProject.renderOrder[0].id = 'changed' }, TypeError)
  confirm(s, p)
  assert.equal(s.runtime.customProject.getSnapshot().custom.states['countdown-1'].value.remainingSeconds, 600)
})
