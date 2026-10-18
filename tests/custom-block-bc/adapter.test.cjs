const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, copy, api } = require('./helpers.cjs')
const { createCustomBlockBCAdapter, createLayoutBatch } = require('../../src/integrations/custom-block-bc/adapter.ts')
const { applyRecordChange } = require('../../src/model/appRuntime.ts')

test('B/C delegate to the exact same owner snapshot, subscription and revision', async () => {
  const f = await fixture(), b = f.adapter, c = await createCustomBlockBCAdapter(f.owner, f.registry)
  let notifications = 0
  const stop = c.subscribe(() => notifications++)
  assert.strictEqual(b.getSnapshot(), c.getSnapshot())
  const before = b.getSnapshot(), props = { ...before.custom.instances[0].props, durationSeconds: 900 }
  const result = await b.editProps(f.propsRequest(props))
  assert.equal(result.ok, true); assert.equal(notifications, 1)
  assert.strictEqual(b.getSnapshot(), c.getSnapshot())
  assert.equal(c.getSnapshot().custom.instances[0].props.durationSeconds, 900)
  assert.equal(c.getSnapshot().revision, before.revision + 1)
  assert.equal('revision' in c.getSnapshot().base, false)
  assert.deepEqual(c.getSnapshot().custom.states, before.custom.states)
  assert.deepEqual(c.getSnapshot().base, before.base)
  assert.deepEqual(c.getSnapshot().renderOrder, before.renderOrder)
  assert.ok(Object.isFrozen(c.getSnapshot().custom.instances[0].props))
  stop(); await b.editProps(f.propsRequest()); assert.equal(notifications, 1)
})
test('renderOrder interleaves both kinds and view metadata never contains sources', async () => {
  const f = await fixture(), before = f.adapter.getSnapshot()
  const ordered = f.adapter.orderedBlocks(before)
  assert.deepEqual(ordered.map(({ kind, id }) => ({ kind, id })), before.renderOrder)
  assert.equal(ordered[1].kind, 'custom')
  assert.doesNotMatch(JSON.stringify(ordered), /fixture must never execute|sources|toolchain/)
  assert.equal(f.adapter.manifestFor({ ...f.reference, versionDigest: `sha256:${'0'.repeat(64)}` }), undefined)
  assert.ok(Object.isFrozen(ordered[1].manifest.propsSchema))
})
test('mixed builtin/custom movement is one persisted transaction, round trips through v2 parsing', async () => {
  const f = await fixture(), before = f.adapter.getSnapshot()
  const builtin = before.base.spec.blocks[0].id
  const moves = [{ kind: 'custom', id: 'countdown-1', position: { x: .7, y: .5 } }, { kind: 'builtin', id: builtin, position: { x: .3, y: .2 } }]
  assert.equal((await f.adapter.moveBlocks({ baseRevision: before.revision, moves })).ok, true)
  const after = f.adapter.getSnapshot()
  assert.equal(f.owner.commits(), 1); assert.equal(after.revision, before.revision + 1)
  assert.deepEqual(after.custom.positions['countdown-1'], moves[0].position)
  assert.deepEqual(after.base.blockPositions[builtin], moves[1].position)
  assert.deepEqual(after.custom.instances, before.custom.instances)
  assert.deepEqual(after.base.records, before.base.records)
  const reloaded = await api.parseCustomProject(JSON.parse(JSON.stringify(after)), f.registry)
  assert.deepEqual(reloaded, after)
})
for (const invalid of [
  { durationSeconds: 0 }, { durationSeconds: 1.5 }, { durationSeconds: 86401 },
  { durationSeconds: '900' }, { enabled: 'false' }, { enabled: null }, { mode: 'unknown' },
  { title: '' }, { title: 'x'.repeat(41) }, { precision: Infinity }, { precision: NaN },
  { style: {} }, { style: { caption: 'x', unknown: true } }, { extra: true },
]) test(`props are host validated: ${JSON.stringify(invalid)}`, async () => {
  const f = await fixture(), before = f.adapter.getSnapshot()
  const result = await f.adapter.editProps(f.propsRequest({ ...before.custom.instances[0].props, ...invalid }))
  assert.equal(result.ok, false); assert.strictEqual(f.adapter.getSnapshot(), before); assert.equal(f.owner.commits(), 0)
})
test('optional nested properties can be added and removed; all scalar enum types retain type', async () => {
  const f = await fixture()
  let props = { ...f.propsRequest().props, style: { caption: '说明' }, precision: .125, enabled: false, mode: 'full' }
  assert.equal((await f.adapter.editProps(f.propsRequest(props))).ok, true)
  assert.deepEqual(f.adapter.getSnapshot().custom.instances[0].props, props)
  delete props.style
  assert.equal((await f.adapter.editProps(f.propsRequest(props))).ok, true)
  assert.equal('style' in f.adapter.getSnapshot().custom.instances[0].props, false)
})
test('forged refs/instances/unknown fields and accessors cannot write or run getters', async () => {
  const f = await fixture(), before = f.adapter.getSnapshot()
  let reads = 0
  for (const request of [
    { ...f.propsRequest(), reference: { ...f.reference, definitionId: 'other' } },
    { ...f.propsRequest(), reference: { ...f.reference, versionDigest: `sha256:${'0'.repeat(64)}` } },
    { ...f.propsRequest(), reference: { ...f.reference, latest: true } },
    { ...f.propsRequest(), instanceId: 'missing' },
    { ...f.propsRequest(), grant: true },
    { ...f.propsRequest(), props: JSON.parse('{"__proto__":{}}') },
    { ...f.propsRequest(), props: { get durationSeconds() { reads++; return 900 } } },
  ]) assert.equal((await f.adapter.editProps(request)).ok, false)
  assert.equal(reads, 0); assert.strictEqual(f.adapter.getSnapshot(), before)
})
test('draft is copied before async registry work, registry tampering/missing versions fail closed', async () => {
  const f = await fixture(), props = f.propsRequest().props
  props.durationSeconds = 800
  const pending = f.adapter.editProps(f.propsRequest(props))
  props.durationSeconds = 999
  assert.equal((await pending).ok, true)
  assert.equal(f.adapter.getSnapshot().custom.instances[0].props.durationSeconds, 800)
  const before = f.adapter.getSnapshot()
  f.source.sources['src/Counter.tsx'] = 'tampered'
  assert.equal((await f.adapter.editProps(f.propsRequest())).error.code, 'DIGEST_MISMATCH')
  f.registry.resolve = async () => undefined
  assert.equal((await f.adapter.editProps(f.propsRequest())).error.code, 'VERSION_MISSING')
  assert.strictEqual(f.adapter.getSnapshot(), before)
})
test('parallel edits share CAS, stale drafts do not retry or overwrite later records', async () => {
  const f = await fixture(), before = f.adapter.getSnapshot(), request = f.propsRequest()
  const pending = f.adapter.editProps({ ...request, props: { ...request.props, durationSeconds: 900 } })
  const v1 = applyRecordChange({ revision: before.revision, ...before.base }, { type: 'create', entityId: 'books', record: { id: 'later-book', values: { 'book-title': '并发记录' } } })
  const { revision, ...base } = v1
  const external = { ...copy(before), revision, base }
  assert.equal(f.owner.compareAndSwap(before, external, f.owner.getAuthorization()).ok, true)
  assert.equal((await pending).error.code, 'REVISION_CONFLICT')
  assert.strictEqual(f.adapter.getSnapshot(), external)
  assert.equal((await f.adapter.editProps(request)).error.code, 'REVISION_CONFLICT')
  const results = await Promise.all([f.adapter.editProps(f.propsRequest()), f.adapter.editProps(f.propsRequest())])
  assert.equal(results.filter(r => r.ok).length, 1)
  assert.equal(results.filter(r => !r.ok && r.error.code === 'REVISION_CONFLICT').length, 1)
})
for (const moves of [
  [], [{ kind: 'custom', id: 'missing', position: { x: .5, y: .5 } }],
  [{ kind: 'builtin', id: 'countdown-1', position: { x: .5, y: .5 } }],
  [{ kind: 'custom', id: 'countdown-1', position: { x: -1, y: .5 } }],
  [{ kind: 'custom', id: 'countdown-1', position: { x: .5, y: Infinity } }],
  [{ kind: 'custom', id: 'countdown-1', position: { x: .5, y: .5, z: 0 } }],
  Array(2).fill({ kind: 'custom', id: 'countdown-1', position: { x: .5, y: .5 } }),
]) test(`invalid layout batch remains atomic: ${JSON.stringify(moves)}`, async () => {
  const f = await fixture(), before = f.adapter.getSnapshot()
  assert.equal((await f.adapter.moveBlocks({ baseRevision: before.revision, moves })).ok, false)
  assert.strictEqual(f.adapter.getSnapshot(), before)
})
test('layout callback batches a whole mixed stack, one notification and one revision', async () => {
  const f = await fixture(), snapshot = f.adapter.getSnapshot()
  const done = new Promise(resolve => {
    const move = createLayoutBatch(f.adapter, resolve)
    move(snapshot, 'custom', 'countdown-1', { x: .5, y: .5 })
    move(snapshot, 'builtin', snapshot.base.spec.blocks[0].id, { x: .5, y: .3 })
  })
  assert.equal((await done).ok, true); assert.equal(f.owner.commits(), 1)
})
test('host exceptions are redacted; failed persistence never reports success', async () => {
  const f = await fixture(), before = f.adapter.getSnapshot()
  f.owner.compareAndSwap = () => { throw Error('secret persistence detail') }
  const result = await f.adapter.editProps(f.propsRequest())
  assert.equal(result.error.code, 'HOST_UNAVAILABLE')
  assert.doesNotMatch(JSON.stringify(result), /secret/)
  assert.strictEqual(f.adapter.getSnapshot(), before)
})
