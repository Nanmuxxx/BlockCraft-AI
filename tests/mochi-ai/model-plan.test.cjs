const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { createModelPlanProvider } = require('../../src/integrations/mochi/modelPlanProvider.ts')
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
const candidate = request => ({ request: { requestId: request.requestId, baseRevision: request.baseRevision, commands: [
  { type: 'addField', entityId: request.entity.id, field: { id: 'offline-note', name: '备注', type: 'text', required: false } },
  { type: 'configureBlockFields', blockId: request.block.id, fieldIds: [...request.block.fieldIds, 'offline-note'] },
] }, capabilityIds: [] })
function setup(t, complete, options) {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const host = createMochiHost(runtime, createModelPlanProvider(complete, options))
  t.after(() => host.dispose()); host.setSelection('registration-form')
  return { runtime, host }
}

test('AppSpec model plan deadline releases Host without a preview and late output cannot overwrite a newer confirmation', async t => {
  let calls = 0, oldRequest, oldSignal
  const old = defer()
  const { runtime, host } = setup(t, async ({ request, signal }) => {
    if (++calls === 1) { oldRequest = request; oldSignal = signal; return old.promise }
    return JSON.stringify(candidate(request))
  }, { timeoutMs: 15 })
  const before = runtime.getSnapshot()
  let guard
  try {
    await assert.rejects(Promise.race([
      host.callbacks.onRequestPlan('新增一个可选文本字段备注（超时修改）'),
      new Promise(resolve => { guard = setTimeout(resolve, 150) }),
    ]), { code: 'MODEL_TIMEOUT' })
    assert.equal(oldSignal.aborted, true)
    assert.equal(runtime.getSnapshot(), before)
    assert.equal(host.getSnapshot().preview, null)
    assert.equal(host.getSnapshot().error.code, 'MODEL_TIMEOUT')
    await host.callbacks.onRequestPlan('新增一个可选文本字段备注（新修改）')
    const latest = host.getSnapshot()
    old.resolve(JSON.stringify(candidate(oldRequest)))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(host.getSnapshot(), latest)
    await host.callbacks.onConfirm(latest.preview.planId)
    assert.equal(runtime.getSnapshot().revision, before.revision + 1)
    assert.equal(calls, 2)
  } finally { clearTimeout(guard); old.resolve('{}') }
})

test('AppSpec model plan deadline configuration rejects unbounded or invalid values', () => {
  for (const timeoutMs of [0, -1, 45001, Infinity, 1.5, '15', null]) {
    assert.throws(() => createModelPlanProvider(async () => '{}', { timeoutMs }), { code: 'MODEL_CONFIGURATION' })
  }
})

test('synchronous completion failure and abort cannot leak an unhandled rejection or mutate Runtime', async t => {
  let host, captured
  const f = setup(t, ({ signal }) => {
    captured = signal
    host.cancelRequest(host.getSnapshot().requestId)
    throw Error('private transport detail')
  })
  host = f.host
  const before = f.runtime.getSnapshot()
  await assert.rejects(host.callbacks.onRequestPlan('新增一个可选文本字段备注（同步取消修改）'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(captured.aborted, true)
  assert.equal(f.runtime.getSnapshot(), before)
  assert.equal(host.getSnapshot().preview, null)
})

test('completion receives selected metadata and occupied structural IDs without records; preview requires explicit confirmation', async t => {
  const { runtime, host } = setup(t, async ({ instruction, request, signal }) => {
    assert.match(instruction, /existing AppChangeCandidate/)
    assert.deepEqual(Object.keys(request).sort(), ['appId', 'blockOrder', 'requestId', 'baseRevision', 'prompt', 'block', 'entity', 'reservedIds'].sort())
    assert.equal(new Set(request.reservedIds).size, request.reservedIds.length)
    assert.ok(request.reservedIds.includes('applicant-list'))
    assert.equal(Object.hasOwn(request, 'records'), false)
    assert.ok(!JSON.stringify(request).includes('小林'))
    assert.equal(signal.aborted, false)
    return JSON.stringify(candidate(request))
  })
  const before = runtime.getSnapshot()
  await host.callbacks.onRequestPlan('新增一个可选文本字段备注（为选中表单添加备注）')
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
  await assert.rejects(host.callbacks.onRequestPlan('新增一个可选文本字段备注（修改）'))
  assert.equal(runtime.getSnapshot(), before)
  assert.equal(host.getSnapshot().preview, null)
})

test('cancelled late completion cannot replace newer preview or apply receipt/history', async t => {
  const old = defer(), started = defer(); let calls = 0
  const { runtime, host } = setup(t, async ({ request }) => {
    if (++calls === 1) { started.resolve(); await old.promise }
    return JSON.stringify(candidate(request))
  })
  const first = host.callbacks.onRequestPlan('新增一个可选文本字段备注（旧修改）')
  const rejected = assert.rejects(first)
  await started.promise; host.cancelRequest(host.getSnapshot().requestId)
  await host.callbacks.onRequestPlan('新增一个可选文本字段备注（新修改）')
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
  await host.callbacks.onRequestPlan('新增一个可选文本字段备注（备注）')
  const old = host.getSnapshot().preview.planId, before = runtime.getSnapshot()
  runtime.customProject.setReadOnly(true); runtime.customProject.setReadOnly(false)
  await assert.rejects(host.callbacks.onConfirm(old))
  assert.equal(runtime.getSnapshot(), before)
  await host.callbacks.onRequestPlan('新增一个可选文本字段备注（重新备注）')
  const next = host.getSnapshot().preview.planId
  assert.equal(runtime.moveBlock('registration-form', { x: .2, y: .2 }).ok, true)
  const winner = runtime.getSnapshot()
  await assert.rejects(host.callbacks.onConfirm(next))
  assert.equal(runtime.getSnapshot(), winner)
})

test('cancel retires Host await even when completion never settles; late failures stay obsolete', { timeout: 1000 }, async t => {
  let rejectOld, calls = 0
  const { runtime, host } = setup(t, async ({ request }) => {
    if (++calls === 1) return new Promise((_, reject) => { rejectOld = reject })
    return JSON.stringify(candidate(request))
  })
  const before = runtime.getSnapshot()
  const first = host.callbacks.onRequestPlan('新增一个可选文本字段备注（不再等待的修改）')
  const rejected = assert.rejects(first)
  host.cancelRequest(host.getSnapshot().requestId); await rejected
  assert.equal(runtime.getSnapshot(), before)
  await host.callbacks.onRequestPlan('新增一个可选文本字段备注（新修改）')
  const current = host.getSnapshot()
  rejectOld(new Error('obsolete transport rejection'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(host.getSnapshot(), current)
  await host.callbacks.onConfirm(current.preview.planId)
  assert.equal(runtime.getSnapshot().revision, 1)
})

test('large valid selected metadata is rejected by UTF-8 bytes before completion, without truncation or mutation', async t => {
  const spec = createClubRegistrationExample()
  spec.spec.entities[0].name = '界'.repeat(24000)
  const runtime = createAppRuntime(spec)
  let calls = 0
  const host = createMochiHost(runtime, createModelPlanProvider(async () => { calls++; throw new Error('must not call transport') }))
  t.after(() => host.dispose()); host.setSelection('registration-form')
  const before = runtime.getSnapshot()
  await assert.rejects(host.callbacks.onRequestPlan('新增一个可选文本字段备注（添加备注）'), { code: 'MODEL_REQUEST_TOO_LARGE' })
  assert.equal(calls, 0)
  assert.equal(runtime.getSnapshot(), before)
  assert.equal(host.getSnapshot().preview, null)
  assert.equal(host.getSnapshot().error.code, 'MODEL_REQUEST_TOO_LARGE')
})
