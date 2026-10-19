import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaidGenerationRuntime } from '../../server/paid-gateway/runtime.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { PRICING, POLICY, SMOKE_POLICY, price } from '../../server/paid-gateway/pricing.mjs'

const endpoint = 'https://api.deepseek.com/chat/completions'
const key = 'synthetic-offline-key-only'
const spec = { version: 1, id: 'mock', name: 'Mock', entities: [], blocks: [], relations: [] }
const reply = Response.json({ model: PRICING.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })
const request = max_tokens => ({ method: 'POST', body: JSON.stringify({ model: PRICING.model,
  messages: [{ role: 'system', content: 'JSON only' }, { role: 'user', content: 'mock' }], stream: false,
  response_format: { type: 'json_object' }, max_tokens }) })
function dir(t) {
  const path = mkdtempSync(join(tmpdir(), 'blockcraft-smoke-profile-')); chmodSync(path, 0o700)
  t.after(() => { /* temporary directories are owned by the OS test harness */ })
  return path
}
function runtime(t, path, fetchImpl = async () => reply.clone(), timeoutMs) {
  const previous = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = key
  t.after(() => { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous })
  const result = createPaidGenerationRuntime({ ledgerPath: join(path, 'smoke-ledger.json'), fetchImpl, timeoutMs })
  t.after(() => result.close())
  return result
}

test('smoke runtime loads only the synthetic environment key and binds the isolated 3-call policy', async t => {
  const path = dir(t); let calls = 0
  const r = runtime(t, path, async (_url, init) => { calls++; assert.equal(init.headers.Authorization, 'Bearer ' + key); return reply.clone() })
  assert.equal(r.model, 'deepseek-flash'); assert.equal(r.policy, SMOKE_POLICY)
  for (let n = 0; n < 3; n++) await r.fetch(endpoint, request(2048))
  await assert.rejects(r.fetch(endpoint, request(2048)), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(calls, 3)
  const ledger = r.ledger.snapshot()
  assert.equal(ledger.version, 2); assert.equal(ledger.profile, 'local-smoke')
  assert.equal(ledger.entries.reduce((sum, e) => sum + e.reserveNano, 0), 3 * ledger.entries[0].reserveNano)
  assert.ok(ledger.entries.reduce((sum, e) => sum + e.reserveNano, 0) <= 500_000_000)
})

test('smoke cap persists across process restart and cannot be bypassed with the production ledger profile', async t => {
  const path = dir(t), r = runtime(t, path)
  for (let n = 0; n < 3; n++) await r.fetch(endpoint, request(2048))
  r.close()
  const again = openLedger(join(path, 'smoke-ledger.json'), { policy: SMOKE_POLICY, profile: 'local-smoke' })
  t.after(() => again.close())
  assert.throws(() => again.reserve(100, 2048, 'next'), { code: 'BUDGET_EXHAUSTED' })
  again.close()
  assert.throws(() => openLedger(join(path, 'smoke-ledger.json')), { code: 'LEDGER_INVALID' })
  assert.equal(POLICY.maxCalls, 6)
})

test('smoke output hard limit and profile mismatch reject before mock egress', async t => {
  const path = dir(t); let calls = 0
  const r = runtime(t, path, async () => { calls++; return reply.clone() })
  await assert.rejects(r.fetch(endpoint, request(2049)), { code: 'REQUEST_INVALID' })
  assert.equal(calls, 0); assert.equal(r.ledger.snapshot().entries.length, 0)
  const production = openLedger(join(path, 'other-ledger.json')); t.after(() => production.close())
  const { createPaidTransport } = await import('../../server/paid-gateway/provider.mjs')
  assert.throws(() => createPaidTransport({ apiKey: key, ledger: production, policy: SMOKE_POLICY, fetchImpl: async () => { calls++ } }), { code: 'LEDGER_PROFILE' })
  assert.equal(calls, 0)
})

test('smoke concurrency remains one and rejects a second in-flight call before reservation', async t => {
  const path = dir(t); let release, calls = 0
  const r = runtime(t, path, async () => { calls++; return new Promise(resolve => { release = () => resolve(reply.clone()) }) })
  const first = r.fetch(endpoint, request(2048)); await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(r.fetch(endpoint, request(2048)), { code: 'CONCURRENCY_LIMIT' })
  release(); await first
  assert.equal(calls, 1); assert.equal(r.ledger.snapshot().entries.length, 1)
})

test('smoke timeout, connection failure, and unresolved reservation fail closed without retry', async t => {
  for (const mode of ['timeout', 'disconnect']) {
    const path = dir(t); let calls = 0
    const r = runtime(t, path, async () => {
      calls++
      if (mode === 'disconnect') throw new Error('mock socket reset')
      return new Promise(resolve => setTimeout(() => resolve(reply.clone()), 60))
    }, mode === 'timeout' ? 15 : undefined)
    const controller = new AbortController()
    const pending = r.fetch(endpoint, { ...request(2048), signal: controller.signal })
    await assert.rejects(pending)
    await assert.rejects(r.fetch(endpoint, request(2048)), { code: 'BUDGET_HALTED' })
    assert.equal(calls, 1)
    assert.equal(r.ledger.snapshot().entries[0].status, 'uncertain')
  }
})

test('new price snapshot is short lived and the worst-case three-request reserve fits ¥0.50', () => {
  assert.equal(PRICING.verifiedDate, '2026-10-20')
  assert.equal(PRICING.outputCnyPerMillion, 9)
  const one = price(SMOKE_POLICY.maxInputBytes + SMOKE_POLICY.framingTokens, SMOKE_POLICY.maxOutputTokens)
  assert.equal(one * SMOKE_POLICY.maxCalls, 497_664_000)
})
