import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiConversation } from '../../src/integrations/mochi-ai/client.mjs'
import { context } from './fixtures.mjs'

test('disposing a conversation prevents its queued opt-in and delayed status egress', { timeout: 1000 }, async () => {
  let finish, statusCalls = 0
  const writes = []
  const client = createMochiConversation({ readContext: context, focusBlock() {}, api: {
    consent: enabled => { writes.push(enabled); return enabled ? Promise.resolve({ proactiveEnabled: true }) : new Promise(resolve => { finish = () => resolve({ proactiveEnabled: false }) }) },
    status: async () => { statusCalls++; return { enabled: true, proactiveEnabled: false, modificationsEnabled: false } },
  } })
  const off = client.setProactive(false)
  const on = client.setProactive(true)
  const rejected = assert.rejects(on, { code: 'DISPOSED' })
  const status = client.refreshStatus()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(writes, [false])
  client.dispose(); finish()
  await off; await rejected; await status
  assert.deepEqual(writes, [false])
  assert.equal(statusCalls, 0)
})

test('an explicitly queued opt-out still revokes after disposal and an already sent opt-in', async () => {
  let finish, server = false
  const writes = []
  const client = createMochiConversation({ readContext: context, focusBlock() {}, api: {
    consent: enabled => {
      writes.push(enabled); server = enabled
      return enabled ? new Promise(resolve => { finish = () => resolve({ proactiveEnabled: true }) }) : Promise.resolve({ proactiveEnabled: false })
    },
  } })
  const on = client.setProactive(true)
  const off = client.setProactive(false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(server, true)
  client.dispose(); finish()
  await Promise.all([on, off])
  assert.deepEqual(writes, [true, false])
  assert.equal(server, false)
})
