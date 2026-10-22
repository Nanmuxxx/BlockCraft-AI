import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { createPaidTransport, defaultModelForTransport, maxOutputTokensForTransport } from '../../server/paid-gateway/provider.mjs'
import { PRICING, POLICY, STUDIO_PRICING, STUDIO_MVP_POLICY, SMOKE_POLICY } from '../../server/paid-gateway/pricing.mjs'

const endpoint = 'https://api.deepseek.com/chat/completions'
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'main-profile-compatibility-')); chmodSync(directory, 0o700)
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return join(directory, 'ledger.json')
}
const request = (model, max_tokens) => ({ method: 'POST', body: JSON.stringify({ model, max_tokens, messages: [{ role: 'system', content: 'JSON' }, { role: 'user', content: 'offline' }], stream: false, response_format: { type: 'json_object' } }) })

test('historical Studio metadata does not replace main production pricing or policy defaults', t => {
  assert.equal(PRICING.verifiedDate, '2026-10-21'); assert.equal(PRICING.expiresAt, Date.parse('2026-10-22T00:00:00+08:00'))
  assert.equal(POLICY.approval, 'MVP-FIELDS-USER-5-CNY-20261021')
  assert.equal(POLICY.maxCalls, 8); assert.equal(POLICY.maxOutputTokens, 8192)
  assert.equal(POLICY.conservativeNano, 1_000_000_000); assert.equal(POLICY.absoluteNano, 5_000_000_000)
  assert.equal(STUDIO_PRICING.verifiedDate, '2026-10-22'); assert.notEqual(STUDIO_PRICING, PRICING)
  const ledger = openLedger(fixture(t), { now: () => PRICING.expiresAt - 1 })
  try {
    assert.equal(ledger.snapshot().version, 1); assert.deepEqual(ledger.snapshot().pricing, PRICING)
    assert.equal(ledger.policyId, POLICY.approval)
    assert.throws(() => createPaidTransport({ apiKey: 'synthetic-main-test-key', ledger, policy: STUDIO_MVP_POLICY }), { code: 'LEDGER_PROFILE' })
    assert.throws(() => createPaidTransport({ apiKey: 'synthetic-main-test-key', ledger, policy: SMOKE_POLICY }), { code: 'LEDGER_PROFILE' })
    assert.equal(ledger.snapshot().entries.length, 0)
  } finally { ledger.close() }
})

test('production injection preserves priced model, rates, tighter policy, clock and persisted compatibility', async t => {
  const path = fixture(t), pricing = { ...PRICING, model: 'offline-priced-model', inputNanoPerToken: 3000, outputNanoPerToken: 9000 }
  const policy = { ...POLICY, approval: 'OFFLINE-TIGHTER-MAIN-POLICY', maxCalls: 2, maxOutputTokens: 512 }
  let now = pricing.expiresAt - 1, calls = 0
  const ledger = openLedger(path, { pricing, policy, now: () => now })
  const transport = createPaidTransport({ apiKey: 'synthetic-main-test-key', ledger, pricing, policy, fetchImpl: async (_url, init) => {
    calls++; const wire = JSON.parse(init.body)
    assert.equal(wire.model, pricing.model); assert.equal(wire.max_tokens, 512)
    assert.equal(ledger.snapshot().entries.at(-1).status, 'reserved')
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })
  } })
  try {
    assert.equal(defaultModelForTransport(transport), pricing.model); assert.equal(maxOutputTokensForTransport(transport), 512)
    await assert.rejects(transport(endpoint, request(pricing.model, 513)), { code: 'REQUEST_INVALID' })
    assert.equal(calls, 0)
    await transport(endpoint, request(pricing.model, 512))
    assert.equal(ledger.snapshot().entries[0].estimatedNano, 3 * 3000 + 2 * 9000)
    now = pricing.expiresAt
    await assert.rejects(transport(endpoint, request(pricing.model, 512)), { code: 'PRICING_EXPIRED' })
    assert.equal(calls, 1); assert.equal(ledger.snapshot().entries.length, 1)
  } finally { ledger.close() }
  const reopened = openLedger(path, { pricing, policy, now: () => pricing.expiresAt - 1 })
  try {
    assert.equal(reopened.snapshot().version, 1); assert.equal(reopened.snapshot().entries[0].estimatedNano, 27000)
    const id = reopened.reserve(1, 512, 'offline-second'); reopened.settle(id, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })
    assert.throws(() => reopened.reserve(1, 512, 'offline-third'), { code: 'BUDGET_EXHAUSTED' })
  } finally { reopened.close() }
})

test('main production still refuses raised resource or money bounds and mismatched profile entry', t => {
  for (const policy of [{ ...POLICY, maxOutputTokens: 8193 }, { ...POLICY, conservativeNano: 5_000_000_001 }, { ...POLICY, maxCalls: 101 }])
    assert.throws(() => openLedger(fixture(t), { policy }), { code: 'POLICY_INVALID' })
  assert.throws(() => openLedger(fixture(t), { policy: POLICY, profile: 'studio-mvp' }), { code: 'LEDGER_PROFILE' })
})
