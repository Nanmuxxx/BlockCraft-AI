const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, copy } = require('./helpers.cjs')
const { createProjectRevisionOwner } = require('../../src/integrations/custom-block-bc/owner.ts')
const nextOf = owner => ({ ...copy(owner.getSnapshot()), revision: owner.getSnapshot().revision + 1 })

test('owner directly rejects missing, forged and revoked authorization without writes', async () => {
  const f = await fixture(), owner = f.owner, before = owner.getSnapshot(), token = owner.getAuthorization()
  let notifications = 0
  owner.subscribe(() => notifications++)
  for (const invalid of [undefined, { readOnly: false }, Object.freeze({ ...token })]) {
    assert.equal(owner.compareAndSwap(before, nextOf(owner), invalid).error.code, 'AUTHORIZATION_CHANGED')
  }
  owner.setReadOnly(true)
  assert.equal(owner.compareAndSwap(before, nextOf(owner), token).error.code, 'READ_ONLY')
  owner.setReadOnly(false)
  assert.equal(owner.compareAndSwap(before, nextOf(owner), token).error.code, 'AUTHORIZATION_CHANGED')
  assert.strictEqual(owner.getSnapshot(), before)
  assert.equal(f.owner.commits(), 0); assert.equal(notifications, 2, 'only authorization transitions notify')
  assert.ok(Object.isFrozen(owner.getAuthorization()))
  assert.equal(owner.compareAndSwap(before, nextOf(owner), owner.getAuthorization()).ok, true)
  assert.equal(f.owner.commits(), 1); assert.equal(notifications, 3)
})

test('commit before revocation succeeds; revocation before CAS rejects, including direct callers', async () => {
  const f = await fixture(), owner = f.owner, before = owner.getSnapshot(), token = owner.getAuthorization()
  assert.equal(owner.compareAndSwap(before, nextOf(owner), token).ok, true)
  const committed = owner.getSnapshot()
  owner.setReadOnly(true)
  assert.equal(owner.compareAndSwap(committed, nextOf(owner), token).error.code, 'READ_ONLY')
  assert.strictEqual(owner.getSnapshot(), committed); assert.equal(f.owner.commits(), 1)
})

test('owner rejects same-revision foreign snapshots and mutated candidate revision', async () => {
  const f = await fixture(), owner = f.owner, before = owner.getSnapshot()
  assert.equal(owner.compareAndSwap(copy(before), nextOf(owner), owner.getAuthorization()).error.code, 'REVISION_CONFLICT')
  for (const revision of [before.revision, before.revision + 2]) {
    assert.equal(owner.compareAndSwap(before, { ...copy(before), revision }, owner.getAuthorization()).ok, false)
  }
  assert.strictEqual(owner.getSnapshot(), before); assert.equal(f.owner.commits(), 0)
})

test('trusted synchronous persistence cannot reenter commit or revoke mid-publication', async () => {
  const f = await fixture()
  let owner, nested, revocation
  owner = createProjectRevisionOwner(f.owner.getSnapshot(), { persist(next) {
    nested = owner.compareAndSwap(owner.getSnapshot(), next, owner.getAuthorization())
    assert.throws(() => owner.setReadOnly(true), error => { revocation = error.code; return error.code === 'OWNER_BUSY' })
  } })
  let notifications = 0
  owner.subscribe(() => notifications++)
  assert.equal(owner.compareAndSwap(owner.getSnapshot(), nextOf(owner), owner.getAuthorization()).ok, true)
  assert.equal(nested.error.code, 'OWNER_BUSY'); assert.equal(revocation, 'OWNER_BUSY')
  assert.equal(notifications, 1); assert.equal(owner.getAuthorization().readOnly, false)
  owner.setReadOnly(true)
  assert.equal(owner.getAuthorization().readOnly, true)
})

test('persistence failure publishes no snapshot, revision or success notification', async () => {
  const f = await fixture()
  const owner = createProjectRevisionOwner(f.owner.getSnapshot(), { persist() { throw Error('private detail') } })
  const before = owner.getSnapshot()
  let notifications = 0
  owner.subscribe(() => notifications++)
  const result = owner.compareAndSwap(before, nextOf(owner), owner.getAuthorization())
  assert.equal(result.error.code, 'HOST_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(result), /private detail/)
  assert.strictEqual(owner.getSnapshot(), before); assert.equal(notifications, 0)
})

test('owner permits MAX_SAFE_INTEGER - 1 to MAX once; exhausted owner cannot write', async () => {
  const f = await fixture(), initial = copy(f.owner.getSnapshot())
  initial.revision = Number.MAX_SAFE_INTEGER - 1
  const owner = createProjectRevisionOwner(initial)
  assert.equal(owner.compareAndSwap(owner.getSnapshot(), nextOf(owner), owner.getAuthorization()).ok, true)
  const max = owner.getSnapshot()
  assert.equal(max.revision, 9007199254740991)
  assert.equal(owner.compareAndSwap(max, nextOf(owner), owner.getAuthorization()).error.code, 'REVISION_EXHAUSTED')
  assert.strictEqual(owner.getSnapshot(), max)
})

for (const invalid of [-1, .5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
  test(`owner rejects invalid initial and candidate revision ${String(invalid)}`, async () => {
    const f = await fixture(), before = f.owner.getSnapshot()
    assert.throws(() => createProjectRevisionOwner({ ...copy(before), revision: invalid }))
    assert.equal(f.owner.compareAndSwap(before, { ...copy(before), revision: invalid }, f.owner.getAuthorization()).ok, false)
    assert.strictEqual(f.owner.getSnapshot(), before); assert.equal(f.owner.commits(), 0)
  })
}
