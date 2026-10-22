import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { claimMvpBoot, prepareTestState, startTestDeployment, ORIGIN } from '../../server/studio-deployment.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { STUDIO_PRICING as PRICING, STUDIO_MVP_POLICY } from '../../server/paid-gateway/pricing.mjs'

function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'studio-legacy-'))), access = 'q'.repeat(43)
  chmodSync(directory, 0o700)
  const now = PRICING.expiresAt - 60_000
  claimMvpBoot({ directory, access, now })
  const scope = join(directory, 'mvp-5cny-20261022-scope')
  prepareTestState({ directory: scope, access, now })
  const primary = openLedger(join(scope, 'studio-ledger.json'), { policy: STUDIO_MVP_POLICY, profile: 'studio-mvp', pricingGuard: () => {} })
  for (let i = 0; i < 73; i++) primary.settle(primary.reserve(100, 100, 'a'.repeat(64)), { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })
  primary.close()
  const marker = JSON.parse(readFileSync(join(directory, 'mvp-5cny-20261022-allowance-spent.json')))
  const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify({ ...value, mac: createHmac('sha256', access).update(JSON.stringify(value)).digest('hex') }), { mode: 0o600 })
  const oldExpiry = Date.parse('2026-10-22T00:00:00+08:00'), oldAt = oldExpiry - 60_000, bootId = 'e'.repeat(32)
  save('mvp-5cny-20261021-allowance-spent.json', { version: 1, policy: 'OWNER-APPROVED-STUDIO-MVP-5-CNY-20261021', bootId,
    spentAt: oldAt, expiresAt: oldExpiry, maxCalls: 8, reservedCny: 5, restart: 'paid-disabled' })
  const oldScope = join(directory, 'mvp-5cny-20261021-scope'); mkdirSync(oldScope, { mode: 0o700 })
  writeFileSync(join(oldScope, 'studio-ledger.json'), JSON.stringify({ version: 3, approval: 'OWNER-APPROVED-STUDIO-MVP-5-CNY-20261021',
    profile: 'studio-mvp', pricing: { ...PRICING, verifiedDate: '2026-10-21', expiresAt: oldExpiry }, entries: [], halted: false }), { mode: 0o600 })
  for (let call = 1; call <= 74; call++) {
    const at = call === 1 ? oldAt : now, id = call === 1 ? bootId : marker.bootId
    save(`mvp-5cny-attempt-${call}.json`, { version: 1, bootId: id, call, at, state: 'attempt-reserved' })
    save(`mvp-5cny-response-${call}.json`, { version: 1, bootId: id, call, at: at + 1, status: 200 })
  }
  let server, egress = 0
  t.after(async () => { await server?.shutdown(); rmSync(directory, { recursive: true, force: true }) })
  const status = async () => {
    server = await startTestDeployment({ directory, host: '127.0.0.1', port: 0, signalHandlers: false, mvpSupplemental: true, mochiEnabled: true, studioAuthorization: true,
      env: { BLOCKCRAFT_TEST_ACCESS: access, DEEPSEEK_API_KEY: 'offline-legacy-only' },
      verifyPricing: Object.assign(async () => {}, { assertCurrent() {} }), fetchImpl: async () => { egress++; throw new Error('NO_NETWORK_EXPECTED') } })
    return (await fetch(`http://127.0.0.1:${server.server.address().port}/api/studio/status`, { headers: { Cookie: `__Host-bc_session=${access}`, Origin: ORIGIN } })).json()
  }
  return { directory, scope, oldScope, save, status, get egress() { return egress }, async stop() { await server?.shutdown(); server = undefined } }
}

test('actual 1 legacy + 73 current + 8 local layout seeds 82, preserves original bytes, and survives restart', async t => {
  const f = fixture(t)
  const paths = ['mvp-5cny-20261021-allowance-spent.json', 'mvp-5cny-attempt-1.json', 'mvp-5cny-response-1.json']
  const before = paths.map(p => readFileSync(join(f.directory, p)))
  const primaryBefore = JSON.parse(readFileSync(join(f.scope, 'studio-ledger.json'))).entries
  const s = await f.status()
  assert.equal(s.configured, true); assert.equal(s.authenticated, true)
  assert.equal(s.budget.calls, 82); assert.equal(s.budget.remainingCalls, 18)
  assert.equal(s.budget.reservedCny, (280_314_000 + 212_992_000 + 73 * 10_000) / 1e9)
  assert.deepEqual(JSON.parse(readFileSync(join(f.scope, 'studio-ledger.json'))).entries, primaryBefore)
  await f.stop()
  assert.deepEqual((await f.status()).budget, s.budget)
  paths.forEach((p, i) => assert.deepEqual(readFileSync(join(f.directory, p)), before[i]))
  assert.equal(f.egress, 0)
})

for (const damage of ['signature', 'missing-response', 'overlap', 'wrong-status', 'negative-time', 'old-scope', 'old-pricing', 'extra-response', 'extra-attempt', 'second-legacy', 'migration-missing-copy', 'evidence-change']) {
  test(`legacy ${damage} fails closed, preserves current entries, and sends no provider request`, async t => {
    const f = fixture(t)
    const mutate = (name, fn) => { const value = JSON.parse(readFileSync(join(f.directory, name))); delete value.mac; f.save(name, fn(value)) }
    if (damage.startsWith('migration-') || damage === 'evidence-change') { assert.equal((await f.status()).configured, true); await f.stop() }
    if (damage === 'signature') writeFileSync(join(f.directory, 'mvp-5cny-response-1.json'), '{}')
    if (damage === 'missing-response') unlinkSync(join(f.directory, 'mvp-5cny-response-1.json'))
    if (damage === 'overlap') mutate('mvp-5cny-response-1.json', v => ({ ...v, at: Date.parse('2026-10-22T12:45:01.006Z') }))
    if (damage === 'wrong-status') mutate('mvp-5cny-response-1.json', v => ({ ...v, status: 500 }))
    if (damage === 'negative-time') mutate('mvp-5cny-20261021-allowance-spent.json', v => ({ ...v, spentAt: -1 }))
    if (damage === 'old-scope' || damage === 'old-pricing') {
      const p = join(f.oldScope, 'studio-ledger.json'), v = JSON.parse(readFileSync(p))
      if (damage === 'old-scope') v.halted = true; else v.pricing.model = 'different'
      writeFileSync(p, JSON.stringify(v))
    }
    if (damage === 'extra-response') f.save('mvp-5cny-response-075.json', { version: 1 })
    if (damage === 'extra-attempt') f.save('mvp-5cny-attempt-075.json', { version: 1 })
    if (damage === 'second-legacy') mutate('mvp-5cny-attempt-2.json', v => ({ ...v, bootId: 'e'.repeat(32) }))
    if (damage === 'migration-missing-copy') unlinkSync(join(f.scope, '.studio-cumulative-v1-receipt-manifest.json'))
    if (damage === 'evidence-change') mutate('mvp-5cny-response-1.json', v => ({ ...v, at: v.at + 1 }))
    const before = readFileSync(join(f.scope, 'studio-ledger.json'))
    const s = await f.status()
    assert.equal(s.configured, false); assert.equal(s.unavailable, 'AI_AUTHORIZATION_LOCKED'); assert.equal(f.egress, 0)
    assert.deepEqual(readFileSync(join(f.scope, 'studio-ledger.json')), before)
  })
}
