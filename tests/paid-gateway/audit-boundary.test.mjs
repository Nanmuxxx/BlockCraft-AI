import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaidTransport } from '../../server/paid-gateway/provider.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { PRICING, POLICY } from '../../server/paid-gateway/pricing.mjs'

const key = 'OFFLINE_AUDIT_PRIVATE_SENTINEL_12345678'
const url = 'https://api.deepseek.com/chat/completions'
const init = () => ({ method: 'POST', body: JSON.stringify({ model: PRICING.model, messages: [{ role: 'system', content: 'JSON only' }, { role: 'user', content: 'synthetic test' }], stream: false, response_format: { type: 'json_object' }, max_tokens: POLICY.maxOutputTokens }) })
const envelope = model => ({ model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
function store(t) {
  const dir = mkdtempSync(join(tmpdir(), 'blockcraft-audit-boundary-')); chmodSync(dir, 0o700)
  const ledger = openLedger(join(dir, 'ledger.json')); t.after(() => ledger.close()); return ledger
}

test('hung audit callback obeys deadline; concurrency releases without refunding settled usage', { timeout: 2000 }, async t => {
  const ledger = store(t); let entered, callbackSignal, calls = 0
  const started = new Promise(resolve => { entered = resolve })
  const f = createPaidTransport({ apiKey: key, ledger, timeoutMs: 25,
    fetchImpl: async () => { calls++; return Response.json(envelope(PRICING.model)) },
    onResponse: (_safe, meta) => { callbackSignal = meta.signal; entered(); return new Promise(() => {}) } })
  const work = f(url, init()); const rejection = assert.rejects(work, { code: 'UPSTREAM_CANCELLED' })
  await started
  await assert.rejects(f(url, init()), { code: 'CONCURRENCY_LIMIT' })
  await rejection
  assert.equal(callbackSignal.aborted, true)
  assert.equal(ledger.snapshot().entries[0].status, 'settled')
  const retained = ledger.snapshot().entries[0].reserveNano
  await assert.rejects(f(url, init()), { code: 'UPSTREAM_CANCELLED' })
  assert.equal(calls, 2); assert.equal(ledger.snapshot().entries.length, 2)
  assert.equal(ledger.snapshot().entries[0].reserveNano, retained)
})

test('cancel during audit rejects promptly and late callback resolution/rejection cannot succeed', { timeout: 2000 }, async t => {
  for (const lateFailure of [false, true]) {
    const ledger = store(t), c = new AbortController(); let entered, finish, signal
    const started = new Promise(resolve => { entered = resolve })
    const f = createPaidTransport({ apiKey: key, ledger, fetchImpl: async () => Response.json(envelope(PRICING.model)),
      onResponse: (_safe, meta) => { signal = meta.signal; entered(); return new Promise((resolve, reject) => { finish = () => lateFailure ? reject(new Error(key)) : resolve() }) } })
    let succeeded = false
    const work = f(url, { ...init(), signal: c.signal }).then(value => { succeeded = true; return value })
    const rejected = assert.rejects(work, { code: 'UPSTREAM_CANCELLED' })
    await started; c.abort(); await rejected; finish(); await new Promise(setImmediate)
    assert.equal(signal.aborted, true); assert.equal(succeeded, false)
    assert.equal(ledger.snapshot().entries[0].status, 'settled')
  }
})

test('untrusted model metadata never enters callback/response; only configured priced model is emitted', async t => {
  for (const model of [key, `prefix-${key}-suffix`, { private: key }, 'arbitrary-model', null]) {
    const ledger = store(t); let captured
    const f = createPaidTransport({ apiKey: key, ledger, fetchImpl: async () => Response.json(envelope(model)),
      onResponse: safe => { captured = structuredClone(safe); safe.model = key } })
    const response = await f(url, init()), safe = await response.json()
    assert.equal(captured.model, PRICING.model); assert.equal(safe.model, PRICING.model)
    for (const value of [captured, safe, ledger.snapshot()]) assert.ok(!JSON.stringify(value).includes(key))
  }
})

test('audit callback exception is sanitized; trustworthy usage remains settled with reservation retained', async t => {
  const ledger = store(t)
  const f = createPaidTransport({ apiKey: key, ledger, fetchImpl: async () => Response.json(envelope(PRICING.model)),
    onResponse: () => { throw new Error(key) } })
  await assert.rejects(f(url, init()), error => error.code === 'UPSTREAM_FAILED' && !String(error).includes(key))
  assert.equal(ledger.snapshot().entries[0].status, 'settled')
  assert.ok(ledger.snapshot().entries[0].reserveNano > 0)
})

// Historical policy window for Mock tests only; real timers remain active.
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt - 1 }))
