import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'
import { access, grant, request } from './fixtures.mjs'

test('production server mounts routes but requires trusted access and durable cost control', async t => {
  let calls = 0
  for (const kind of ['default', 'missing-budget', 'foreign-project']) {
    const mochi = kind === 'default' ? undefined : { enabled: true, approval: grant(Date.now()),
      allowedOrigin: 'http://localhost:offline', resolveAccess: () => kind === 'foreign-project' ? { ...access, appId: 'foreign' } : access,
      ...(kind === 'foreign-project' ? { reserveBudget: () => true } : {}) }
    // Only a trusted server adapter supplies access; never the client headers.
    const server = createAppServer({ apiKey: 'OFFLINE FIXTURE', fetchImpl: async () => { calls++; throw new Error('forbidden egress') }, mochi })
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `http://127.0.0.1:${server.address().port}`
    try {
      const status = await (await fetch(`${origin}/api/mochi-ai/status`)).json()
      assert.equal(status.enabled, kind === 'foreign-project'); assert.equal(status.modificationsEnabled, false)
      if (kind === 'default') assert.equal(status.reason, 'ACCESS_UNAVAILABLE')
      if (kind === 'missing-budget') assert.equal(status.reason, 'BUDGET_UNAVAILABLE')
      const response = await fetch(`${origin}/api/mochi-ai/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-id': access.appId }, body: JSON.stringify(request()) })
      assert.equal(response.status, kind === 'foreign-project' ? 409 : 503)
      assert.equal((await fetch(`${origin}/api/health`)).status, 200)
    } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
  }
  assert.equal(calls, 0)
})
