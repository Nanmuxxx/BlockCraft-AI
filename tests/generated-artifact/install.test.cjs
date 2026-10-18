const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { api, copy, createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createGeneratedArtifactInstaller } = require('../../src/integrations/generated-artifact/install.ts')
const record = require('./fixtures/pomodoro.pending.json')
const reference = { definitionId: record.entry.artifact.manifest.definitionId, versionDigest: record.entry.versionDigest }
const file = (id = 'ai-pomodoro') => ({ instance: { id, ...reference, props: { initialMinutes: 25, title: '真实制品离线安装' } }, artifact: copy(record.entry) })
const setup = wrap => {
  const runtime = createAppRuntime(createClubRegistrationExample()), owner = runtime.customProject
  return { runtime, owner, installer: createGeneratedArtifactInstaller(wrap ? wrap(owner) : owner) }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN') }

test('real archived DeepSeek record: private store -> exact export -> preview -> sole session CAS; source stays inert', async t => {
  const { createPendingStore } = await import('../../server/custom-block/store.mjs')
  const { exportPendingInstall } = await import('../../server/custom-block/install-export.mjs')
  const directory = await mkdtemp(path.join(os.tmpdir(), 'generated-install-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createPendingStore(directory)
  await store.put(copy(record))
  const result = await exportPendingInstall(store, { reference, instanceId: 'ai-pomodoro', props: file().instance.props })
  assert.equal(result.provenance.kind, 'deepseek') // archived provenance, no new model call
  assert.equal(result.status, 'pending-build'); assert.equal(result.execution, 'denied')
  const f = setup(), before = f.owner.getSnapshot()
  // Retain a distinct older version and its host state across the new install.
  const older = file('sibling')
  older.artifact.artifact.manifest.name = 'Archived sibling version fixture'
  older.artifact.versionDigest = await api.computeVersionDigest(older.artifact.artifact)
  older.instance.versionDigest = older.artifact.versionDigest
  assert.equal((await f.owner.install({ ...older, baseRevision: before.revision, expectedReference: null })).ok, true)
  const expected = f.owner.getSnapshot(), next = copy(expected)
  next.custom.states.sibling = { versionDigest: older.instance.versionDigest, stateRevision: 1, value: { remainingSeconds: 123, status: 'paused' } }; next.revision++
  assert.equal(f.owner.compareAndSwap(expected, next, f.owner.getAuthorization()).ok, true)
  const captured = f.owner.getSnapshot(), plan = await f.installer.prepare(result.importFile)
  assert.equal(f.owner.getSnapshot(), captured); assert.equal(plan.status, 'pending-build')
  assert.ok(Object.isFrozen(plan.importFile.artifact.artifact.sources))
  assert.equal((await f.installer.confirm(plan.ticketId)).ok, true)
  const after = f.owner.getSnapshot(), wanted = copy(captured)
  wanted.revision++; wanted.custom.instances.push(result.importFile.instance)
  wanted.custom.positions['ai-pomodoro'] = { x: .1, y: .7 }; wanted.renderOrder.push({ kind: 'custom', id: 'ai-pomodoro' })
  assert.deepEqual(after, wanted)
  assert.deepEqual(await api.resolveArtifact(f.owner.registry, reference), record.entry)
  assert.deepEqual(await api.resolveArtifact(f.owner.registry, { definitionId: older.instance.definitionId, versionDigest: older.instance.versionDigest }), older.artifact)
  const { createCustomBlockBCAdapter } = require('../../src/integrations/custom-block-bc/adapter.ts')
  const { viewerState } = require('../../src/integrations/custom-block-bc/viewer.ts')
  const adapter = await createCustomBlockBCAdapter(f.owner, f.owner.registry)
  assert.equal(adapter.getSnapshot(), after)
  const block = adapter.orderedBlocks(after).find(b => b.id === 'ai-pomodoro')
  assert.equal(block.manifest.name, record.entry.artifact.manifest.name)
  assert.equal(JSON.stringify(block).includes('sources'), false)
  assert.equal(viewerState(block.instance, { reference, status: 'pending-build' }).status, 'pending-build')
  assert.equal((await f.installer.confirm(plan.ticketId)).duplicate, true)
  assert.equal(f.owner.getSnapshot(), after)
})
test('export rejects missing/wrong reference, corrupt digest, invalid status/props and captures input', async () => {
  const { exportPendingInstall } = await import('../../server/custom-block/install-export.mjs')
  const input = { reference, instanceId: 'ai-pomodoro', props: file().instance.props }
  await assert.rejects(exportPendingInstall({ inspect: async () => undefined }, input), { code: 'ARTIFACT_NOT_FOUND' })
  for (const mutate of [r => r.entry.artifact.sources[r.entry.artifact.manifest.entry] += '//changed', r => r.status = 'runnable']) {
    const bad = copy(record); mutate(bad)
    await assert.rejects(exportPendingInstall({ inspect: async () => bad }, input))
  }
  await assert.rejects(exportPendingInstall({ inspect: async () => record }, { ...input, reference: { ...reference, definitionId: 'other' } }), { code: 'STORE_REFERENCE_MISMATCH' })
  await assert.rejects(exportPendingInstall({ inspect: async () => record }, { ...input, props: { initialMinutes: 0 } }))
  const gate = deferred(), mutable = copy(input)
  const pending = exportPendingInstall({ inspect: () => gate.promise }, mutable)
  mutable.props.initialMinutes = 999; gate.resolve(record)
  assert.equal((await pending).importFile.instance.props.initialMinutes, 25)
})
test('cancel is idempotent, foreign tickets cannot commit and no candidate is registered', async () => {
  const f = setup(), before = f.owner.getSnapshot(), plan = await f.installer.prepare(file())
  f.installer.cancel(plan.ticketId); f.installer.cancel(plan.ticketId)
  await assert.rejects(f.installer.confirm(plan.ticketId), { code: 'TICKET_NOT_PENDING' })
  await assert.rejects(setup().installer.confirm(plan.ticketId), { code: 'TICKET_NOT_OWNED' })
  assert.equal(f.owner.getSnapshot(), before); assert.equal(await f.owner.registry.resolve(reference), undefined)
})
test('malformed, stale digest, invalid props, extra execution permission and collisions fail before preview', async () => {
  for (const mutate of [f => f.artifact.versionDigest = `sha256:${'a'.repeat(64)}`, f => f.instance.props.initialMinutes = -1, f => f.executionPermit = true, f => f.instance.id = 'registration-form']) {
    const f = setup(), before = f.owner.getSnapshot(), input = file(); mutate(input)
    await assert.rejects(f.installer.prepare(input)); assert.equal(f.owner.getSnapshot(), before)
  }
  const f = setup(); const p = await f.installer.prepare(file()); await f.installer.confirm(p.ticketId)
  await assert.rejects(f.installer.prepare(file()), { code: 'INSTANCE_EXISTS' })
})
test('project switch, revision change and revoke/regrant invalidate previews', async () => {
  for (const change of [f => f.installer.invalidate(), f => { const old = f.owner.getSnapshot(), next = copy(old); next.revision++; assert.equal(f.owner.compareAndSwap(old, next, f.owner.getAuthorization()).ok, true) }, f => { f.owner.setReadOnly(true); f.owner.setReadOnly(false) }]) {
    const f = setup(), plan = await f.installer.prepare(file()); change(f)
    const before = f.owner.getSnapshot()
    await assert.rejects(f.installer.confirm(plan.ticketId)); assert.equal(f.owner.getSnapshot(), before)
  }
  const f = setup(); f.owner.setReadOnly(true)
  await assert.rejects(f.installer.prepare(file()), { code: 'READ_ONLY' })
})
test('confirmation rechecks revision/authorization even if host notifications were missed', async () => {
  for (const kind of ['revision', 'authorization']) {
    const f = setup(owner => ({ ...owner, subscribe: () => () => {} }))
    const plan = await f.installer.prepare(file())
    if (kind === 'revision') {
      const old = f.owner.getSnapshot(), next = copy(old); next.revision++
      f.owner.compareAndSwap(old, next, f.owner.getAuthorization())
    } else { f.owner.setReadOnly(true); f.owner.setReadOnly(false) }
    const before = f.owner.getSnapshot()
    await assert.rejects(f.installer.confirm(plan.ticketId), { code: kind === 'revision' ? 'REVISION_CONFLICT' : 'AUTHORIZATION_CHANGED' })
    assert.equal(f.owner.getSnapshot(), before)
  }
})
test('context invalidation or disposal during prepare drops the late result without registering artifact', async () => {
  for (const dispose of [false, true]) {
    const f = setup(), before = f.owner.getSnapshot(), pending = f.installer.prepare(file())
    if (dispose) f.installer.dispose(); else f.installer.invalidate()
    await assert.rejects(pending, { code: dispose ? 'INSTALLER_DISPOSED' : 'CONTEXT_CHANGED' })
    assert.equal(f.owner.getSnapshot(), before); assert.equal(await f.owner.registry.resolve(reference), undefined)
  }
})
test('late prepare, superseding prepare, input mutation and dispose cannot revive a ticket', async () => {
  const f = setup(), input = file(), pending = f.installer.prepare(input)
  input.instance.props.initialMinutes = 999
  assert.equal((await pending).importFile.instance.props.initialMinutes, 25)
  const first = f.installer.prepare(file('first')), rejected = assert.rejects(first, { code: 'CONTEXT_CHANGED' })
  const second = await f.installer.prepare(file('second')); await rejected
  f.installer.dispose()
  await assert.rejects(f.installer.confirm(second.ticketId), { code: 'INSTALLER_DISPOSED' })
})
test('confirm lease synchronously blocks cancel/context switch/dispose and duplicate submission', async () => {
  const gate = deferred(), f = setup(owner => ({ ...owner, async install(...args) { await gate.promise; return owner.install(...args) } }))
  const p = await f.installer.prepare(file()), pending = f.installer.confirm(p.ticketId)
  for (const action of [() => f.installer.cancel(p.ticketId), () => f.installer.invalidate(), () => f.installer.dispose()]) assert.throws(action, { code: 'CONFIRM_BUSY' })
  let hostProject = 'original', mounted = true
  const switchProject = () => { f.installer.invalidate(); hostProject = 'next' }
  const unmount = () => { f.installer.dispose(); mounted = false }
  assert.throws(switchProject, { code: 'CONFIRM_BUSY' }); assert.equal(hostProject, 'original')
  assert.throws(unmount, { code: 'CONFIRM_BUSY' }); assert.equal(mounted, true)
  await assert.rejects(f.installer.confirm(p.ticketId), { code: 'CONFIRM_BUSY' })
  gate.resolve(); assert.equal((await pending).ok, true)
  switchProject(); assert.equal(hostProject, 'next')
  unmount(); assert.equal(mounted, false)
})
test('permission changes or concurrent CAS during async install reject atomically and terminally', async () => {
  for (const kind of ['permission', 'revision']) {
    const gate = deferred(), f = setup(owner => ({ ...owner, async install(...args) { await gate.promise; return owner.install(...args) } }))
    const plan = await f.installer.prepare(file()), pending = f.installer.confirm(plan.ticketId)
    if (kind === 'permission') f.owner.setReadOnly(true)
    else { const old = f.owner.getSnapshot(), next = copy(old); next.revision++; f.owner.compareAndSwap(old, next, f.owner.getAuthorization()) }
    const before = f.owner.getSnapshot(); gate.resolve()
    assert.equal((await pending).ok, false); assert.equal(f.owner.getSnapshot(), before)
    assert.equal(await f.owner.registry.resolve(reference), undefined)
    await assert.rejects(f.installer.confirm(plan.ticketId), { code: 'TICKET_NOT_PENDING' })
  }
})
test('two installers using one owner commit at most once; no implicit replacement', async () => {
  const f = setup(), other = createGeneratedArtifactInstaller(f.owner)
  const [a, b] = await Promise.all([f.installer.prepare(file()), other.prepare(file())])
  const results = await Promise.all([f.installer.confirm(a.ticketId), other.confirm(b.ticketId)])
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(f.owner.getSnapshot().custom.instances.length, 1)
})
test('unexpected install exception is terminal; capability escalation rejected', async () => {
  const f = setup(owner => ({ ...owner, async install() { throw Error('host failed') } }))
  const p = await f.installer.prepare(file())
  await assert.rejects(f.installer.confirm(p.ticketId), /host failed/)
  await assert.rejects(f.installer.confirm(p.ticketId), { code: 'TICKET_NOT_PENDING' })
  const input = file(); input.artifact.artifact.manifest.requestedCapabilities = [{ kind: 'state.write' }]
  input.artifact.versionDigest = await api.computeVersionDigest(input.artifact.artifact); input.instance.versionDigest = input.artifact.versionDigest
  await assert.rejects(setup().installer.prepare(input), { code: 'CAPABILITIES_REJECTED' })
})
