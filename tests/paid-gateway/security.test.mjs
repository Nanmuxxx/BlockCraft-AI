import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { createPaidTransport, isPaidTransport } from '../../server/paid-gateway/provider.mjs'
import { createLocalAccess } from '../../server/paid-gateway/access.mjs'
import { PRICING, POLICY, price } from '../../server/paid-gateway/pricing.mjs'
import { createAppServer } from '../../server/index.mjs'
import { createDeepSeekProvider as custom } from '../../server/custom-block/provider.mjs'
import { createDeepSeekProvider as mochi } from '../../server/mochi-ai/provider.mjs'

const key = 'offline-key-not-a-real-secret'
const endpoint = 'https://api.deepseek.com/chat/completions'
const spec = { version: 1, id: 'tasks', name: '任务', entities: [{ id: 'items', name: '任务', fields: [{ id: 'title', name: '名称', type: 'text', required: true }] }], blocks: [{ id: 'list', name: '清单', type: 'list', fieldIds: ['title'] }], relations: [{ id: 'binding', type: 'dataBinding', blockId: 'list', entityId: 'items' }] }
const envelope = (usage = { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 }) => ({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }], usage })
const init = extra => ({ method: 'POST', body: JSON.stringify({ model: PRICING.model, messages: [{ role: 'system', content: 'JSON only' }, { role: 'user', content: 'tasks' }], stream: false, response_format: { type: 'json_object' }, max_tokens: 8192, ...extra }) })
function ledger(t) {
  const dir = mkdtempSync(join(tmpdir(), 'blockcraft-budget-test-')); chmodSync(dir, 0o700)
  const path = join(dir, 'ledger.json'), store = openLedger(path)
  t.after(() => store.close())
  return { dir, path, store }
}
async function server(t, options) {
  const s = createAppServer({ apiKey: key, ...options }); s.listen(0, '127.0.0.1'); await once(s, 'listening')
  t.after(() => new Promise(r => { s.closeAllConnections(); s.close(r) }))
  return async (body = { idea: '待办清单' }, headers = {}) => fetch(`http://127.0.0.1:${s.address().port}/api/ai/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
}

test('anonymous legacy and v2 (no Origin, forged Host/XFF/Origin/body approval) reject before Provider', async t => {
  let calls = 0
  const token = randomBytes(32).toString('hex'), post = await server(t, { generationAccess: createLocalAccess(token), fetchImpl: async () => { calls++; return Response.json(envelope()) } })
  for (const headers of [{}, { Origin: 'http://127.0.0.1' }, { Authorization: 'Bearer wrong' }, { 'X-Forwarded-For': '127.0.0.1', Host: 'localhost' }]) {
    assert.equal((await post(undefined, headers)).status, 401)
    assert.equal((await post({ idea: '番茄钟', protocol: 'trusted-interactive/1', approval: true }, headers)).status, 401)
  }
  assert.equal(calls, 0)
  assert.equal((await post(undefined, { Authorization: 'Bearer ' + token })).status, 200)
  assert.equal(calls, 1)
})
test('default disabled even with injected Provider/key; untrusted auth exceptions and late identity fail closed', async t => {
  let calls = 0
  const fetchImpl = async () => { calls++; return Response.json(envelope()) }
  for (const generationAccess of [undefined, () => { throw new Error(key) }, () => 'true', async () => { await new Promise(r => setTimeout(r, 2100)); return true }]) {
    const post = await server(t, { fetchImpl, generationAccess })
    const r = await post(); assert.equal(r.status, 401); assert.ok(!(await r.text()).includes(key))
  }
  assert.equal(calls, 0)
})
test('all native Provider defaults blocked without controlled transport', async t => {
  assert.throws(() => custom({ allowPaid: true, apiKey: key }), { code: 'PAID_GATEWAY_REQUIRED' })
  const p = await server(t, { generationAccess: () => true })
  assert.equal((await p()).status, 502)
  const request = { requestId: 'offline', question: '你好', context: {} }
  // Guard itself is shared by all three providers; no native network call needed.
  const { requireControlledEgress } = await import('../../server/paid-gateway/egress.mjs')
  assert.throws(() => requireControlledEgress(globalThis.fetch), { code: 'PAID_GATEWAY_REQUIRED' })
  assert.equal(mochi({ apiKey: key }).configured, true)
})
test('durable reserve precedes one fixed official request; no caller headers, tools, retries or secret audit', async t => {
  const { store, path } = ledger(t); let calls = 0
  const transport = createPaidTransport({ apiKey: key, ledger: store, fetchImpl: async (url, wire) => {
    calls++; assert.equal(url, endpoint); assert.equal(wire.redirect, 'error')
    const disk = JSON.parse(readFileSync(path)); assert.equal(disk.entries[0].status, 'reserved')
    assert.equal(wire.headers.Authorization, 'Bearer ' + key)
    const body = JSON.parse(wire.body); assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.max_tokens, 8192); assert.equal(body.model, PRICING.model)
    return Response.json(envelope())
  } })
  assert.equal(isPaidTransport(transport), true)
  await transport(endpoint, init())
  assert.equal(calls, 1); const audit = store.snapshot(); assert.equal(audit.entries[0].status, 'settled')
  assert.equal(audit.entries[0].estimatedNano, price(50, 100)); assert.ok(!JSON.stringify(audit).includes(key))
  assert.ok(audit.entries[0].reserveNano > audit.entries[0].estimatedNano)
})
test('concurrent attempts rejected before Provider and before a second reservation', async t => {
  const { store } = ledger(t); let release, calls = 0
  const transport = createPaidTransport({ apiKey: key, ledger: store, fetchImpl: async () => { calls++; return new Promise(r => { release = () => r(Response.json(envelope())) }) } })
  const first = transport(endpoint, init()); await new Promise(r => setImmediate(r))
  await assert.rejects(transport(endpoint, init()), { code: 'CONCURRENCY_LIMIT' }); release(); await first
  assert.equal(calls, 1); assert.equal(store.snapshot().entries.length, 1)
})
test('request policy rejects other endpoint/model/tools/token limits and oversized input with zero network', async t => {
  const { store } = ledger(t); let calls = 0
  const transport = createPaidTransport({ apiKey: key, ledger: store, fetchImpl: async () => { calls++; return Response.json(envelope()) } })
  for (const extra of [{ model: 'deepseek-v4-pro' }, { tools: [] }, { max_tokens: 8193 }, { max_tokens: -1 }, { stream: true }, { messages: [{ role: 'system', content: 'x'.repeat(65537) }, { role: 'user', content: 'x' }] }]) await assert.rejects(transport(endpoint, init(extra)))
  await assert.rejects(transport('https://evil.invalid', init()))
  assert.equal(calls, 0); assert.equal(store.snapshot().entries.length, 0)
})
test('durable call cap survives reopen and reservations never refunded', t => {
  const { store, path } = ledger(t)
  for (let n = 0; n < POLICY.maxCalls; n++) { const id = store.reserve(100, 8192, 'hash'); store.settle(id, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }) }
  assert.throws(() => store.reserve(100, 8192, 'hash'), { code: 'BUDGET_EXHAUSTED' })
  store.close(); const other = openLedger(path); t.after(() => other.close())
  assert.throws(() => other.reserve(100, 8192, 'hash'), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(other.snapshot().entries.reduce((s, e) => s + e.reserveNano, 0), 6 * price(100, 8192))
})
test('conservative money ceiling stops BEFORE ¥1, consequently before ¥8 and ¥10', t => {
  const { store } = ledger(t)
  const input = POLICY.maxInputBytes + POLICY.framingTokens
  let count = 0
  while ((count + 1) * price(input, 8192) <= POLICY.conservativeNano) {
    const id = store.reserve(input, 8192, 'hash'); store.settle(id, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }); count++
  }
  assert.ok(count < POLICY.maxCalls)
  assert.throws(() => store.reserve(input, 8192, 'hash'), { code: 'BUDGET_EXHAUSTED' })
  assert.ok(store.snapshot().entries.reduce((s, e) => s + e.reserveNano, 0) < 1_000_000_000)
})
test('missing or over-bound usage halts automatic calls permanently; no refund', async t => {
  for (const usage of [null, {}, { prompt_tokens: 1, completion_tokens: 8193, total_tokens: 8194 }, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 4 }]) {
    const { store, path } = ledger(t); let calls = 0
    const transport = createPaidTransport({ apiKey: key, ledger: store, fetchImpl: async () => { calls++; return Response.json(envelope(usage)) } })
    await assert.rejects(transport(endpoint, init()), { code: 'USAGE_UNRELIABLE' })
    await assert.rejects(transport(endpoint, init()), { code: 'BUDGET_HALTED' }); assert.equal(calls, 1)
    store.close(); const again = openLedger(path); t.after(() => again.close()); assert.equal(again.snapshot().halted, true)
  }
})
test('sent failures retain reservation/halt; cancellation before fetch invocation releases money only', async t => {
  for (const kind of ['failure', 'invalid-json', 'oversize', 'timeout', 'cancel']) {
    const { store } = ledger(t); let calls = 0; const c = new AbortController()
    const transport = createPaidTransport({ apiKey: key, ledger: store, timeoutMs: 15, fetchImpl: async () => {
      calls++
      if (kind === 'failure') return new Response('secret upstream body', { status: 500 })
      if (kind === 'invalid-json') return new Response('not json')
      if (kind === 'oversize') return new Response('x'.repeat(262145))
      return new Promise(resolve => setTimeout(() => resolve(Response.json(envelope())), 60))
    } })
    const promise = transport(endpoint, { ...init(), signal: c.signal }); if (kind === 'cancel') c.abort()
    await assert.rejects(promise)
    await new Promise(r => setTimeout(r, 70))
    const entry = store.snapshot().entries[0]
    if (kind === 'cancel' && calls === 0) {
      assert.equal(entry.status, 'not-sent'); assert.equal(entry.releasedNano, entry.reserveNano)
      assert.equal(store.snapshot().halted, false); assert.equal(store.snapshot().entries.length, 1)
    } else {
      assert.equal(calls, 1); assert.equal(entry.status, 'uncertain'); assert.equal(entry.releasedNano, undefined)
      assert.equal(store.snapshot().halted, true)
      await assert.rejects(transport(endpoint, init()), { code: 'BUDGET_HALTED' })
    }
  }
})
test('exclusive lease, private permissions, corrupted ledger and unresolved reservation fail closed', t => {
  const { store, path } = ledger(t)
  assert.throws(() => openLedger(path), { code: 'LEDGER_LOCKED' })
  store.reserve(100, 8192, 'hash'); store.close()
  const again = openLedger(path); assert.equal(again.snapshot().halted, true); again.close()
  writeFileSync(path, '{bad', { mode: 0o600 }); assert.throws(() => openLedger(path)); assert.equal(existsSync(path + '.lock'), false)
  chmodSync(path, 0o644); assert.throws(() => openLedger(path), { code: 'LEDGER_PERMISSIONS' })
})
