import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTestDeployment, prepareTestState, claimMvpBoot, ORIGIN } from '../../server/studio-deployment.mjs'
import { createLivePricingVerifier } from '../../server/paid-gateway/live-pricing.mjs'
import { STUDIO_PRICING as PRICING } from '../../server/paid-gateway/pricing.mjs'
import { request as analysis, advice } from '../mochi-ai/fixtures.mjs'

const html = '<table><tr><td>模型</td><td>deepseek-flash</td><td>deepseek-v4-pro</td></tr><tr><td>高峰时段</td><td>x</td></tr><tr><td>百万tokens输入缓存未命中</td></tr><tr><td>高峰时段</td><td>2元</td><td>x</td></tr><tr><td>百万tokens输出</td></tr><tr><td>高峰时段</td><td>8元</td><td>x</td></tr></table>'
function bytes(directory, prefix = '') {
  const result = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const key = prefix + entry.name, path = join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(result, bytes(path, key + '/'))
    else result[key] = readFileSync(path).toString('base64')
  }
  return result
}

test('authenticated status refreshes expired pricing once, rejects failures, and never changes cumulative budget or receipts', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'studio-status-pricing-'))), access = 'p'.repeat(43)
  chmodSync(directory, 0o700)
  const initial = PRICING.expiresAt - 60_000
  claimMvpBoot({ directory, access, now: initial })
  prepareTestState({ directory: join(directory, 'mvp-5cny-20261022-scope'), access, now: initial })
  let now = Date.now(), requests = 0, egress = 0, invalid = false, gate, started
  const verifyPricing = createLivePricingVerifier({ now: () => now, fetchImpl: async () => {
    requests++; started?.(); if (gate) await gate
    return new Response(invalid ? html.replace('2元', '3元') : html, { headers: { 'Content-Type': 'text/html' } })
  } })
  const server = await startTestDeployment({ directory, host: '127.0.0.1', port: 0, signalHandlers: false,
    mvpSupplemental: true, mochiEnabled: true, studioAuthorization: true, verifyPricing,
    env: { BLOCKCRAFT_TEST_ACCESS: access, DEEPSEEK_API_KEY: 'synthetic-offline-pricing-key' },
    fetchImpl: async () => { egress++; return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(advice()) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) } })
  t.after(async () => { await server.shutdown(); rmSync(directory, { recursive: true, force: true }) })
  const call = (path = '/api/studio/status', body) => fetch(`http://127.0.0.1:${server.server.address().port}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: ORIGIN, Cookie: `__Host-bc_session=${access}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  assert.equal((await call('/api/mochi-ai/analyze', analysis())).status, 200)
  const before = await (await call()).json(), history = bytes(directory)
  assert.equal(before.configured, true); assert.equal(before.budget.calls, 9); assert.equal(egress, 1); assert.equal(requests, 1)
  now += 900_000
  let release
  gate = new Promise(resolve => { release = resolve })
  const refreshing = new Promise(resolve => { started = resolve })
  let finished = false
  const statuses = Promise.all(Array.from({ length: 12 }, () => call().then(r => r.json()))).then(result => { finished = true; return result })
  await refreshing; assert.equal(finished, false); assert.equal(requests, 2)
  release(); gate = null
  for (const status of await statuses) { assert.equal(status.configured, true); assert.deepEqual(status.budget, before.budget) }
  assert.equal(requests, 2); assert.equal(egress, 1); assert.deepEqual(bytes(directory), history)
  now += 900_000; invalid = true
  const failed = await (await call()).json()
  assert.equal(failed.configured, false); assert.equal(failed.authenticated, true); assert.equal(failed.unavailable, 'PRICING_UNVERIFIED')
  assert.deepEqual(failed.budget, before.budget); assert.deepEqual(bytes(directory), history); assert.equal(egress, 1)
  invalid = false
  const recovered = await (await call()).json()
  assert.equal(recovered.configured, true); assert.deepEqual(recovered.budget, before.budget)
  assert.deepEqual(bytes(directory), history); assert.equal(egress, 1); assert.equal(requests, 4)
})

test('an unconfigured deployment never triggers a status pricing fetch', async t => {
  let requests = 0
  const verifyPricing = Object.assign(async () => { requests++ }, { assertCurrent() { throw new Error('unverified') } })
  const server = await startTestDeployment({ host: '127.0.0.1', port: 0, env: {}, signalHandlers: false,
    mvpSupplemental: true, studioAuthorization: true, verifyPricing })
  t.after(() => server.shutdown())
  const status = await (await fetch(`http://127.0.0.1:${server.server.address().port}/api/studio/status`)).json()
  assert.equal(status.configured, false); assert.equal(status.authenticated, false); assert.equal(requests, 0)
})
