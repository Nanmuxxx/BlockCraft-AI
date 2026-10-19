import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'

test('missing API key fails before any interactive budget reservation', async t => {
  let reservations = 0
  const interactive = {
    enabled: true,
    approval: {
      providerVerified: true,
      permissionsVerified: true,
      reference: 'OFFLINE-BUDGET-ORDER',
      maxCalls: 1,
      expiresAt: Date.now() + 60_000,
    },
    allowedOrigin: 'http://127.0.0.1',
    resolveAccess: async () => ({ sessionId: 'offline', appId: 'offline', readOnly: false }),
    reserveBudget: async () => { reservations++; return true },
  }
  const server = createAppServer({
    apiKey: '',
    interactive,
    fetchImpl: async () => { throw new Error('upstream must not run') },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea: '一个番茄钟', protocol: 'trusted-interactive/1' }),
  })
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: { code: 'AI_NOT_CONFIGURED', message: 'AI 服务尚未配置。' } })
  assert.equal(reservations, 0)
})
