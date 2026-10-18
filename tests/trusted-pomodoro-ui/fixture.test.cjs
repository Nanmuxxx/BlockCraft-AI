const test = require('node:test')
const assert = require('node:assert/strict')
require('../custom-block/fixtures.cjs')
const { loadTrustedPomodoroFixture, trustedPomodoroSource } = require('../../src/components/ai-create/trustedPomodoroFixture.ts')
const { assertProjectState } = require('../../src/model/appSpecValidation.ts')
test('bundled fixture validates completely, never fetches, and isolates each new project', async t => {
  const original = global.fetch
  t.after(() => { global.fetch = original })
  global.fetch = () => { throw Error('offline demo must never fetch') }
  const a = await loadTrustedPomodoroFixture(), b = await loadTrustedPomodoroFixture()
  assertProjectState(a)
  assert.equal(a.spec.version, 2)
  assert.equal(a.spec.blocks.length, 1)
  assert.deepEqual(a.spec.blocks[0], { id: 'focus-timer', name: '数学专注', type: 'pomodoro', protocolVersion: 1, durationSeconds: 1500 })
  assert.deepEqual(a.records, {})
  assert.notEqual(a, b)
  a.spec.blocks[0].name = 'changed'
  assert.equal(b.spec.blocks[0].name, '数学专注')
  assert.equal(trustedPomodoroSource, '离线固定 Fixture，非真实 DeepSeek 调用')
})
test('fixture loader refuses both an already cancelled request and cancellation during await', async () => {
  const before = new AbortController(); before.abort()
  await assert.rejects(loadTrustedPomodoroFixture(before.signal), { name: 'AbortError' })
  const during = new AbortController(), pending = loadTrustedPomodoroFixture(during.signal)
  during.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
