import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTestDeployment, prepareTestState, claimMvpBoot, ORIGIN } from '../../server/studio-deployment.mjs'
import { STUDIO_PRICING as PRICING, STUDIO_AUTHORIZATION } from '../../server/paid-gateway/pricing.mjs'
import { request as analysis, advice } from '../mochi-ai/fixtures.mjs'

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt - 60_000 })
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'studio-continuity-')))
  chmodSync(parent, 0o700)
  const directory = join(parent, 'state'), access = 's'.repeat(43)
  const grant = claimMvpBoot({ directory, access })
  const scope = join(directory, 'mvp-5cny-20261022-scope')
  prepareTestState({ directory: scope, access })
  const originalApproval = readFileSync(join(scope, 'approval.json'))
  const originalReceipt = readFileSync(join(scope, 'deployment-receipt.json'))
  const originalMarker = readFileSync(join(directory, 'mvp-5cny-20261022-allowance-spent.json'))
  let server, egress = 0, priceValid = true
  const verifyPricing = Object.assign(async () => { if (!priceValid) throw Object.assign(new Error('PRICING_UNVERIFIED'), { code: 'PRICING_UNVERIFIED' }) },
    { assertCurrent() { if (!priceValid) throw Object.assign(new Error('PRICING_UNVERIFIED'), { code: 'PRICING_UNVERIFIED' }) } })
  const options = { directory, host: '127.0.0.1', port: 0, signalHandlers: false, mvpSupplemental: true, mochiEnabled: true, studioAuthorization: true, verifyPricing,
    env: { BLOCKCRAFT_TEST_ACCESS: access, DEEPSEEK_API_KEY: 'synthetic-offline-continuity-key' },
    fetchImpl: async () => { egress++; return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(advice()) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) } }
  t.after(async () => { await server?.shutdown(); rmSync(parent, { recursive: true, force: true }) })
  return { directory, scope, access, grant, originalApproval, originalReceipt, originalMarker,
    get egress() { return egress }, set priceValid(value) { priceValid = value },
    async start() { server = await startTestDeployment(options); return server },
    async stop() { await server?.shutdown(); server = undefined } }
}
function call(s, access, path, body) {
  return fetch(`http://127.0.0.1:${s.server.address().port}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: ORIGIN, Cookie: `__Host-bc_session=${access}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

test('explicit lifetime authorization works after original deadline; original records and cumulative allowance survive restart', async t => {
  const f = fixture(t)
  t.mock.timers.setTime(PRICING.expiresAt + 86400_000)
  let s = await f.start()
  let status = await (await call(s, f.access, '/api/studio/status')).json()
  assert.equal(status.configured, true); assert.equal(status.authenticated, true)
  assert.equal(status.expiresAt, STUDIO_AUTHORIZATION.expiresAt)
  assert.deepEqual(status.budget, { calls: 8, maxCalls: 100, capCny: 5, reservedCny: 0.280314, remainingCalls: 92, remainingCny: 4.719686, halted: false })
  const login = await call(s, f.access, '/api/studio/session', { credential: f.access })
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /Max-Age=2592000/)
  assert.equal((await call(s, f.access, '/api/mochi-ai/analyze', analysis())).status, 200)
  assert.equal(f.egress, 1)
  assert.deepEqual(readFileSync(join(f.scope, 'approval.pre-lifetime-v1.json')), f.originalApproval)
  assert.deepEqual(readFileSync(join(f.scope, 'deployment-receipt.json')), f.originalReceipt)
  assert.deepEqual(readFileSync(join(f.directory, 'mvp-5cny-20261022-allowance-spent.json')), f.originalMarker)
  status = await (await call(s, f.access, '/api/studio/status')).json()
  const beforeRestart = status.budget
  assert.equal(beforeRestart.calls, 9); assert.ok(beforeRestart.reservedCny > 0.280314)
  await f.stop(); s = await f.start()
  status = await (await call(s, f.access, '/api/studio/status')).json()
  assert.equal(status.configured, true); assert.deepEqual(status.budget, beforeRestart)
  f.priceValid = false
  assert.equal((await call(s, f.access, '/api/mochi-ai/analyze', analysis())).status, 502)
  assert.equal(f.egress, 1)
  assert.equal(JSON.parse(readFileSync(join(f.scope, 'studio-ledger.json'))).entries.length, 1)
})

test('tampered lifetime renewal and mismatched attempt history disable paid startup without resetting history', async t => {
  for (const damage of ['renewal', 'history']) {
    const f = fixture(t)
    if (damage === 'history') await f.grant.wrap(async () => Response.json({ ok: true }))('https://api.deepseek.com/chat/completions')
    else { await f.start(); await f.stop(); writeFileSync(join(f.scope, 'studio-lifetime-authorization-v1.json'), '{}') }
    const ledger = readFileSync(join(f.scope, 'studio-ledger.json'))
    t.mock.timers.setTime(PRICING.expiresAt + 86400_000)
    const s = await f.start(), status = await (await call(s, f.access, '/api/studio/status')).json()
    assert.equal(status.configured, false); assert.equal(status.unavailable, 'AI_AUTHORIZATION_LOCKED')
    assert.equal(f.egress, 0); assert.deepEqual(readFileSync(join(f.scope, 'studio-ledger.json')), ledger)
    await f.stop()
    t.mock.timers.reset()
  }
})

test('unverified current quote disables startup before any paid attempt; legacy default retains expiry', async t => {
  const f = fixture(t); f.priceValid = false
  t.mock.timers.setTime(PRICING.expiresAt + 86400_000)
  const before = readFileSync(join(f.scope, 'studio-ledger.json'))
  const s = await f.start(), status = await (await call(s, f.access, '/api/studio/status')).json()
  assert.equal(status.configured, false); assert.equal(status.unavailable, 'PRICING_UNVERIFIED')
  assert.equal(f.egress, 0); assert.deepEqual(readFileSync(join(f.scope, 'studio-ledger.json')), before)
  assert.throws(() => prepareTestState({ directory: f.scope, access: f.access }), /TEST_STATE_REFUSED/)
})

test('history mismatch diagnostics expose only counts and booleans while paid startup remains locked', async t => {
  const logs = []
  const logger = t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')))
  t.after(() => logger.mock.restore())
  for (const damage of ['count', 'receipt']) {
    const f = fixture(t)
    let privateValues = [f.access, 'synthetic-offline-continuity-key']
    if (damage === 'count') {
      await f.grant.wrap(async () => Response.json({ ok: true }))('https://api.deepseek.com/chat/completions')
    } else {
      const s = await f.start()
      assert.equal((await call(s, f.access, '/api/mochi-ai/analyze', analysis())).status, 200)
      await f.stop()
      const path = join(f.directory, 'mvp-5cny-attempt-1.json')
      const record = JSON.parse(readFileSync(path))
      privateValues.push(record.bootId, record.mac, 'private-boot-sentinel', 'private-signature-sentinel')
      writeFileSync(path, JSON.stringify({ ...record, bootId: 'private-boot-sentinel', mac: 'private-signature-sentinel' }))
    }
    const before = readFileSync(join(f.scope, 'studio-ledger.json')), callsBefore = f.egress, logStart = logs.length
    t.mock.timers.setTime(PRICING.expiresAt + 86400_000)
    const s = await f.start(), status = await (await call(s, f.access, '/api/studio/status')).json()
    assert.equal(status.configured, false)
    assert.equal(status.unavailable, 'AI_AUTHORIZATION_LOCKED')
    assert.equal(f.egress, callsBefore)
    assert.deepEqual(readFileSync(join(f.scope, 'studio-ledger.json')), before)
    const emitted = logs.slice(logStart)
    for (const secret of privateValues) assert.ok(emitted.every(line => !line.includes(secret)))
    const diagnostics = emitted.map(line => JSON.parse(line)).filter(record => record.event === 'studio-test-mvp-history-check')
    assert.equal(diagnostics.length, 1)
    const diagnostic = diagnostics[0]
    const fields = damage === 'count'
      ? ['event', 'ledgerEntries', 'attemptReceipts', 'countersContinuous']
      : ['event', 'ledgerEntries', 'attemptReceipts', 'receiptIndex', 'versionMatches', 'bootMatches', 'counterMatches', 'stateMatches', 'signatureMatches']
    assert.deepEqual(Object.keys(diagnostic).sort(), fields.sort())
    for (const [name, value] of Object.entries(diagnostic)) {
      if (name === 'event') continue
      if (['ledgerEntries', 'attemptReceipts', 'receiptIndex'].includes(name)) assert.ok(Number.isSafeInteger(value) && value >= 0)
      else assert.equal(typeof value, 'boolean')
    }
    if (damage === 'receipt') {
      assert.equal(diagnostic.bootMatches, false)
      assert.equal(diagnostic.signatureMatches, false)
    }
    await f.stop()
    t.mock.timers.reset()
  }
})
