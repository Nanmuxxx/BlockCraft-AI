import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pricing, policy } from '../../tools/mochi-proactive/config.mjs'
import { PRICING, POLICY } from '../../server/paid-gateway/pricing.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { createPaidTransport, defaultModelForTransport, isPaidTransport } from '../../server/paid-gateway/provider.mjs'

const endpoint = 'https://api.deepseek.com/chat/completions'
const syntheticKey = 'OFFLINE-SYNTHETIC-BUDGET-TEST'
const request = model => ({ method: 'POST', body: JSON.stringify({ model, max_tokens: 100,
  messages: [{ role: 'system', content: 'Return JSON.' }, { role: 'user', content: 'Offline fixture.' }],
  stream: false, response_format: { type: 'json_object' } }) })
const envelope = (usage = { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }) => ({ usage,
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"message":"fixture"}' } }] })
const directories = []
after(() => directories.forEach(dir => rmSync(dir, { recursive: true, force: true })))
function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mochi-proactive-budget-'))
  chmodSync(dir, 0o700); directories.push(dir)
  return dir
}
function fixture(t, options = {}) {
  const path = join(directory(t), 'ledger.json')
  const ledger = openLedger(path, { pricing, policy, now: () => pricing.expiresAt - 1, ...options })
  t.after(() => ledger.close())
  return { path, ledger }
}

test('task budget is a separate authorization with stricter eight-call/CNY one reservation ceiling', () => {
  assert.notEqual(policy.approval, POLICY.approval)
  assert.equal(policy.maxCalls, 8); assert.equal(policy.conservativeNano, 1_000_000_000)
  assert.ok(policy.absoluteNano <= 5_000_000_000); assert.ok(policy.stopNano <= 5_000_000_000)
  assert.equal(policy.retries, 0); assert.equal(policy.concurrency, 1)
  assert.equal(pricing.verifiedDate, '2026-10-22')
  assert.equal(pricing.expiresAt, Date.parse('2026-10-23T00:00:00+08:00'))
  assert.equal(PRICING.expiresAt, Date.parse('2026-10-22T00:00:00+08:00'), 'old authorization was not extended')
})
test('injected transport model is preserved by default consumers and mismatched request rejects before reservation', async t => {
  const customPricing = { ...pricing, model: 'offline-priced-review-model' }
  const { ledger } = fixture(t, { pricing: customPricing })
  let network = 0
  const transport = createPaidTransport({ apiKey: syntheticKey, ledger, pricing: customPricing, policy,
    fetchImpl: async () => { network++; return Response.json(envelope()) } })
  assert.equal(isPaidTransport(transport), true)
  assert.equal(defaultModelForTransport(transport), customPricing.model)
  await assert.rejects(transport(endpoint, request(pricing.model)), { code: 'REQUEST_INVALID' })
  assert.equal(network, 0); assert.equal(ledger.snapshot().entries.length, 0)
  const response = await transport(endpoint, request(defaultModelForTransport(transport)))
  assert.equal((await response.json()).model, customPricing.model)
  assert.equal(network, 1)
})
test('transport cannot pair a ledger with a different priced model, rate or expiry', t => {
  const { ledger } = fixture(t)
  for (const mismatch of [
    { ...pricing, model: 'other-model' }, { ...pricing, inputNanoPerToken: pricing.inputNanoPerToken + 1 },
    { ...pricing, outputNanoPerToken: pricing.outputNanoPerToken + 1 }, { ...pricing, expiresAt: pricing.expiresAt + 1 },
  ]) assert.throws(() => createPaidTransport({ apiKey: syntheticKey, ledger, pricing: mismatch, policy,
    fetchImpl: async () => { throw new Error('must never fetch') } }), { code: 'PRICING_MISMATCH' })
  assert.equal(ledger.snapshot().entries.length, 0)
})
test('non-finite, invalid and relaxed resource policies fail before ledger/network use', t => {
  const { ledger } = fixture(t)
  for (const key of ['maxInputBytes', 'framingTokens', 'maxOutputTokens', 'maxResponseBytes', 'timeoutMs']) {
    for (const value of [Infinity, NaN, -1, 0, 1.5, POLICY[key] + 1]) {
      const invalidPolicy = { ...policy, [key]: value }
      assert.throws(() => openLedger(join(directory(t), 'invalid.json'), { pricing, policy: invalidPolicy }), { code: 'POLICY_INVALID' })
      assert.throws(() => createPaidTransport({ apiKey: syntheticKey, ledger, pricing, policy: invalidPolicy }), { code: 'POLICY_INVALID' })
    }
  }
  for (const invalidPolicy of [{ ...policy, maxCalls: 101 }, { ...policy, absoluteNano: 5_000_000_001 }, { ...policy, conservativeNano: Infinity }])
    assert.throws(() => openLedger(join(directory(t), 'invalid.json'), { pricing, policy: invalidPolicy }), { code: 'POLICY_INVALID' })
  assert.equal(ledger.snapshot().entries.length, 0)
})
test('task ledger durably reserves before each offline call and enforces eight attempts across reopen', async t => {
  const { ledger, path } = fixture(t)
  let network = 0
  const transport = createPaidTransport({ apiKey: syntheticKey, ledger, pricing, policy, fetchImpl: async () => {
    network++
    const durable = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(durable.entries.length, network)
    assert.equal(durable.entries.at(-1).status, 'reserved')
    return Response.json(envelope())
  } })
  for (let call = 0; call < 8; call++) await transport(endpoint, request(pricing.model))
  const before = ledger.snapshot()
  assert.equal(network, 8); assert.equal(before.entries.length, 8)
  assert.ok(before.entries.every(entry => entry.status === 'settled'))
  for (const entry of before.entries) {
    assert.equal(entry.reserveNano, entry.inputBound * pricing.inputNanoPerToken + entry.outputBound * pricing.outputNanoPerToken)
    assert.equal(entry.estimatedNano, 3 * pricing.inputNanoPerToken + 5 * pricing.outputNanoPerToken)
    assert.ok(entry.estimatedNano < entry.reserveNano, 'unused reservation is retained')
  }
  await assert.rejects(transport(endpoint, request(pricing.model)), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(network, 8); ledger.close()
  const reopened = openLedger(path, { pricing, policy, now: () => pricing.expiresAt - 1 })
  t.after(() => reopened.close())
  assert.equal(reopened.snapshot().entries.length, 8)
  assert.throws(() => reopened.reserve(10, 10, 'offline-after-reopen'), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(reopened.snapshot().entries.reduce((sum, entry) => sum + entry.reserveNano, 0), before.entries.reduce((sum, entry) => sum + entry.reserveNano, 0))
})
test('monetary ceiling is checked against non-refundable bounds before any request', t => {
  const reserveNano = 100 * pricing.inputNanoPerToken + 100 * pricing.outputNanoPerToken
  const limited = { ...policy, conservativeNano: reserveNano - 1 }
  const { ledger } = fixture(t, { policy: limited })
  assert.throws(() => ledger.reserve(100, 100, 'offline-money-cap'), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(ledger.snapshot().entries.length, 0)
})
test('expired task pricing and expired production defaults refuse before network or reservation', async t => {
  for (const options of [
    { pricing, policy, now: () => pricing.expiresAt },
    { pricing: PRICING, policy: POLICY, now: () => PRICING.expiresAt },
  ]) {
    const { ledger } = fixture(t, options)
    let network = 0
    const transport = createPaidTransport({ apiKey: syntheticKey, ledger, pricing: options.pricing, policy: options.policy,
      fetchImpl: async () => { network++; return Response.json(envelope()) } })
    await assert.rejects(transport(endpoint, request(options.pricing.model)), { code: 'PRICING_EXPIRED' })
    assert.equal(network, 0); assert.equal(ledger.snapshot().entries.length, 0)
  }
})
test('unknown usage conservatively keeps reservation and halts subsequent calls across reopen', async t => {
  const { ledger, path } = fixture(t)
  let network = 0
  const transport = createPaidTransport({ apiKey: syntheticKey, ledger, pricing, policy,
    fetchImpl: async () => { network++; return Response.json(envelope({ prompt_tokens: 3, completion_tokens: 5, total_tokens: 999 })) } })
  await assert.rejects(transport(endpoint, request(pricing.model)), { code: 'USAGE_UNRELIABLE' })
  assert.equal(network, 1); assert.equal(ledger.snapshot().halted, true)
  const retained = ledger.snapshot().entries[0].reserveNano
  assert.ok(retained > 0); ledger.close()
  const reopened = openLedger(path, { pricing, policy, now: () => pricing.expiresAt - 1 }); t.after(() => reopened.close())
  assert.equal(reopened.snapshot().entries[0].reserveNano, retained)
  assert.throws(() => reopened.reserve(10, 10, 'offline-halted'), { code: 'BUDGET_HALTED' })
})
