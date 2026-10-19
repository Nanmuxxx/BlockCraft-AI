// Synthetic transports/temporary ledgers only. No credentials or real egress.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { createPaidTransport, supportsPaidAdmission, isPaidTransport } from '../../server/paid-gateway/provider.mjs'
import { PRICING, POLICY, price } from '../../server/paid-gateway/pricing.mjs'

const key = 'OFFLINE_ADMISSION_SENTINEL_12345678', url = 'https://api.deepseek.com/chat/completions'
const init = () => ({ method: 'POST', body: JSON.stringify({ model: PRICING.model, messages: [{ role: 'system', content: 'JSON' }, { role: 'user', content: 'synthetic' }], response_format: { type: 'json_object' }, stream: false, max_tokens: 2048 }) })
const reply = () => Response.json({ model: PRICING.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
function ledger(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'blockcraft-admission-')), 'ledger.json'), store = openLedger(path)
  t.after(() => store.close()); return { store, path }
}
const retained = store => store.snapshot().entries.reduce((n, e) => n + e.reserveNano - (e.releasedNano ?? 0), 0)

test('current lease is checked before durable reserve and again immediately before fetch', async t => {
  const { store } = ledger(t), events = []
  const facade = { ...store, reserve(...args) { events.push('reserve'); return store.reserve(...args) } }
  const f = createPaidTransport({ apiKey: key, ledger: facade, requireAdmission: true, fetchImpl: () => { events.push('fetch'); return reply() } })
  await f(url, init(), { assertCurrent: () => { events.push('check'); return true } })
  assert.deepEqual(events, ['check', 'reserve', 'check', 'fetch'])
  const entry = store.snapshot().entries[0]
  assert.equal(entry.status, 'settled'); assert.equal(entry.releasedNano, undefined)
  assert.ok(retained(store) > 0)
})

test('required synchronous lease denies absent/false/throw/Promise/thenable before money or network', async t => {
  const { store } = ledger(t); let calls = 0
  const f = createPaidTransport({ apiKey: key, ledger: store, requireAdmission: true, fetchImpl: async () => { calls++; return reply() } })
  for (const lease of [undefined, null, true, {}, { assertCurrent: true },
    { assertCurrent: () => false }, { assertCurrent: () => { throw Error(key) } },
    { assertCurrent: async () => true }, { assertCurrent: async () => { throw Error(key) } },
    { assertCurrent: () => ({ then: () => { throw Error('thenable must never run') } }) }]) {
    await assert.rejects(f(url, init(), lease), e => ['ADMISSION_REQUIRED', 'ADMISSION_REJECTED'].includes(e.code) && !String(e).includes(key))
  }
  const body = init(); body.body = JSON.stringify({ ...JSON.parse(body.body), assertCurrent: true })
  await assert.rejects(f(url, body, { assertCurrent: () => true }), { code: 'REQUEST_INVALID' })
  assert.equal(calls, 0); assert.equal(store.snapshot().entries.length, 0)
})

test('revocation after canonical resolve but before reservation denies each authoritative binding', async t => {
  for (const dimension of ['session', 'subject', 'owner', 'revision', 'selection']) {
    const { store } = ledger(t); let calls = 0
    const state = { session: 's', subject: 'u', owner: 'u', revision: 1, selection: 'form' }
    const expected = { ...state }, lease = { assertCurrent: () => Object.keys(expected).every(k => state[k] === expected[k]) }
    const f = createPaidTransport({ apiKey: key, ledger: store, requireAdmission: true, fetchImpl: async () => { calls++; return reply() } })
    state[dimension] = dimension === 'revision' ? 2 : 'revoked'
    await assert.rejects(f(url, init(), lease), { code: 'ADMISSION_REJECTED' })
    assert.equal(calls, 0); assert.equal(store.snapshot().entries.length, 0)
  }
})

test('revocation during reserve and in the pre-fetch microtask releases only money, survives reopen', async t => {
  for (const phase of ['reserve', 'microtask', 'replace-guard', 'abort']) {
    const { store, path } = ledger(t), c = new AbortController(); let current = true, calls = 0, checks = 0
    const lease = { assertCurrent: () => { checks++; return current } }
    const facade = { ...store, reserve(...args) {
      const id = store.reserve(...args)
      if (phase === 'microtask') queueMicrotask(() => { current = false })
      else if (phase === 'abort') c.abort()
      else { current = false; if (phase === 'replace-guard') lease.assertCurrent = () => true }
      return id
    } }
    const f = createPaidTransport({ apiKey: key, ledger: facade, requireAdmission: true, fetchImpl: async () => { calls++; return reply() } })
    await assert.rejects(f(url, { ...init(), signal: c.signal }, lease))
    const entry = store.snapshot().entries[0]
    assert.equal(calls, 0); assert.ok(checks >= 1); assert.equal(entry.status, 'not-sent')
    assert.equal(entry.releasedNano, entry.reserveNano); assert.equal(entry.estimatedNano, 0)
    assert.equal(retained(store), 0); assert.equal(store.snapshot().halted, false)
    assert.ok(entry.requestHash.length === 64); assert.equal(entry.usage, undefined)
    store.close(); const reopened = openLedger(path); t.after(() => reopened.close())
    assert.equal(reopened.snapshot().entries.length, 1); assert.equal(retained(reopened), 0)
    assert.equal(reopened.snapshot().halted, false)
  }
})

test('guard-capability brand is unforgeable by properties; shared concurrency and slot release stay enforced', async t => {
  const { store } = ledger(t); let current = false, calls = 0
  const f = createPaidTransport({ apiKey: key, ledger: store, requireAdmission: true, fetchImpl: async () => { calls++; return reply() } })
  const lease = { assertCurrent: () => current }
  assert.equal(isPaidTransport(f), true); assert.equal(supportsPaidAdmission(f), true)
  const forged = Object.assign(async () => reply(), { supportsPaidAdmission: true })
  assert.equal(isPaidTransport(forged), false); assert.equal(supportsPaidAdmission(forged), false)
  assert.equal(supportsPaidAdmission((...args) => f(...args)), false)
  await assert.rejects(f(url, init(), lease), { code: 'ADMISSION_REJECTED' })
  current = true; const first = f(url, init(), lease)
  await assert.rejects(f(url, init(), lease), { code: 'CONCURRENCY_LIMIT' })
  await first; assert.equal(calls, 1); assert.equal(store.snapshot().entries[0].status, 'settled')
})

test('not-sent releases cannot reset durable attempt cap, even with nominal reservations above money ceiling', t => {
  const { store, path } = ledger(t), input = POLICY.maxInputBytes + POLICY.framingTokens
  assert.ok(POLICY.maxCalls * price(input, 8192) > POLICY.conservativeNano)
  for (let i = 0; i < POLICY.maxCalls; i++) {
    const id = store.reserve(input, 8192, 'synthetic-hash'); store.notSent(id)
    assert.equal(retained(store), 0)
    assert.throws(() => store.notSent(id), { code: 'LEDGER_INVALID' })
  }
  store.close(); const reopened = openLedger(path); t.after(() => reopened.close())
  assert.equal(reopened.snapshot().entries.length, POLICY.maxCalls)
  assert.throws(() => reopened.reserve(input, 8192, 'synthetic-hash'), { code: 'BUDGET_EXHAUSTED' })
})

test('fetch invocation is point of no refund, including sync throw, abort and unknown response', async t => {
  for (const mode of ['throw', 'abort', 'http']) {
    const { store } = ledger(t), c = new AbortController(); let calls = 0
    const f = createPaidTransport({ apiKey: key, ledger: store, requireAdmission: true, fetchImpl: () => {
      calls++
      if (mode === 'throw') throw Error(key)
      if (mode === 'abort') { c.abort(); return new Promise(() => {}) }
      return new Response('synthetic failure', { status: 503 })
    } })
    await assert.rejects(f(url, { ...init(), signal: c.signal }, { assertCurrent: () => true }))
    const entry = store.snapshot().entries[0]
    assert.equal(calls, 1); assert.equal(entry.status, 'uncertain'); assert.equal(store.snapshot().halted, true)
    assert.equal(entry.releasedNano, undefined); assert.ok(retained(store) > 0)
    assert.throws(() => store.notSent(entry.id), { code: 'LEDGER_INVALID' })
    await assert.rejects(f(url, init(), { assertCurrent: () => true }), { code: 'BUDGET_HALTED' })
    assert.equal(calls, 1)
  }
})

test('malformed released reservation cannot manufacture free money on reopen', t => {
  const { store, path } = ledger(t), id = store.reserve(100, 2048, 'synthetic-hash')
  store.notSent(id); store.close()
  const state = JSON.parse(readFileSync(path, 'utf8')); state.entries[0].releasedNano++
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 })
  assert.throws(() => openLedger(path), { code: 'LEDGER_INVALID' })
})
