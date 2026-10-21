const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, api } = require('./helpers.cjs')
const { createAppRuntime } = require('../../src/model/appRuntime.ts')
const { createClubRegistrationExample } = require('../../src/model/appSpecExamples.ts')

test('vertical mixed B movement atomically persists C order and round trips without data loss', async () => {
  const f = await fixture(), before = f.adapter.getSnapshot()
  const moves = before.renderOrder.map((item, index) => ({ ...item, position: { x: .5, y: (before.renderOrder.length - index) / (before.renderOrder.length + 1) } }))
  assert.equal((await f.adapter.moveBlocks({ baseRevision: before.revision, moves })).ok, true)
  const after = f.adapter.getSnapshot()
  assert.deepEqual(after.renderOrder, [...before.renderOrder].reverse())
  assert.deepEqual(f.adapter.orderedBlocks(after).map(({ kind, id }) => ({ kind, id })), after.renderOrder)
  assert.equal(after.revision, before.revision + 1)
  assert.equal(f.owner.commits(), 1)
  assert.deepEqual(after.base.records, before.base.records)
  assert.deepEqual(after.custom.states, before.custom.states)
  assert.deepEqual((await api.parseCustomProject(JSON.parse(JSON.stringify(after)), f.registry)).renderOrder, after.renderOrder)
  assert.equal((await f.adapter.moveBlocks({ baseRevision: before.revision, moves })).ok, false)
  assert.strictEqual(f.adapter.getSnapshot(), after)
})

test('same row reads left to right; exact ties are stable; invalid layout and read-only never reorder', async () => {
  const f = await fixture(), before = f.adapter.getSnapshot()
  const moves = before.renderOrder.map((item, index) => ({ ...item, position: { x: index ? .2 : .8, y: .5 } }))
  assert.equal((await f.adapter.moveBlocks({ baseRevision: before.revision, moves })).ok, true)
  const after = f.adapter.getSnapshot()
  assert.deepEqual(after.renderOrder, [...before.renderOrder.slice(1), before.renderOrder[0]])
  const request = { baseRevision: after.revision, moves: [{ ...after.renderOrder[0], position: { x: .2, y: -1 } }] }
  assert.equal((await f.adapter.moveBlocks(request)).ok, false)
  assert.strictEqual(f.adapter.getSnapshot(), after)
  f.owner.setReadOnly(true)
  request.moves[0].position.y = .9
  assert.equal((await f.adapter.moveBlocks(request)).ok, false)
  assert.strictEqual(f.adapter.getSnapshot(), after)
})

test('runtime layout updates C ordering; later field and record commits retain it', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const before = runtime.getSnapshot()
  assert.equal(runtime.moveBlock('registration-form', { x: .5, y: 1 }).ok, true)
  const order = runtime.customProject.getSnapshot().renderOrder
  assert.equal(order.at(-1).id, 'registration-form')
  const result = runtime.executeCommand({ requestId: 'field-order', baseRevision: runtime.getSnapshot().revision, commands: [{ type: 'configureBlockFields', blockId: 'registration-form', fieldIds: ['applicant-name', 'department'] }] })
  assert.equal(result.ok, true)
  assert.deepEqual(runtime.customProject.getSnapshot().renderOrder, order)
  assert.deepEqual(runtime.getSnapshot().records, before.records)
})
