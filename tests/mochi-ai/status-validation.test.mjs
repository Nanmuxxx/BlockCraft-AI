import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiConversation } from '../../src/integrations/mochi-ai/client.mjs'
import { context } from './fixtures.mjs'

for (const invalid of [null, { enabled: true, proactiveEnabled: false, modificationsEnabled: true }, { enabled: 'true', proactiveEnabled: false, modificationsEnabled: false }]) {
  test(`invalid status retires prior enabled capability: ${JSON.stringify(invalid)}`, async () => {
    let status = { enabled: true, proactiveEnabled: true, modificationsEnabled: false }, analyzeCalls = 0
    const client = createMochiConversation({ readContext: context, focusBlock() {}, api: {
      status: async () => status,
      analyze: async () => { analyzeCalls++; throw Error('must not send') },
    } })
    await client.refreshStatus()
    assert.equal(client.getSnapshot().enabled, true)
    status = invalid
    await assert.rejects(client.refreshStatus(), { code: 'AI_INVALID_RESPONSE' })
    assert.equal(client.getSnapshot().enabled, false)
    assert.equal(client.getSnapshot().proactiveEnabled, false)
    await assert.rejects(client.chat('仍可调用吗？'), { code: 'AI_DISABLED' })
    assert.equal(analyzeCalls, 0)
    client.dispose()
  })
}

test('invalid latest status aborts active advice without publishing another enabled state', async () => {
  let status = { enabled: true, proactiveEnabled: false, modificationsEnabled: false }
  let analyzeCalls = 0
  const client = createMochiConversation({ readContext: context, focusBlock() {}, api: {
    status: async () => status,
    analyze: () => { analyzeCalls++; return new Promise(() => {}) },
  } })
  await client.refreshStatus(); client.syncContext()
  const pending = client.chat('旧请求')
  const retired = assert.rejects(pending, { code: 'CONTEXT_CHANGED' })
  const published = []
  const off = client.subscribe(() => published.push(client.getSnapshot().enabled))
  status = { enabled: true, proactiveEnabled: false, modificationsEnabled: true }
  await assert.rejects(client.refreshStatus(), { code: 'AI_INVALID_RESPONSE' })
  await retired
  assert.deepEqual(published, [false])
  assert.equal(analyzeCalls, 1)
  assert.equal(client.getSnapshot().busy, false)
  off(); client.dispose()
})

for (const reason of ['constructor', '__proto__', 'toString']) test(`status reason ${reason} cannot use an inherited message`, async () => {
  const client = createMochiConversation({ readContext: context, focusBlock() {}, api: {
    status: async () => ({ enabled: false, proactiveEnabled: false, modificationsEnabled: false, reason }),
  } })
  await client.refreshStatus()
  assert.equal(client.getSnapshot().disabledReason, 'Mochi AI 尚未启用。')
  client.dispose()
})

test('an adapter rejecting with null still disables the conversation', async () => {
  let fail = false
  const client = createMochiConversation({ readContext: context, focusBlock() {}, api: {
    status: async () => { if (fail) throw null; return { enabled: true, proactiveEnabled: false, modificationsEnabled: false } },
  } })
  await client.refreshStatus(); fail = true
  await assert.rejects(client.refreshStatus(), value => value === null)
  assert.equal(client.getSnapshot().enabled, false)
  assert.equal(typeof client.getSnapshot().disabledReason, 'string')
  client.dispose()
})
