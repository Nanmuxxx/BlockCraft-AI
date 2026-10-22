import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { createPaidTransport } from '../../server/paid-gateway/provider.mjs'
import { createLocalAccess } from '../../server/paid-gateway/access.mjs'
import { PRICING, POLICY } from '../../server/paid-gateway/pricing.mjs'
import { createDeepSeekProvider as custom } from '../../server/custom-block/provider.mjs'
import { createDeepSeekProvider as mochi } from '../../server/mochi-ai/provider.mjs'
import { cases } from '../generation/fixtures.mjs'
import { request, advice } from '../mochi-ai/fixtures.mjs'
const key = 'OFFLINE-ONLY-NOT-A-REAL-API-KEY'
const token = 'a'.repeat(64)
const v2 = JSON.parse(readFileSync(new URL('../trusted-interactive/pomodoro.json', import.meta.url)))
const envelope = value => Response.json({ model: PRICING.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }], usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 } })
function setup(t, value) {
  const dir = mkdtempSync(join(tmpdir(), 'core-composition-')); chmodSync(dir, 0o700)
  const ledger = openLedger(join(dir, 'ledger.json'), { now: () => PRICING.expiresAt - 1 }); let calls = 0
  const transport = createPaidTransport({ apiKey: key, ledger, fetchImpl: async () => { calls++; return envelope(value) } })
  t.after(() => { ledger.close(); rmSync(dir, { recursive: true, force: true }) })
  return { ledger, transport, calls: () => calls }
}
async function serve(t, gateway, extra = {}) {
  const server = createAppServer({ apiKey: key, model: PRICING.model, fetchImpl: gateway.transport,
    generationAccess: createLocalAccess(token), ...extra })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  return (body, authorized = true) => fetch(`http://127.0.0.1:${server.address().port}/api/ai/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  })
}
const interactive = () => ({ enabled: true, approval: { providerVerified: true, permissionsVerified: true, reference: 'OFFLINE-TEST-ONLY', maxCalls: 40, expiresAt: Date.now() + 600000 }, allowedOrigin: 'http://offline.test', resolveAccess: async () => ({ sessionId: 's', appId: 'a', readOnly: false }), reserveBudget: async () => true })
for (const [name, value, body] of [['v1', cases[0].spec, { idea: cases[0].idea }], ['v2', v2, { idea: '创建番茄钟', protocol: 'trusted-interactive/1' }]]) {
  test(`${name}: real gateway implementation composes auth, validation and durable budget with mock egress`, async t => {
    const g = setup(t, value), post = await serve(t, g, { interactive: interactive() })
    assert.equal((await post(body, false)).status, 401); assert.equal(g.calls(), 0); assert.equal(g.ledger.snapshot().entries.length, 0)
    for (let i = 0; i < POLICY.maxCalls; i++) {
      const response = await post(body); assert.equal(response.status, 200, await response.clone().text())
      const output = await response.json(); assert.deepEqual(output.spec ?? output, value)
    }
    assert.notEqual((await post(body)).status, 200)
    assert.equal(g.calls(), POLICY.maxCalls); assert.equal(g.ledger.snapshot().entries.length, POLICY.maxCalls)
  })
}
test('legacy model alias is rejected before network/reservation; matching CustomBlock model contract is explicit', async t => {
  const g = setup(t, cases[0].spec), post = await serve(t, g, { model: 'deepseek-v4-flash' })
  assert.notEqual((await post({ idea: cases[0].idea })).status, 200)
  assert.equal(g.calls(), 0); assert.equal(g.ledger.snapshot().entries.length, 0)
  // Owner's exact model-contract patch permits explicit priced configuration.
  assert.ok(custom({ allowPaid: true, apiKey: key, model: PRICING.model, fetchImpl: g.transport }))
})
test('Mochi native egress rejects and explicit matching gateway produces validated advice offline', async t => {
  await assert.rejects(mochi({ apiKey: key }).analyze(request()), { code: 'AI_DISABLED' })
  const g = setup(t, advice())
  assert.deepEqual(await mochi({ apiKey: key, model: PRICING.model, fetchImpl: g.transport }).analyze(request()), advice())
  assert.equal(g.calls(), 1); assert.equal(g.ledger.snapshot().entries[0].status, 'settled')
})
