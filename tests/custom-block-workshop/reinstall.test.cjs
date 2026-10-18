const test = require('node:test')
const assert = require('node:assert/strict')
const { api, copy, artifact, createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createCustomBlockBCAdapter } = require('../../src/integrations/custom-block-bc/adapter.ts')
const ref = instance => ({ definitionId: instance.definitionId, versionDigest: instance.versionDigest })
async function setup() {
  const runtime = createAppRuntime(createClubRegistrationExample()), owner = runtime.customProject
  const source = artifact(), versionDigest = await api.computeVersionDigest(source), registered = { versionDigest, artifact: source }
  for (const id of ['target', 'sibling']) {
    assert.equal((await owner.install({ baseRevision: owner.getSnapshot().revision, instance: { id, ...ref({ definitionId: source.manifest.definitionId, versionDigest }), props: { durationSeconds: 600 } }, artifact: registered, expectedReference: null })).ok, true)
  }
  const before = owner.getSnapshot(), next = copy(before); next.revision++
  for (const id of ['target', 'sibling']) {
    next.custom.states[id] = { versionDigest, stateRevision: 3, value: { remainingSeconds: 120, status: 'paused' } }
    next.custom.positions[id] = { x: 0.25, y: 0.35 }
  }
  assert.equal(owner.compareAndSwap(before, next, owner.getAuthorization()).ok, true)
  return { owner, runtime, registered }
}

test('same-version explicit reinstall updates props while preserving selected state, layout and sibling data', async () => {
  const { owner, runtime, registered } = await setup()
  const adapter = await createCustomBlockBCAdapter(owner, owner.registry), beforeEdit = owner.getSnapshot(), target = beforeEdit.custom.instances[0]
  assert.equal((await adapter.editProps({ baseRevision: beforeEdit.revision, instanceId: target.id, reference: ref(target), props: { durationSeconds: 900 } })).ok, true)
  const before = owner.getSnapshot(), instance = { ...copy(before.custom.instances[0]), props: { durationSeconds: 800 } }
  assert.equal((await owner.install({ baseRevision: before.revision, instance, artifact: registered, expectedReference: ref(target) })).ok, true)
  const expected = copy(before); expected.revision++; expected.custom.instances[0].props.durationSeconds = 800
  assert.deepEqual(owner.getSnapshot(), expected)
  assert.equal(runtime.getSnapshot().revision, expected.revision)
  const recreated = await createCustomBlockBCAdapter(owner, owner.registry)
  assert.equal(recreated.manifestFor(instance).definitionId, target.definitionId)
  assert.deepEqual(owner.getSnapshot().custom.states.target, before.custom.states.target)
  assert.equal((await adapter.editProps({ baseRevision: before.revision, instanceId: target.id, reference: ref(target), props: { durationSeconds: 1000 } })).error.code, 'REVISION_CONFLICT')
})

test('new source version resets only selected state; immutable old artifact remains resolvable', async () => {
  const { owner, registered } = await setup(), before = owner.getSnapshot(), target = before.custom.instances[0]
  const source = copy(registered.artifact); source.sources[source.manifest.entry] += '\n// inert new version'
  const versionDigest = await api.computeVersionDigest(source), nextArtifact = { versionDigest, artifact: source }
  const instance = { ...copy(target), versionDigest, props: { durationSeconds: 800 } }
  assert.equal((await owner.install({ baseRevision: before.revision, instance, artifact: nextArtifact, expectedReference: ref(target) })).ok, true)
  const expected = copy(before); expected.revision++; expected.custom.instances[0] = instance; delete expected.custom.states.target
  assert.deepEqual(owner.getSnapshot(), expected)
  assert.deepEqual(await owner.registry.resolve(ref(target)), registered)
  assert.deepEqual(await owner.registry.resolve(ref(instance)), nextArtifact)
})

test('invalid replacement is atomic and cannot rewrite props, states, positions or admitted version', async () => {
  const { owner, registered } = await setup(), before = owner.getSnapshot(), target = before.custom.instances[0]
  for (const modify of [r => r.instance.props.durationSeconds = 0, r => r.expectedReference.versionDigest = 'sha256:' + 'f'.repeat(64), r => r.artifact.artifact.sources['src/Counter.tsx'] += ' corrupt', r => r.instance.id = 'missing']) {
    const request = { baseRevision: before.revision, instance: copy(target), artifact: copy(registered), expectedReference: ref(target) }
    modify(request); assert.equal((await owner.install(request)).ok, false)
    assert.equal(owner.getSnapshot(), before); assert.deepEqual(await owner.registry.resolve(ref(target)), registered)
  }
})
