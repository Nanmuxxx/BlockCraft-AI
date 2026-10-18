const test = require('node:test')
const assert = require('node:assert/strict')
const { api, artifact, copy, createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createCustomBlockBCAdapter, createLayoutBatch } = require('../../src/integrations/custom-block-bc/adapter.ts')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { createAppChangePlanner } = require('../../src/model/appChangePlan.ts')
const { mockAddOptionalField } = require('../../src/integrations/mochi/mockPlanner.ts')
const reference = value => ({ definitionId: value.definitionId, versionDigest: value.versionDigest })
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function request(runtime, id = 'custom-1') {
  const source = artifact(), versionDigest = await api.computeVersionDigest(source)
  return { baseRevision: runtime.getSnapshot().revision, instance: { id, definitionId: source.manifest.definitionId, versionDigest, props: { durationSeconds: 600 } }, artifact: { versionDigest, artifact: source }, expectedReference: null }
}
async function setup() {
  const runtime = createAppRuntime(createClubRegistrationExample()), owner = runtime.customProject
  const input = await request(runtime)
  assert.equal((await owner.install(input)).ok, true)
  const entered = deferred(), release = deferred()
  let gated = false, used = false
  const registry = { async resolve(ref) {
    if (gated && !used) { used = true; entered.resolve(); await release.promise }
    return owner.registry.resolve(ref)
  } }
  const adapter = await createCustomBlockBCAdapter(owner, registry)
  return { runtime, owner, input, adapter, gate() { gated = true; return { entered: entered.promise, release: release.resolve } } }
}
function edit(f, kind) {
  const baseRevision = f.owner.getSnapshot().revision
  return kind === 'props'
    ? f.adapter.editProps({ baseRevision, instanceId: 'custom-1', reference: reference(f.input.instance), props: { durationSeconds: 900 } })
    : f.adapter.moveBlocks({ baseRevision, moves: [{ kind: 'custom', id: 'custom-1', position: { x: .8, y: .8 } }, { kind: 'builtin', id: 'registration-form', position: { x: .5, y: .5 } }] })
}
for (const kind of ['props', 'layout']) for (const restore of [false, true]) {
  test(`production owner rejects in-flight ${kind} after revocation${restore ? ' and regrant' : ''}`, async () => {
    const f = await setup(), before = f.owner.getSnapshot(), pause = f.gate()
    let commits = 0
    f.owner.subscribe(() => { if (f.owner.getSnapshot() !== before) commits++ })
    const pending = edit(f, kind)
    await pause.entered
    f.owner.setReadOnly(true)
    if (restore) f.owner.setReadOnly(false)
    pause.release()
    assert.equal((await pending).error.code, restore ? 'AUTHORIZATION_CHANGED' : 'READ_ONLY')
    assert.equal(f.owner.getSnapshot(), before)
    assert.equal(f.runtime.getSnapshot().revision, before.revision)
    assert.equal(commits, 0)
  })
}
for (const restore of [false, true]) test(`in-flight import cannot register artifacts after revocation${restore ? ' and regrant' : ''}`, async () => {
  const runtime = createAppRuntime(createClubRegistrationExample()), owner = runtime.customProject, input = await request(runtime)
  const before = owner.getSnapshot(), pending = owner.install(input)
  owner.setReadOnly(true)
  if (restore) owner.setReadOnly(false)
  assert.equal((await pending).error.code, restore ? 'AUTHORIZATION_CHANGED' : 'READ_ONLY')
  assert.equal(owner.getSnapshot(), before)
  assert.equal(await owner.registry.resolve(reference(input.instance)), undefined)
})
for (const kind of ['props', 'layout']) test(`concurrent import wins against delayed ${kind} exactly once`, async () => {
  const f = await setup(), next = await request(f.runtime, 'custom-2'), before = f.owner.getSnapshot(), pause = f.gate()
  let commits = 0; f.owner.subscribe(() => commits++)
  const pending = edit(f, kind); await pause.entered
  assert.equal((await f.owner.install(next)).ok, true)
  const committed = f.owner.getSnapshot(); pause.release()
  assert.equal((await pending).error.code, 'REVISION_CONFLICT')
  assert.equal(f.owner.getSnapshot(), committed); assert.equal(commits, 1)
  assert.equal(committed.revision, before.revision + 1)
  assert.equal(committed.custom.instances[0].props.durationSeconds, 600)
  assert.deepEqual(committed.custom.positions['custom-1'], before.custom.positions['custom-1'])
})
for (const kind of ['props', 'layout']) test(`delayed import cannot overwrite committed ${kind}`, async () => {
  const f = await setup(), next = await request(f.runtime, 'custom-2'), before = f.owner.getSnapshot()
  // Pause the actual production digest admission, with no alternate install path.
  const subtle = globalThis.crypto.subtle, digest = subtle.digest
  const entered = deferred(), release = deferred(); let first = true
  subtle.digest = async function (...args) { if (first) { first = false; entered.resolve(); await release.promise } return digest.apply(this, args) }
  try {
    const pending = f.owner.install(next); await entered.promise
    assert.equal((await edit(f, kind)).ok, true)
    const committed = f.owner.getSnapshot(); release.resolve()
    assert.equal((await pending).error.code, 'REVISION_CONFLICT')
    assert.equal(f.owner.getSnapshot(), committed)
    assert.equal(committed.revision, before.revision + 1)
    assert.equal(committed.custom.instances.length, 1)
  } finally { subtle.digest = digest; release.resolve() }
})
test('readonly builtin CRUD/layout/commands preserve project/history/receipts; regrant permits a fresh request', async () => {
  const f = await setup(), owner = f.owner, runtime = f.runtime
  const command = { requestId: 'remove', baseRevision: owner.getSnapshot().revision, commands: [{ type: 'removeBlock', blockId: 'applicant-list' }] }
  const before = owner.getSnapshot(); owner.setReadOnly(true)
  for (const action of [
    () => runtime.updateRecords({ type: 'create', entityId: 'applicants', record: { id: 'new-row', values: { 'applicant-name': '测试', department: '技术部' } } }),
    () => runtime.updateRecords({ type: 'update', entityId: 'applicants', recordId: before.base.records.applicants[0].id, values: before.base.records.applicants[0].values }),
    () => runtime.updateRecords({ type: 'delete', entityId: 'applicants', recordId: before.base.records.applicants[0].id }),
    () => runtime.moveBlock('registration-form', { x: .5, y: .5 }),
    () => runtime.executeCommand(command),
  ]) { assert.equal(action().error.code, 'READ_ONLY'); assert.equal(owner.getSnapshot(), before) }
  assert.equal(runtime.canUndo(), false)
  owner.setReadOnly(false)
  assert.equal(runtime.executeCommand(command).duplicate, false, 'failed readonly command did not create a receipt')
  assert.equal(runtime.canUndo(), true)
})
test('missing/forged/old credentials and foreign equal-revision snapshots fail at synchronous product CAS', async () => {
  const f = await setup(), before = f.owner.getSnapshot(), next = copy(before); next.revision++
  for (const token of [undefined, { readOnly: false }, Object.freeze({ readOnly: false })]) {
    const result = f.owner.compareAndSwap(before, copy(next), token)
    assert.equal(result instanceof Promise, false); assert.equal(result.error.code, 'AUTHORIZATION_CHANGED')
    assert.equal(f.owner.getSnapshot(), before)
  }
  assert.equal(f.owner.compareAndSwap(copy(before), copy(next), f.owner.getAuthorization()).error.code, 'REVISION_CONFLICT')
})
test('file draft, queued layout gesture and planner confirmation keep their original authorization generation', async () => {
  const f = await setup(), captured = f.owner.getAuthorization(), next = await request(f.runtime, 'custom-2')
  const planner = createAppChangePlanner(f.runtime), snapshot = f.runtime.getSnapshot()
  const candidate = { request: { requestId: 'preview-before-revoke', baseRevision: snapshot.revision, commands: [{ type: 'removeBlock', blockId: 'applicant-list' }] }, capabilityIds: [] }
  const plan = planner.preview(candidate, { selectedBlockId: 'applicant-list', allowedBlockIds: ['applicant-list'], allowedEntityIds: ['applicants'] })
  assert.equal(plan.ok, true)
  let done; const result = new Promise(resolve => { done = resolve })
  const queue = createLayoutBatch(f.adapter, done)
  queue(f.owner.getSnapshot(), 'custom', 'custom-1', { x: .5, y: .5 }, captured)
  const before = f.owner.getSnapshot(); f.owner.setReadOnly(true); f.owner.setReadOnly(false)
  assert.equal((await result).error.code, 'AUTHORIZATION_CHANGED')
  assert.equal((await f.owner.install(next, captured)).error.code, 'AUTHORIZATION_CHANGED')
  assert.equal(planner.confirm(plan.plan).error.code, 'AUTHORIZATION_CHANGED')
  assert.equal(f.owner.getSnapshot(), before)
  assert.equal(await f.owner.registry.resolve(reference(next.instance)), await f.owner.registry.resolve(reference(f.input.instance)), 'same digest registry stays unchanged')
})
test('Mochi invalidates pending provider work and confirmed preview on permission-only notifications', async () => {
  const f = await setup(), response = deferred(), entered = deferred()
  const host = createMochiHost(f.runtime, async input => { const candidate = await mockAddOptionalField(input); entered.resolve(); await response.promise; return candidate })
  host.setSelection('registration-form')
  const before = f.owner.getSnapshot(), pending = host.callbacks.onRequestPlan('离线测试')
  await entered.promise
  const epoch = host.getSnapshot().epoch
  f.owner.setReadOnly(true); f.owner.setReadOnly(false); response.resolve()
  await assert.rejects(pending, error => error.code === 'CONTEXT_CHANGED')
  assert.equal(host.getSnapshot().preview, null); assert.ok(host.getSnapshot().epoch > epoch)
  assert.equal(f.owner.getSnapshot(), before)
  host.dispose()
  const fresh = createMochiHost(f.runtime, mockAddOptionalField); fresh.setSelection('registration-form')
  await fresh.callbacks.onRequestPlan('离线测试')
  const id = fresh.getSnapshot().preview.planId
  f.owner.setReadOnly(true); f.owner.setReadOnly(false)
  assert.equal(fresh.getSnapshot().preview, null)
  await assert.rejects(fresh.callbacks.onConfirm(id), error => error.code === 'PLAN_NOT_PENDING')
  assert.equal(f.owner.getSnapshot(), before); fresh.dispose()
})
