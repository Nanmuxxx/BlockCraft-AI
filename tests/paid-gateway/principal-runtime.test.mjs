import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync, readFileSync, rmSync, renameSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createPrincipalPaidGenerationRuntime, paidGatewayHttpStatus } from '../../server/paid-gateway/runtime.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { PRICING, POLICY } from '../../server/paid-gateway/pricing.mjs'

const key = 'synthetic-runtime-key-not-secret'
const bindingKey = Buffer.alloc(32, 42)
const endpoint = 'https://api.deepseek.com/chat/completions'
const idempotencyKey = '0123456789abcdefghijklmnopqrstuv'
const payload = { idea: 'task list' }
const init = signal => ({ method: 'POST', signal, body: JSON.stringify({ model: PRICING.model, messages: [{ role: 'system', content: 'JSON' }, { role: 'user', content: 'task list' }], stream: false, response_format: { type: 'json_object' }, max_tokens: 100 }) })
const response = () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-19T12:00:00+08:00') }))
function fixture(t, fetchImpl = async () => response(), options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'principal-runtime-')); chmodSync(dir, 0o700)
  const env = { DEEPSEEK_API_KEY: key, DEEPSEEK_BUDGET_LEDGER_PATH: join(dir, 'ledger.json') }
  let runtime = createPrincipalPaidGenerationRuntime({ env, bindingKey, fetchImpl, ...options })
  t.after(() => { runtime.close(); rmSync(dir, { recursive: true, force: true }) })
  return { dir, env, get runtime() { return runtime }, reopen() { runtime.close(); runtime = createPrincipalPaidGenerationRuntime({ env, bindingKey, fetchImpl, ...options }); return runtime }, state: () => JSON.parse(readFileSync(env.DEEPSEEK_BUDGET_LEDGER_PATH)), claims: () => JSON.parse(readFileSync(join(dir, '.paid-idempotency.json'))) }
}
const request = (runtime, overrides = {}) => runtime.forRequest({ principal: 'principal-a', idempotencyKey, payload, ...overrides }).fetchImpl

test('one claim and reservation, canonical request replay/conflict, restart, single use', async t => {
  let calls = 0
  const f = fixture(t, async () => { calls++; return response() })
  const transport = request(f.runtime)
  await transport(endpoint, init())
  assert.equal(f.state().entries.length, 1); assert.equal(f.state().entries[0].status, 'settled')
  await assert.rejects(transport(endpoint, init()), { code: 'REQUEST_CONTEXT_USED' })
  await assert.rejects(request(f.runtime)(endpoint, init()), { code: 'IDEMPOTENCY_REPLAY' })
  await assert.rejects(request(f.runtime, { payload: { idea: 'another' } })(endpoint, init()), { code: 'IDEMPOTENCY_CONFLICT' })
  f.reopen()
  const reordered = init(); const body = JSON.parse(reordered.body); reordered.body = JSON.stringify(Object.fromEntries(Object.entries(body).reverse()))
  await assert.rejects(request(f.runtime)(endpoint, reordered), { code: 'IDEMPOTENCY_REPLAY' })
  assert.equal(calls, 1); assert.equal(f.state().entries.length, 1); assert.equal(f.claims().claims.length, 1)
  assert.ok(!JSON.stringify(f.claims()).includes('principal-a')); assert.ok(!JSON.stringify(f.state()).includes(key))
})

test('request closures cannot cross principals; shared gate rejects concurrent distinct request', async t => {
  let finish, started
  const entered = new Promise(r => { started = r })
  let calls = 0
  const f = fixture(t, () => { calls++; started(); return new Promise(r => { finish = r }) })
  const first = request(f.runtime), second = request(f.runtime, { principal: 'principal-b' })
  const pending = first(endpoint, init()); await entered
  await assert.rejects(request(f.runtime)(endpoint, init()), { code: 'IDEMPOTENCY_REPLAY' })
  await assert.rejects(second(endpoint, init()), { code: 'CONCURRENCY_LIMIT' })
  assert.throws(() => f.runtime.close(), { code: 'RUNTIME_BUSY' })
  assert.throws(() => openLedger(f.env.DEEPSEEK_BUDGET_LEDGER_PATH), { code: 'LEDGER_LOCKED' })
  finish(response()); await pending
  const next = second(endpoint, init()); await new Promise(r => setImmediate(r)); finish(response()); await next
  assert.equal(calls, 2); assert.equal(f.state().entries.length, 2); assert.equal(f.claims().claims.length, 2)
})

test('invalid identity, payload, key and missing binding configuration are rejected without claim/reserve/egress', t => {
  let calls = 0; const f = fixture(t, () => { calls++; return response() })
  for (const principal of [undefined, true, '', 'x'.repeat(257)]) assert.throws(() => request(f.runtime, { principal }), { code: 'PRINCIPAL_INVALID' })
  assert.throws(() => request(f.runtime, { idempotencyKey: ['forged'] }), { code: 'IDEMPOTENCY_KEY_INVALID' })
  assert.throws(() => request(f.runtime, { payload: { idea: 'x', approval: true } }), { code: 'IDEMPOTENCY_PAYLOAD_INVALID' })
  assert.throws(() => createPrincipalPaidGenerationRuntime({ env: f.env }), { code: 'IDEMPOTENCY_KEY_REQUIRED' })
  assert.equal(f.state().entries.length, 0); assert.equal(f.claims().claims.length, 0); assert.equal(calls, 0)
})

for (const mode of ['timeout', 'disconnect', 'throw']) test(mode + ' preserves claim and unknown outcome halt across restart', async t => {
  let calls = 0
  const f = fixture(t, async () => { calls++; if (mode === 'throw') throw Error(key); return new Promise(() => {}) }, { timeoutMs: 20 })
  const controller = new AbortController()
  const pending = request(f.runtime)(endpoint, init(controller.signal))
  if (mode === 'disconnect') controller.abort()
  await assert.rejects(pending)
  assert.equal(f.state().entries[0].status, 'uncertain'); assert.equal(f.state().halted, true)
  const count = calls; f.reopen()
  await assert.rejects(request(f.runtime)(endpoint, init()), { code: 'IDEMPOTENCY_REPLAY' })
  await assert.rejects(request(f.runtime, { principal: 'another' })(endpoint, init()), { code: 'BUDGET_HALTED' })
  assert.equal(calls, count); assert.equal(f.state().entries.length, 1)
})

test('sidecar persist failure, lock and exhausted durable budget deny before egress', async t => {
  let calls = 0; const f = fixture(t, async () => { calls++; return response() })
  assert.throws(() => createPrincipalPaidGenerationRuntime({ env: f.env, bindingKey }), { code: 'LEDGER_LOCKED' })
  const path = join(f.dir, '.paid-idempotency.json')
  renameSync(path, path + '.saved'); mkdirSync(path)
  await assert.rejects(request(f.runtime)(endpoint, init()), { code: 'IDEMPOTENCY_UNAVAILABLE' })
  assert.equal(calls, 0); assert.equal(f.state().entries.length, 0)
  rmSync(path, { recursive: true }); renameSync(path + '.saved', path)
  f.reopen()
  for (let i = 0; i < POLICY.maxCalls; i++) await request(f.runtime, { principal: 'p' + i })(endpoint, init())
  await assert.rejects(request(f.runtime, { principal: 'over-budget' })(endpoint, init()), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(calls, POLICY.maxCalls); assert.equal(f.state().entries.length, POLICY.maxCalls)
})

test('native clock is never extended: expiry denies real ledger and composed runtime with zero reserve/egress', t => {
  t.mock.timers.reset()
  if (Date.now() < PRICING.expiresAt) t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt })
  let calls = 0; const f = fixture(t, async () => { calls++; return response() })
  // Pin the child to the imported snapshot boundary for deterministic expiry coverage.
  const source = `import {openLedger} from './server/paid-gateway/ledger.mjs'; import {PRICING} from './server/paid-gateway/pricing.mjs'; Date.now=()=>PRICING.expiresAt; if(Date.now()<PRICING.expiresAt) process.exit(2); const l=openLedger(process.argv[1]); try { l.reserve(100,100,'mock'); process.exitCode=3 } catch(e) { if(e.code!=='PRICING_EXPIRED') throw e; if(l.snapshot().entries.length) process.exitCode=4 } finally {l.close()}`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, join(f.dir, 'native.json')], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  return assert.rejects(request(f.runtime)(endpoint, init()), e => { assert.equal(e.code, 'PRICING_EXPIRED'); assert.equal(paidGatewayHttpStatus(e), 503); assert.equal(calls, 0); assert.equal(f.state().entries.length, 0); return true })
})

test('HTTP mapping is explicit and unknown/storage/config/pricing errors default503', () => {
  for (const [code, status] of Object.entries({ PRINCIPAL_INVALID: 401, IDEMPOTENCY_KEY_INVALID: 400, IDEMPOTENCY_REPLAY: 409, IDEMPOTENCY_CONFLICT: 409, REQUEST_CONTEXT_USED: 409, UPSTREAM_CANCELLED: 504, IDEMPOTENCY_LOCKED: 503, PRICING_EXPIRED: 503, BUDGET_EXHAUSTED: 503 })) assert.equal(paidGatewayHttpStatus({ code }), status)
  assert.equal(paidGatewayHttpStatus(new Error(key)), 503)
})
