const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, copy, testOwner } = require('./helpers.cjs')
const { createCustomBlockBCAdapter } = require('../../src/integrations/custom-block-bc/adapter.ts')

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
// Gate only the next exact registry resolution, after adapter admission.
function gate(registry) {
  const original = registry.resolve.bind(registry), entered = deferred(), release = deferred()
  let first = true
  registry.resolve = async ref => {
    if (first) { first = false; entered.resolve(); await release.promise }
    return original(ref)
  }
  return { entered: entered.promise, release: release.resolve }
}
function request(f, kind, snapshot = f.owner.getSnapshot()) {
  return kind === 'props'
    ? { baseRevision: snapshot.revision, instanceId: 'countdown-1', reference: f.reference, props: { ...snapshot.custom.instances[0].props, durationSeconds: 900 } }
    : { baseRevision: snapshot.revision, moves: [{ kind: 'custom', id: 'countdown-1', position: { x: .9, y: .1 } }] }
}
const submit = (adapter, kind, input) => kind === 'props' ? adapter.editProps(input) : adapter.moveBlocks(input)

for (const kind of ['props', 'positions']) {
  for (const restore of [false, true]) test(`${kind}: revocation${restore ? ' then regrant' : ''} during validation is rejected at real owner CAS`, async () => {
    const f = await fixture(), before = f.owner.getSnapshot(), serialized = copy(before), pause = gate(f.registry)
    const realCAS = f.owner.compareAndSwap
    let ownerResult, calls = 0
    f.owner.compareAndSwap = (...args) => { calls++; return ownerResult = realCAS(...args) }
    const pending = submit(f.adapter, kind, request(f, kind))
    await pause.entered
    f.owner.setReadOnly(true)
    if (restore) f.owner.setReadOnly(false)
    pause.release()
    const result = await pending
    assert.equal(calls, 1, 'request reached the real owner boundary')
    assert.strictEqual(result, ownerResult)
    assert.equal(result.error.code, restore ? 'AUTHORIZATION_CHANGED' : 'READ_ONLY')
    assert.strictEqual(f.owner.getSnapshot(), before); assert.deepEqual(before, serialized)
    assert.equal(f.owner.commits(), 0)
  })

  test(`${kind}: writable-looking UI cannot bypass an already readonly owner`, async () => {
    const f = await fixture(), before = f.owner.getSnapshot()
    f.owner.setReadOnly(true)
    assert.equal((await submit(f.adapter, kind, request(f, kind))).error.code, 'READ_ONLY')
    assert.strictEqual(f.owner.getSnapshot(), before); assert.equal(f.owner.commits(), 0)
  })

  test(`${kind}: MAX_SAFE_INTEGER boundary applies to adapter and owner`, async () => {
    const f = await fixture(), initial = copy(f.owner.getSnapshot())
    initial.revision = Number.MAX_SAFE_INTEGER - 1
    const owner = testOwner(initial), adapter = await createCustomBlockBCAdapter(owner, f.registry)
    assert.equal((await submit(adapter, kind, request(f, kind, owner.getSnapshot()))).ok, true)
    const max = owner.getSnapshot(), serialized = copy(max)
    assert.equal(max.revision, 9007199254740991)
    assert.equal((await submit(adapter, kind, request(f, kind, max))).error.code, 'REVISION_EXHAUSTED')
    assert.strictEqual(owner.getSnapshot(), max); assert.deepEqual(max, serialized); assert.equal(owner.commits(), 1)
  })
}

test('same-revision trusted session snapshot replacement invalidates an awaiting request', async () => {
  const f = await fixture(), original = f.owner
  let currentOwner = original, casCalls = 0
  // Session indirection delegates all writes to actual owners; it never implements CAS.
  const session = {
    getSnapshot: () => currentOwner.getSnapshot(), getAuthorization: () => currentOwner.getAuthorization(),
    subscribe: listener => currentOwner.subscribe(listener),
    compareAndSwap: (...args) => { casCalls++; return currentOwner.compareAndSwap(...args) },
  }
  const adapter = await createCustomBlockBCAdapter(session, f.registry), pause = gate(f.registry)
  const pending = adapter.editProps(request(f, 'props'))
  await pause.entered
  const replacement = copy(original.getSnapshot())
  replacement.custom.instances[0].props.title = 'restored same-revision session'
  currentOwner = testOwner(replacement)
  const authoritative = currentOwner.getSnapshot()
  assert.equal(authoritative.revision, original.getSnapshot().revision)
  pause.release()
  assert.equal((await pending).error.code, 'REVISION_CONFLICT')
  assert.strictEqual(currentOwner.getSnapshot(), authoritative)
  assert.equal(casCalls, 0); assert.equal(original.commits(), 0); assert.equal(currentOwner.commits(), 0)
  // Direct old-session caller also cannot overwrite the new owner at equal revision.
  assert.equal(currentOwner.compareAndSwap(original.getSnapshot(), { ...copy(authoritative), revision: authoritative.revision + 1 }, currentOwner.getAuthorization()).error.code, 'REVISION_CONFLICT')
})

for (const loser of ['props', 'positions']) test(`cross competition: delayed ${loser} cannot overwrite the other successful transaction`, async () => {
  const f = await fixture(), before = f.owner.getSnapshot(), pause = gate(f.registry)
  let notifications = 0
  f.owner.subscribe(() => notifications++)
  const pending = submit(f.adapter, loser, request(f, loser))
  await pause.entered
  const winner = loser === 'props' ? 'positions' : 'props'
  assert.equal((await submit(f.adapter, winner, request(f, winner))).ok, true)
  const committed = f.owner.getSnapshot(), serialized = copy(committed)
  pause.release()
  assert.equal((await pending).error.code, 'REVISION_CONFLICT')
  assert.strictEqual(f.owner.getSnapshot(), committed); assert.deepEqual(committed, serialized)
  assert.equal(committed.revision, before.revision + 1); assert.equal(f.owner.commits(), 1); assert.equal(notifications, 1)
  if (winner === 'props') {
    assert.equal(committed.custom.instances[0].props.durationSeconds, 900)
    assert.deepEqual(committed.custom.positions, before.custom.positions)
  } else {
    assert.deepEqual(committed.custom.positions['countdown-1'], { x: .9, y: .1 })
    assert.deepEqual(committed.custom.instances, before.custom.instances)
  }
})
