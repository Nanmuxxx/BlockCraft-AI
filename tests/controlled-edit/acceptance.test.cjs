// Production Planner/Runtime/Owner/ZIP acceptance. No source-regex or network.
const test = require('node:test')
const assert = require('node:assert/strict')
const { api, artifact, createAppRuntime } = require('../custom-block/fixtures.cjs')
const { makeGalleryState, pngBytes } = require('../project-package/fixtures.cjs')
const { createAppChangePlanner } = require('../../src/model/appChangePlan.ts')
const { metricValue } = require('../../src/model/appRuntime.ts')
const { createProjectPackage, parseProjectPackage } = require('../../src/integrations/project-package/format.ts')
const { decodePackageZip } = require('../../src/integrations/project-package/zip.ts')
async function setup() {
  const state = makeGalleryState()
  state.spec.entities[0].fields.push({ id: 'quantity', name: '数量', type: 'number', required: false })
  state.records.applicants[0].values.quantity = 12
  const project = api.migrateProjectState(state)
  const source = artifact(), versionDigest = await api.computeVersionDigest(source)
  const entry = { artifact: source, versionDigest }
  project.custom.instances.push({ id: 'retained-custom', definitionId: source.manifest.definitionId, versionDigest, props: { durationSeconds: 600 } })
  project.custom.states['retained-custom'] = { versionDigest, stateRevision: 4, value: { remainingSeconds: 480, status: 'paused' } }
  project.custom.positions['retained-custom'] = { x: .35, y: .4 }
  project.renderOrder.splice(1, 0, { kind: 'custom', id: 'retained-custom' })
  const runtime = createAppRuntime(state, [entry], project)
  return { runtime, planner: createAppChangePlanner(runtime) }
}
function scope(runtime, selectedBlockId) {
  const state = runtime.getSnapshot(), relation = state.spec.relations.find(item => item.blockId === selectedBlockId)
  return { selectedBlockId, allowedBlockIds: [selectedBlockId], allowedEntityIds: relation ? [relation.entityId] : [] }
}
let sequence = 0
function preview(s, selected, commands, capabilityIds = []) {
  return s.planner.preview({ request: { requestId: 'acceptance-' + (++sequence), baseRevision: s.runtime.getSnapshot().revision, commands }, capabilityIds }, scope(s.runtime, selected))
}
function withoutRevision(project) { const next = structuredClone(project); delete next.revision; return next }
function expectPreview(s, result, before) {
  assert.equal(result.ok, true, JSON.stringify(result.error))
  assert.deepEqual(s.runtime.customProject.getSnapshot(), before, 'preview must not mutate current project')
  assert.deepEqual(result.plan.beforeProject, before, 'preview owns the complete original mixed project')
  return result.plan
}
function confirm(s, plan) {
  assert.equal(s.planner.confirm(plan).ok, true)
  assert.deepEqual(s.runtime.customProject.getSnapshot(), plan.afterProject, 'confirmation equals complete deterministic preview')
}
function undo(s, before) {
  const revision = s.runtime.getSnapshot().revision
  assert.equal(s.runtime.executeCommand({ requestId: 'undo-' + (++sequence), baseRevision: revision, commands: [{ type: 'undo' }] }).ok, true)
  assert.deepEqual(withoutRevision(s.runtime.customProject.getSnapshot()), withoutRevision(before), 'undo restores assets/custom/positions/mixed slots')
  assert.equal(s.runtime.getSnapshot().revision, revision + 1)
}
for (const [name, selected, commands, check] of [
  ['form configuration', 'registration-form', [{ type: 'configureBlockPresentation', blockId: 'registration-form', presentation: { buttonText: '确认登记', backgroundColor: '#E9F3EF' } }], state => assert.equal(state.spec.blocks.find(b => b.id === 'registration-form').presentation.buttonText, '确认登记')],
  ['gallery configuration', 'package-gallery', [{ type: 'configureGallery', blockId: 'package-gallery', imageIds: [], layout: 'grid' }], state => assert.deepEqual(state.spec.blocks.find(b => b.id === 'package-gallery').imageIds, [])],
  ['metric extension', 'applicant-total', [{ type: 'configureMetric', blockId: 'applicant-total', aggregation: 'sum', fieldId: 'quantity' }], state => assert.equal(metricValue(state, state.spec.blocks.find(b => b.id === 'applicant-total')), 12)],
]) test(name + ': isolated preview, exact confirmation, complete undo', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const plan = expectPreview(s, preview(s, selected, commands), before)
  confirm(s, plan); check(s.runtime.getSnapshot())
  assert.equal(s.planner.confirm(plan).duplicate, true)
  assert.deepEqual(s.runtime.customProject.getSnapshot(), plan.afterProject)
  undo(s, before)
})
test('add/remove/reorder preserve custom slots and support full undo', async () => {
  const s = await setup()
  for (const [selected, commands, capabilities] of [
    ['package-gallery', [{ type: 'addBlock', block: { id: 'new-gallery', name: '新图库', type: 'gallery', protocolVersion: 1, imageIds: ['fixture-png'], layout: 'grid', interaction: 'preview' }, position: { x: .4, y: .6 } }], ['gallery']],
    ['applicant-list', [{ type: 'removeBlock', blockId: 'applicant-list' }], []],
    ['package-gallery', [{ type: 'reorderBlocks', blockIds: ['package-gallery', 'registration-form', 'applicant-list', 'applicant-total', 'package-timer'] }], []],
  ]) {
    const before = s.runtime.customProject.getSnapshot(), plan = expectPreview(s, preview(s, selected, commands, capabilities), before)
    confirm(s, plan)
    if (commands[0].type === 'reorderBlocks') {
      assert.deepEqual(s.runtime.customProject.getSnapshot().renderOrder, [
        { kind: 'builtin', id: 'package-gallery' }, { kind: 'custom', id: 'retained-custom' },
        ...['registration-form', 'applicant-list', 'applicant-total', 'package-timer'].map(id => ({ kind: 'builtin', id })),
      ])
      assert.ok(plan.diff.orderChanges)
    }
    undo(s, before)
  }
})
test('stale and missing targets reject without overwriting a later user change', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const plan = expectPreview(s, preview(s, 'package-gallery', [{ type: 'configureGallery', blockId: 'package-gallery', imageIds: [] }]), before)
  assert.equal(s.runtime.executeCommand({ requestId: 'external-delete', baseRevision: before.revision, commands: [{ type: 'removeBlock', blockId: 'package-gallery' }] }).ok, true)
  const changed = s.runtime.customProject.getSnapshot()
  assert.equal(s.planner.confirm(plan).ok, false)
  assert.deepEqual(s.runtime.customProject.getSnapshot(), changed)
  assert.equal(preview(s, 'registration-form', [{ type: 'removeBlock', blockId: 'missing-block' }]).ok, false)
  assert.deepEqual(s.runtime.customProject.getSnapshot(), changed)
})
for (const [name, selected, commands] of [
  ['invalid gallery asset', 'package-gallery', [{ type: 'configureBlockPresentation', blockId: 'package-gallery', presentation: { borderRadius: 8 } }, { type: 'configureGallery', blockId: 'package-gallery', imageIds: ['missing-image'] }]],
  ['invalid metric field', 'applicant-total', [{ type: 'configureMetric', blockId: 'applicant-total', aggregation: 'sum', fieldId: 'applicant-name' }]],
  ['duplicate order member', 'package-gallery', [{ type: 'reorderBlocks', blockIds: ['package-gallery', 'package-gallery'] }]],
]) test(name + ': failed plan and transaction retain entire current project', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  assert.equal(preview(s, selected, commands).ok, false)
  assert.deepEqual(s.runtime.customProject.getSnapshot(), before)
  assert.equal(s.runtime.executeCommand({ requestId: 'bad-' + (++sequence), baseRevision: before.revision, commands }).ok, false)
  assert.deepEqual(s.runtime.customProject.getSnapshot(), before, 'valid earlier commands cannot leak through failing batch')
})
test('execution failure after preview leaves no partial write or authorized retry', async () => {
  const s = await setup(), before = s.runtime.customProject.getSnapshot()
  const plan = expectPreview(s, preview(s, 'registration-form', [{ type: 'configureBlockPresentation', blockId: 'registration-form', presentation: { buttonText: '失败不应写入' } }]), before)
  s.runtime.customProject.setReadOnly(true)
  assert.equal(s.planner.confirm(plan).ok, false)
  assert.deepEqual(s.runtime.customProject.getSnapshot(), before)
  s.runtime.customProject.setReadOnly(false)
  assert.equal(s.planner.confirm(plan).ok, false)
  assert.deepEqual(s.runtime.customProject.getSnapshot(), before)
})
test('modified ZIP restores configuration, original resource bytes and mixed custom order exactly', async () => {
  const s = await setup()
  for (const [selected, commands] of [
    ['registration-form', [{ type: 'configureBlockPresentation', blockId: 'registration-form', presentation: { buttonText: '保存作品' } }]],
    ['package-gallery', [{ type: 'configureGallery', blockId: 'package-gallery', imageIds: ['fixture-png'], layout: 'grid' }, { type: 'reorderBlocks', blockIds: ['package-gallery', 'registration-form', 'applicant-list', 'applicant-total', 'package-timer'] }]],
    ['applicant-total', [{ type: 'configureMetric', blockId: 'applicant-total', aggregation: 'average', fieldId: 'quantity' }]],
  ]) { const plan = expectPreview(s, preview(s, selected, commands), s.runtime.customProject.getSnapshot()); confirm(s, plan) }
  const expected = s.runtime.customProject.getSnapshot(), bytes = await createProjectPackage(expected, s.runtime.customProject.registry)
  assert.deepEqual(Buffer.from(decodePackageZip(bytes).get('assets/fixture-png.png')), pngBytes)
  const restored = await parseProjectPackage(bytes)
  assert.deepEqual(restored.project, expected); assert.equal(restored.artifacts.length, 1)
  const reopened = createAppRuntime(restored.base, restored.artifacts, restored.project)
  assert.deepEqual(reopened.customProject.getSnapshot(), expected)
  assert.equal(metricValue(reopened.getSnapshot(), reopened.getSnapshot().spec.blocks.find(b => b.id === 'applicant-total')), 12)
  assert.deepEqual(s.runtime.customProject.getSnapshot(), expected)
})
