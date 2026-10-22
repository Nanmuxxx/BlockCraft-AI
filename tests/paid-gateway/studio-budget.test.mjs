import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { openStudioBudget } from '../../server/paid-gateway/studio-budget.mjs'
import { createPrincipalPaidGenerationRuntime } from '../../server/paid-gateway/runtime.mjs'
import { createLivePricingVerifier } from '../../server/paid-gateway/live-pricing.mjs'
import { STUDIO_PRICING as PRICING, STUDIO_MVP_POLICY, price } from '../../server/paid-gateway/pricing.mjs'
import { createDeepSeekProvider as custom } from '../../server/custom-block/provider.mjs'
import { request as customRequest } from '../custom-block-generation/fixtures.mjs'
import { openMochiBudget } from '../../server/paid-gateway/mochi-budget.mjs'

const bindingKey = Buffer.alloc(32, 0x6a), hash = 'ab'.repeat(32)
const options = { policy: STUDIO_MVP_POLICY, profile: 'studio-mvp', pricingGuard: () => {} }
function fixture(t, history = 0) {
  const directory = mkdtempSync(join(tmpdir(), 'studio-cumulative-')); chmodSync(directory, 0o700)
  const path = join(directory, 'ledger.json')
  const ledger = openLedger(path, options)
  for (let i = 0; i < history; i++) ledger.settle(ledger.reserve(100, 100, hash), { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })
  const fixture = { directory, path, ledger }
  t.after(() => { fixture.runtime?.close(); ledger.close(); rmSync(directory, { recursive: true, force: true }) })
  return fixture
}
const open = f => openStudioBudget({ ...f, bindingKey, pricingGuard: () => {} })

test('verified legacy debt survives restart and permanently consumes its call and money ceiling', t => {
  const historicalDebit = { calls: 1, nano: 212_992_000, evidenceHash: 'cd'.repeat(32) }
  const f = fixture(t, 73), budget = open({ ...f, historicalDebit })
  assert.equal(budget.snapshot().calls, 82)
  assert.equal(budget.snapshot().reservedNano, 280_314_000 + 212_992_000 + 73 * price(1, 1))
  for (let i = 0; i < 18; i++) spend(f, budget)
  assert.throws(() => spend(f, budget), { code: 'STUDIO_BUDGET_EXHAUSTED' })
  f.ledger.close()
  const ledger = openLedger(f.path, options)
  try {
    assert.equal(open({ ...f, ledger, historicalDebit }).snapshot().calls, 100)
    assert.throws(() => open({ ...f, ledger }), { code: 'STUDIO_BUDGET_HISTORY_UNVERIFIED' })
    assert.throws(() => open({ ...f, ledger, historicalDebit: { ...historicalDebit, evidenceHash: 'ef'.repeat(32) } }), { code: 'STUDIO_BUDGET_HISTORY_UNVERIFIED' })
  } finally { ledger.close() }
  const money = fixture(t), b = open({ ...money, historicalDebit }), input = 73728, output = 8192
  const count = Math.floor((5_000_000_000 - 280_314_000 - historicalDebit.nano) / price(input, output))
  for (let i = 0; i < count; i++) spend(money, b, input, output)
  assert.throws(() => spend(money, b, input, output), { code: 'STUDIO_BUDGET_EXHAUSTED' })
})
function spend(f, budget, input = 100, output = 100) {
  budget.reserve(input, output, hash)
  const id = f.ledger.reserve(input, output, hash)
  f.ledger.settle(id, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })
}

test('73 primary calls plus eight known calls seed 81; all 19 remaining survive restart and cannot be reset', t => {
  const f = fixture(t, 73), before = f.ledger.snapshot().entries, budget = open(f)
  assert.equal(budget.snapshot().calls, 81)
  assert.equal(budget.snapshot().remainingCalls, 19)
  assert.equal(budget.snapshot().reservedNano, 280_314_000 + 73 * price(1, 1))
  assert.deepEqual(f.ledger.snapshot().entries, before)
  for (let i = 0; i < 19; i++) spend(f, budget)
  assert.equal(budget.snapshot().calls, 100)
  assert.throws(() => spend(f, budget), { code: 'STUDIO_BUDGET_EXHAUSTED' })
  f.ledger.close()
  const ledger = openLedger(f.path, options)
  try { assert.equal(open({ ...f, ledger }).snapshot().remainingCalls, 0) } finally { ledger.close() }
})

test('money ceiling independently stops reservations and new usage is never refunded', t => {
  const f = fixture(t), budget = open(f)
  const input = STUDIO_MVP_POLICY.maxInputBytes + STUDIO_MVP_POLICY.framingTokens, output = STUDIO_MVP_POLICY.maxOutputTokens
  const allowed = Math.floor((5_000_000_000 - 280_314_000) / price(input, output))
  for (let i = 0; i < allowed; i++) spend(f, budget, input, output)
  assert.ok(budget.snapshot().remainingCalls > 0)
  assert.equal(budget.snapshot().reservedNano, 280_314_000 + allowed * price(input, output))
  assert.throws(() => spend(f, budget, input, output), { code: 'STUDIO_BUDGET_EXHAUSTED' })
})

test('invalid reservations leave budget usable and historical unresolved or unverified usage cannot seed', t => {
  const f = fixture(t), budget = open(f)
  for (const args of [[0, 1, hash], [73729, 1, hash], [1, 8193, hash], [1, 1, 'secret prompt']])
    assert.throws(() => budget.reserve(...args), { code: 'STUDIO_BUDGET_RESERVATION_INVALID' })
  assert.equal(budget.snapshot().calls, 8)
  for (const damage of ['reserved', 'usage']) {
    const f = fixture(t, 1)
    f.ledger.close()
    const state = JSON.parse(readFileSync(f.path))
    if (damage === 'reserved') { state.entries[0].status = 'reserved'; delete state.entries[0].usage; delete state.entries[0].estimatedNano }
    else state.entries[0].usage.prompt_tokens = 99
    writeFileSync(f.path, JSON.stringify(state))
    const ledger = openLedger(f.path, options)
    try { assert.throws(() => open({ ...f, ledger }), { code: 'STUDIO_BUDGET_HISTORY_UNVERIFIED' }) } finally { ledger.close() }
  }
})

test('paired receipt removal, complete subordinate loss and interrupted reserve fail closed', t => {
  for (const mode of ['paired', 'all', 'interrupted']) {
    const f = fixture(t), budget = open(f)
    if (mode === 'interrupted') budget.reserve(100, 100, hash)
    else {
      spend(f, budget)
      for (const name of readdirSync(f.directory)) if (name.startsWith('.studio-cumulative-v1-') && (mode === 'all' || name.endsWith('-001.json'))) unlinkSync(join(f.directory, name))
    }
    assert.throws(() => budget.snapshot(), { code: 'STUDIO_BUDGET_INVALID' })
    assert.throws(() => open(f), { code: 'STUDIO_BUDGET_INVALID' })
  }
})

test('all runtime protocols share the cumulative ceiling; quote failure reserves nothing and retry recovers', async t => {
  const f = fixture(t, 73); f.ledger.close()
  let egress = 0, rejectPricing = false
  const verifyPricing = async () => { if (rejectPricing) throw Object.assign(new Error('PRICING_UNVERIFIED'), { code: 'PRICING_UNVERIFIED' }) }
  const runtime = createPrincipalPaidGenerationRuntime({ ...options, studioAuthorization: true, mochiEnabled: true, bindingKey,
    env: { DEEPSEEK_API_KEY: 'synthetic-only-studio-key', DEEPSEEK_BUDGET_LEDGER_PATH: f.path }, verifyPricing,
    fetchImpl: async () => { egress++; return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) } })
  f.runtime = runtime
  const init = { method: 'POST', body: JSON.stringify({ model: PRICING.model, messages: [{ role: 'system', content: 'JSON' }, { role: 'user', content: 'offline' }], stream: false, response_format: { type: 'json_object' }, max_tokens: 100 }) }
  const request = i => runtime.forRequest({ principal: 'owner', idempotencyKey: String(i).padStart(32, 'a'), payload: { idea: 'offline', protocol: ['v1', 'trusted-interactive/1', 'mochi-field-plan/1', 'mochi-advice/1'][i % 4] } }).fetchImpl('https://api.deepseek.com/chat/completions', init)
  rejectPricing = true
  await assert.rejects(request(0), { code: 'PRICING_UNVERIFIED' })
  assert.equal(runtime.mochiBudgetStatus().calls, 81); assert.equal(egress, 0)
  rejectPricing = false
  for (let i = 0; i < 19; i++) await request(i)
  assert.equal(runtime.mochiBudgetStatus().calls, 100)
  await assert.rejects(request(19), { code: 'STUDIO_BUDGET_EXHAUSTED' })
  assert.equal(egress, 19)
  assert.equal(JSON.parse(readFileSync(f.path)).entries.length, 92)
})

test('official verification freshness is independent of the expired historical pricing date', async () => {
  let now = PRICING.expiresAt + 86400_000, requests = 0
  const html = '<table><tr><td>模型</td><td>deepseek-flash</td><td>deepseek-v4-pro</td></tr><tr><td>高峰时段</td><td>x</td></tr><tr><td>百万tokens输入缓存未命中</td></tr><tr><td>高峰时段</td><td>2元</td><td>x</td></tr><tr><td>百万tokens输出</td></tr><tr><td>高峰时段</td><td>8元</td><td>x</td></tr></table>'
  const verify = createLivePricingVerifier({ now: () => now, fetchImpl: async () => { requests++; return new Response(html, { headers: { 'Content-Type': 'text/html' } }) } })
  assert.throws(() => verify.assertCurrent(), { code: 'PRICING_UNVERIFIED' })
  await verify(); verify.assertCurrent(); await verify(); assert.equal(requests, 1)
  now += 900_000
  assert.throws(() => verify.assertCurrent(), { code: 'PRICING_UNVERIFIED' })
  await verify(); verify.assertCurrent(); assert.equal(requests, 2)
})

test('custom block provider uses the same global ceiling through its branded request transport', async t => {
  const f = fixture(t, 90); f.ledger.close()
  let egress = 0
  const runtime = f.runtime = createPrincipalPaidGenerationRuntime({ ...options, studioAuthorization: true, mochiEnabled: true, bindingKey, verifyPricing: async () => {},
    env: { DEEPSEEK_API_KEY: 'synthetic-only-custom-key', DEEPSEEK_BUDGET_LEDGER_PATH: f.path },
    fetchImpl: async () => { egress++; return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"mock":"inert-source-only"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) } })
  const generate = i => {
    const paid = runtime.forRequest({ principal: 'owner', idempotencyKey: `custom-${String(i).padStart(32, '0')}`, payload: { idea: 'offline custom block', protocol: 'trusted-interactive/1' } })
    return custom({ ...paid, allowPaid: true }).generate(customRequest())
  }
  for (let i = 0; i < 2; i++) assert.equal(await generate(i), '{"mock":"inert-source-only"}')
  await assert.rejects(generate(2))
  assert.equal(egress, 2); assert.equal(runtime.mochiBudgetStatus().calls, 100)
})

test('mounted 777 directories and signed 644 receipts require explicit compatibility and preserve all validation', t => {
  const f = fixture(t), budget = open(f)
  openMochiBudget({ ...f, bindingKey, pricingGuard: () => {} })
  spend(f, budget)
  f.ledger.close()
  chmodSync(f.directory, 0o777); chmodSync(join(f.directory, '.mochi-budget-v1'), 0o777)
  for (const name of readdirSync(f.directory)) if (name.startsWith('.studio-cumulative-v1-') || name.startsWith('.mochi-budget-anchor-v1-')) chmodSync(join(f.directory, name), 0o644)
  chmodSync(join(f.directory, '.mochi-budget-v1', 'manifest.json'), 0o644)
  assert.throws(() => openLedger(f.path, options), { code: 'LEDGER_PERMISSIONS' })
  const ledger = openLedger(f.path, { ...options, allowMountedDirectory: true })
  try {
    assert.throws(() => openStudioBudget({ ...f, ledger, bindingKey }), { code: 'STUDIO_BUDGET_INVALID' })
    assert.equal(openStudioBudget({ ...f, ledger, bindingKey, allowMountedDirectory: true }).snapshot().calls, 9)
    assert.equal(openMochiBudget({ ...f, ledger, bindingKey, pricingGuard: () => {}, allowMountedDirectory: true }).snapshot().calls, 8)
    writeFileSync(join(f.directory, '.studio-cumulative-v1-receipt-manifest.json'), '{}')
    assert.throws(() => openStudioBudget({ ...f, ledger, bindingKey, allowMountedDirectory: true }), { code: 'STUDIO_BUDGET_INVALID' })
  } finally { ledger.close() }
})
