import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiConversation } from '../../src/integrations/mochi-ai/client.mjs'
import { context } from './fixtures.mjs'

function fixture() {
  let current = context()
  const api = { status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }),
    consent: async enabled => ({ proactiveEnabled: enabled }), analyze: async () => { throw null } }
  const client = createMochiConversation({ api, readContext: () => { if (current === null) throw null; return current }, focusBlock() {} })
  return { api, client, unavailable: () => { current = null } }
}
const rejectsOriginal = (operation, original) => assert.rejects(operation, error => error === original)
for (const failure of [null, undefined, { code: 'constructor' }, { code: 'toString' }]) {
  const name = failure == null ? String(failure) : failure.code
  test(`analysis adapter rejection ${name} publishes a safe error and releases busy state`, async () => {
    const f = fixture(); await f.client.refreshStatus(); f.api.analyze = async () => { throw failure }
    await rejectsOriginal(f.client.chat('检查这个应用'), failure)
    assert.equal(f.client.getSnapshot().busy, false)
    assert.equal(typeof f.client.getSnapshot().error.message, 'string')
    assert.equal(f.client.getSnapshot().error.code, 'AI_UNAVAILABLE')
    f.client.dispose()
  })
  test(`consent adapter rejection ${name} publishes a safe error and keeps proactive disabled`, async () => {
    const f = fixture(); await f.client.refreshStatus(); f.api.consent = async () => { throw failure }
    await rejectsOriginal(f.client.setProactive(true), failure)
    assert.equal(f.client.getSnapshot().proactiveEnabled, false)
    assert.equal(f.client.getSnapshot().error.code, 'AI_UNAVAILABLE')
    f.client.dispose()
  })
}
test('unavailable context throwing null retires the active transport and clears suggestions', async () => {
  const f = fixture(); await f.client.refreshStatus(); let signal
  f.api.analyze = (_input, options) => { signal = options.signal; return new Promise(() => {}) }
  const pending = f.client.chat('旧问题'), rejected = assert.rejects(pending, { code: 'CONTEXT_CHANGED' })
  f.unavailable(); assert.throws(() => f.client.syncContext(), error => error === null)
  assert.equal(signal.aborted, true)
  assert.equal(f.client.getSnapshot().contextAvailable, false)
  assert.equal(f.client.getSnapshot().busy, false)
  assert.equal(f.client.getSnapshot().error.code, 'CONTEXT_UNAVAILABLE')
  assert.equal(typeof f.client.getSnapshot().error.message, 'string')
  await rejected; f.client.dispose()
})
