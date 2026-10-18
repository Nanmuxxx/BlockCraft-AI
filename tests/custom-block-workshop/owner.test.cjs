const test = require('node:test')
const assert = require('node:assert/strict')
const { api, copy, artifact, createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createCustomBlockBCAdapter } = require('../../src/integrations/custom-block-bc/adapter.ts')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
async function input(runtime, source = artifact(), id = 'custom-1') {
  const versionDigest = await api.computeVersionDigest(source)
  return { baseRevision: runtime.getSnapshot().revision, instance: { id, definitionId: source.manifest.definitionId, versionDigest, props: { durationSeconds: 600 } }, artifact: { versionDigest, artifact: source }, expectedReference: null }
}
async function setup() {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const request = await input(runtime)
  assert.equal((await runtime.customProject.install(request)).ok, true)
  const owner = runtime.customProject
  const adapter = await createCustomBlockBCAdapter(owner, owner.registry)
  return { runtime, request, owner, adapter }
}
const ref = instance => ({ definitionId: instance.definitionId, versionDigest: instance.versionDigest })
test('one owner publishes atomic v1 projections, custom edits, mixed drag and builtin CRUD', async () => {
  const { runtime, owner, adapter, request } = await setup()
  let events = 0
  const stop = runtime.subscribe(() => {
    events++
    assert.equal(runtime.getSnapshot().revision, owner.getSnapshot().revision)
    assert.equal(runtime.getSnapshot().records, owner.getSnapshot().base.records)
  })
  const custom = copy(owner.getSnapshot().custom)
  runtime.dispatch({ type: 'create', entityId: 'applicants', record: { id: 'row-new', values: { 'applicant-name': '小张', department: '策划部' } } })
  assert.deepEqual(owner.getSnapshot().custom, custom)
  assert.equal((await adapter.editProps({ baseRevision: 2, instanceId: 'custom-1', reference: ref(request.instance), props: { durationSeconds: 900 } })).ok, true)
  const records = owner.getSnapshot().base.records
  assert.equal((await adapter.moveBlocks({ baseRevision: 3, moves: [{ kind: 'builtin', id: 'registration-form', position: { x: .1, y: .2 } }, { kind: 'custom', id: 'custom-1', position: { x: .2, y: .4 } }] })).ok, true)
  assert.deepEqual(owner.getSnapshot().base.records, records)
  runtime.dispatch({ type: 'update', entityId: 'applicants', recordId: 'row-new', values: { 'applicant-name': '小李', department: '技术部' } })
  runtime.dispatch({ type: 'delete', entityId: 'applicants', recordId: 'row-new' })
  assert.equal(events, 5)
  assert.equal(owner.getSnapshot().revision, 6)
  assert.ok(Object.isFrozen(owner.getSnapshot().custom.instances[0].props))
  stop()
})
test('untrusted invalid imports/digests/props and duplicate creation are atomic and do not admit artifacts', async () => {
  const { runtime, owner, request } = await setup()
  const before = owner.getSnapshot()
  for (const change of [r => r.artifact.artifact.sources['src/Counter.tsx'] += ' tampered', r => r.instance.props.durationSeconds = .5, r => r.instance.id = 'registration-form', r => r.instance.id = 'applicants', r => r.instance.props.extra = true]) {
    const candidate = copy(request); candidate.baseRevision = before.revision; change(candidate)
    assert.equal((await owner.install(candidate)).ok, false)
    assert.equal(owner.getSnapshot(), before)
  }
  const duplicate = copy(request); duplicate.baseRevision = before.revision
  assert.equal((await owner.install(duplicate)).error.code, 'INSTANCE_EXISTS')
  assert.equal(runtime.getSnapshot().revision, 1)
})
test('new version and definition require re-admission; old props drafts/reference cannot write; old state is dropped', async () => {
  const { runtime, owner, adapter, request } = await setup()
  const withState = copy(owner.getSnapshot()); withState.revision++
  withState.custom.states['custom-1'] = { versionDigest: request.instance.versionDigest, stateRevision: 0, value: { remainingSeconds: 600, status: 'idle' } }
  assert.equal((await owner.compareAndSwap(owner.getSnapshot(), withState, owner.getAuthorization())).ok, true)
  const source = artifact(); source.manifest.definitionId = 'different-definition'; source.manifest.name = '新版本'
  source.manifest.propsSchema.properties.durationSeconds.minimum = 700
  const next = await input(runtime, source); next.instance.props.durationSeconds = 800; next.expectedReference = ref(request.instance)
  assert.equal((await owner.install(next)).ok, true)
  assert.equal(owner.getSnapshot().custom.states['custom-1'], undefined)
  assert.equal(adapter.manifestFor(next.instance), undefined, 'old cache cannot impersonate a new version')
  assert.equal((await adapter.editProps({ baseRevision: owner.getSnapshot().revision, instanceId: 'custom-1', reference: ref(request.instance), props: { durationSeconds: 900 } })).error.code, 'VERSION_CONFLICT')
  const admitted = await createCustomBlockBCAdapter(owner, owner.registry)
  assert.equal(admitted.manifestFor(next.instance).name, '新版本')
  assert.equal((await admitted.editProps({ baseRevision: owner.getSnapshot().revision, instanceId: 'custom-1', reference: ref(next.instance), props: { durationSeconds: 600 } })).ok, false)
})
test('in-flight admission and CAS cannot overwrite concurrent builtin writes', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample()), request = await input(runtime)
  const pending = runtime.customProject.install(request)
  runtime.moveBlock('registration-form', { x: .4, y: .4 })
  assert.equal((await pending).error.code, 'REVISION_CONFLICT')
  assert.equal(runtime.customProject.getSnapshot().custom.instances.length, 0)
  assert.equal(await runtime.customProject.registry.resolve(ref(request.instance)), undefined)
  const expected = runtime.customProject.getSnapshot(), candidate = copy(expected); candidate.revision++
  assert.equal(runtime.moveBlock('registration-form', { x: .5, y: .5 }).ok, true)
  const cas = runtime.customProject.compareAndSwap(expected, candidate, runtime.customProject.getAuthorization())
  assert.equal(cas.error.code, 'REVISION_CONFLICT')
  assert.equal(cas instanceof Promise, false)
})
test('install captures unknown caller input before await; stale and mismatched replacement intent reject', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample()), request = await input(runtime)
  const pending = runtime.customProject.install(request)
  request.instance.props.durationSeconds = 1; request.artifact.artifact.sources['src/Counter.tsx'] = 'malicious mutation'
  assert.equal((await pending).ok, true)
  assert.equal(runtime.customProject.getSnapshot().custom.instances[0].props.durationSeconds, 600)
  const invalid = await input(runtime); invalid.expectedReference = { ...ref(invalid.instance), versionDigest: `sha256:${'0'.repeat(64)}` }
  assert.equal((await runtime.customProject.install(invalid)).error.code, 'VERSION_CONFLICT')
  invalid.baseRevision--
  assert.equal((await runtime.customProject.install(invalid)).error.code, 'REVISION_CONFLICT')
})
test('builtin add/remove/undo preserves custom data and render coverage; custom writes clear history but keep receipts', async () => {
  const { runtime, owner, adapter, request } = await setup()
  const remove = { requestId: 'remove-1', baseRevision: 1, commands: [{ type: 'removeBlock', blockId: 'applicant-list' }] }
  assert.equal(runtime.executeCommand(remove).ok, true)
  assert.equal(owner.getSnapshot().renderOrder.some(item => item.id === 'applicant-list'), false)
  assert.equal(runtime.canUndo(), true)
  assert.equal(runtime.executeCommand({ requestId: 'undo-1', baseRevision: 2, commands: [{ type: 'undo' }] }).ok, true)
  assert.equal(owner.getSnapshot().renderOrder.filter(item => item.id === 'applicant-list').length, 1)
  assert.equal((await adapter.editProps({ baseRevision: 3, instanceId: 'custom-1', reference: ref(request.instance), props: { durationSeconds: 100 } })).ok, true)
  assert.equal(runtime.canUndo(), false)
  assert.equal(runtime.executeCommand(remove).duplicate, true)
  assert.equal(owner.getSnapshot().custom.instances[0].props.durationSeconds, 100)
  assert.equal(owner.getSnapshot().revision, 4)
})
test('builtin commands cannot collide with custom IDs and failed command leaves history/receipts untouched', async () => {
  const { runtime, owner } = await setup(), before = owner.getSnapshot()
  const command = { requestId: 'collision', baseRevision: before.revision, commands: [{ type: 'addBlock', block: { id: 'custom-1', type: 'metric', name: 'collision', aggregation: 'count' }, binding: { id: 'new-binding', type: 'dataBinding', blockId: 'custom-1', entityId: 'applicants' } }] }
  assert.equal(runtime.executeCommand(command).ok, false)
  assert.equal(owner.getSnapshot(), before)
  command.commands[0].block.id = 'valid-new'; command.commands[0].binding.blockId = 'valid-new'
  assert.equal(runtime.executeCommand(command).ok, true)
})
test('custom selection shares Mochi epoch/revision and anchors but grants no builtin planning authority', async () => {
  const { runtime, owner, adapter, request } = await setup()
  let calls = 0
  const host = createMochiHost(runtime, () => { calls++; throw Error('must not call') })
  host.setSelection('custom-1')
  const old = host.getSnapshot()
  assert.equal(old.context.selectedBlockId, 'custom-1')
  await assert.rejects(host.callbacks.onRequestPlan('修改'), error => error.code === 'CUSTOM_SCOPE_UNAVAILABLE')
  host.setAnchor({ instanceId: old.context.instanceId, revision: old.context.revision, selectedBlockId: 'custom-1', epoch: old.epoch, rect: { x: 1, y: 1 } })
  await adapter.editProps({ baseRevision: owner.getSnapshot().revision, instanceId: 'custom-1', reference: ref(request.instance), props: { durationSeconds: 900 } })
  assert.equal(host.getSnapshot().context.selectedBlockId, 'custom-1')
  assert.ok(host.getSnapshot().epoch > old.epoch)
  assert.equal(host.getSnapshot().anchor, null)
  assert.equal(calls, 0)
  host.dispose()
})
test('public CAS validates cached Schema synchronously and freezes the committed candidate', async () => {
  const { owner } = await setup(), before = owner.getSnapshot()
  const invalid = copy(before); invalid.revision++; invalid.custom.instances[0].props.durationSeconds = -1
  assert.equal((await owner.compareAndSwap(before, invalid, owner.getAuthorization())).ok, false)
  assert.equal(owner.getSnapshot(), before)
  const candidate = copy(before); candidate.revision++; candidate.custom.instances[0].props.durationSeconds = 800
  const result = owner.compareAndSwap(before, candidate, owner.getAuthorization())
  assert.equal(result instanceof Promise, false)
  assert.equal(result.ok, true)
  assert.ok(Object.isFrozen(candidate.custom.instances[0].props))
  Reflect.set(candidate.custom.instances[0].props, 'durationSeconds', 999)
  assert.equal(owner.getSnapshot().custom.instances[0].props.durationSeconds, 800)
})
