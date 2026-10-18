const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { createModelPlanProvider } = require('../../src/integrations/mochi/modelPlanProvider.ts')
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
const candidate = request => ({ request: { requestId: request.requestId, baseRevision: request.baseRevision, commands: [
  { type: 'addField', entityId: request.entity.id, field: { id: 'offline-note', name: '离线备注', type: 'text', required: false } },
  { type: 'configureBlockFields', blockId: request.block.id, fieldIds: [...request.block.fieldIds, 'offline-note'] },
] }, capabilityIds: [] })
function setup(t, complete) {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const host = createMochiHost(runtime, createModelPlanProvider(complete))
  t.after(() => host.dispose()); host.setSelection('registration-form')
  return { runtime, host }
}

test('completion only receives selected metadata, prompt and cancellation signal; preview requires explicit confirmation', async t => {
  const { runtime, host } = setup(t, async ({ instruction, request, signal }) => {
    assert.match(instruction, /existing AppChangeCandidate/)
    assert.deepEqual(Object.keys(request).sort(), ['requestId', 'baseRevision', 'prompt', 'block', 'entity'].sort())
    assert.ok(!JSON.stringify(request).includes('小林'))
    assert.equal(signal.aborted, false)
    return JSON.stringify(candidate(request))
  })
  const before = runtime.getSnapshot()
  await host.callbacks.onRequestPlan('为选中表单添加备注')
  assert.equal(runtime.getSnapshot(), before)
  const preview = host.getSnapshot().preview
  await host.callbacks.onConfirm(preview.planId)
  assert.equal(runtime.getSnapshot().revision, before.revision + 1)
  assert.deepEqual(runtime.getSnapshot().records, before.records)
})

for (const [name, transform] of [
  ['malformed JSON', () => 'chat advice'],
  ['oversized response', () => ' '.repeat(65537)],
  ['forged request ID', r => { const c = candidate(r); c.request.requestId = 'forged'; return JSON.stringify(c) }],
  ['stale revision', r => { const c = candidate(r); c.request.baseRevision++; return JSON.stringify(c) }],
  ['record command', r => JSON.stringify({ request: { requestId: r.requestId, baseRevision: r.baseRevision, commands: [{ type: 'undo' }] }, capabilityIds: [] })],
  ['unselected removal', r => JSON.stringify({ request: { requestId: r.requestId, baseRevision: r.baseRevision, commands: [{ type: 'removeBlock', blockId: 'applicant-list' }] }, capabilityIds: [] })],
  ['invented TSX', r => JSON.stringify({ ...candidate(r), source: 'export default () => null' })],
  ['unsupported button style', r => JSON.stringify({ request: { requestId: r.requestId, baseRevision: r.baseRevision, commands: [{ type: 'setButtonColor', blockId: r.block.id, color: 'red' }] }, capabilityIds: [] })],
]) test(`${name}: Phase A rejects model data and preserves project`, async t => {
  const { runtime, host } = setup(t, async ({ request }) => transform(request)), before = runtime.getSnapshot()
  await assert.rejects(host.callbacks.onRequestPlan('修改'))
  assert.equal(runtime.getSnapshot(), before)
  assert.equal(host.getSnapshot().preview, null)
})

test('cancelled late completion cannot replace newer preview or apply receipt/history', async t => {
  const old = defer(), started = defer(); let calls = 0
  const { runtime, host } = setup(t, async ({ request }) => {
    if (++calls === 1) { started.resolve(); await old.promise }
    return JSON.stringify(candidate(request))
  })
  const first = host.callbacks.onRequestPlan('旧修改')
  const rejected = assert.rejects(first)
  await started.promise; host.cancelRequest()
  await host.callbacks.onRequestPlan('新修改')
  const second = host.getSnapshot()
  old.resolve(); await rejected
  assert.equal(host.getSnapshot(), second)
  await host.callbacks.onConfirm(second.preview.planId)
  const committed = host.getSnapshot().lastApplied
  assert.equal(committed.requestId, second.requestId)
  assert.equal(runtime.getSnapshot().revision, 1)
})

test('authorization ABA and concurrent revision invalidate exact preview without implicit reauthorization', async t => {
  const { runtime, host } = setup(t, async ({ request }) => JSON.stringify(candidate(request)))
  await host.callbacks.onRequestPlan('备注')
  const old = host.getSnapshot().preview.planId, before = runtime.getSnapshot()
  runtime.customProject.setReadOnly(true); runtime.customProject.setReadOnly(false)
  await assert.rejects(host.callbacks.onConfirm(old))
  assert.equal(runtime.getSnapshot(), before)
  await host.callbacks.onRequestPlan('重新备注')
  const next = host.getSnapshot().preview.planId
  assert.equal(runtime.moveBlock('registration-form', { x: .2, y: .2 }).ok, true)
  const winner = runtime.getSnapshot()
  await assert.rejects(host.callbacks.onConfirm(next))
  assert.equal(runtime.getSnapshot(), winner)
})
