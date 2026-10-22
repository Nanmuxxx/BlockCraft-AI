import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrincipalPaidGenerationRuntime, paidGatewayHttpStatus } from '../../server/paid-gateway/runtime.mjs'
import { PRICING, POLICY, SMOKE_POLICY, price } from '../../server/paid-gateway/pricing.mjs'

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt - 60 * 60 * 1000 }))

const envKey = 'synthetic-offline-key-only'
const bindingKey = Buffer.alloc(32, 17)
const endpoint = 'https://api.deepseek.com/chat/completions'
const idem = '0123456789abcdefghijklmnopqrstuv'
const payload = { idea: 'pomodoro timer', protocol: 'trusted-interactive/1' }
const request = signal => ({ method: 'POST', signal, body: JSON.stringify({ model: PRICING.model,
  messages: [{ role: 'system', content: 'JSON only' }, { role: 'user', content: 'mock' }],
  stream: false, response_format: { type: 'json_object' }, max_tokens: POLICY.maxOutputTokens }) })
const reply = () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })

function fixture(t, fetchImpl = async () => reply(), timeoutMs) {
  const directory = mkdtempSync(join(tmpdir(), 'principal-smoke-'))
  chmodSync(directory, 0o700)
  const env = { DEEPSEEK_API_KEY: envKey, DEEPSEEK_BUDGET_LEDGER_PATH: join(directory, 'ledger.json') }
  const create = (options = {}) => createPrincipalPaidGenerationRuntime({ env, bindingKey, fetchImpl, timeoutMs, ...options })
  let runtime = create()
  t.after(() => { try { runtime.close() } catch {}; rmSync(directory, { recursive: true, force: true }) })
  return { directory, env, get runtime() { return runtime }, reopen() { runtime.close(); runtime = create() },
    ledger: () => JSON.parse(readFileSync(env.DEEPSEEK_BUDGET_LEDGER_PATH, 'utf8')),
    fetch: (principal = 'owner', key = idem, body = payload) => runtime.forRequest({ principal, idempotencyKey: key, payload: body }).fetchImpl }
}

test('principal runtime honors explicit local-smoke profile and rejects mismatched profiles', t => {
  const f = fixture(t)
  assert.throws(() => createPrincipalPaidGenerationRuntime({ env: f.env, bindingKey, fetchImpl: async () => reply(), policy: SMOKE_POLICY, profile: 'production' }), { code: 'LEDGER_PROFILE' })
  const smokeDirectory = mkdtempSync(join(tmpdir(), 'principal-smoke-profile-'))
  chmodSync(smokeDirectory, 0o700)
  t.after(() => rmSync(smokeDirectory, { recursive: true, force: true }))
  const smokeEnv = { ...f.env, DEEPSEEK_BUDGET_LEDGER_PATH: join(smokeDirectory, 'ledger.json') }
  const smoke = createPrincipalPaidGenerationRuntime({ env: smokeEnv, bindingKey, fetchImpl: async () => reply(), policy: SMOKE_POLICY, profile: 'local-smoke' })
  assert.equal(smoke.policy, SMOKE_POLICY)
  assert.equal(JSON.parse(readFileSync(smokeEnv.DEEPSEEK_BUDGET_LEDGER_PATH, 'utf8')).profile, 'local-smoke')
  smoke.close()
})

test('principal-scoped idempotency claims and budget survive runtime reopen', async t => {
  let calls = 0
  const f = fixture(t, async () => { calls++; return reply() })
  await f.fetch()(endpoint, request())
  await assert.rejects(f.fetch()(endpoint, request()), { code: 'IDEMPOTENCY_REPLAY' })
  await assert.rejects(f.fetch('owner', idem, { idea: 'different', protocol: 'trusted-interactive/1' })(endpoint, request()), { code: 'IDEMPOTENCY_CONFLICT' })
  f.reopen()
  await assert.rejects(f.fetch()(endpoint, request()), { code: 'IDEMPOTENCY_REPLAY' })
  assert.equal(calls, 1)
  assert.equal(f.ledger().entries.length, 1)
})

test('invalid identity fails before a durable reservation or provider egress', t => {
  let calls = 0
  const f = fixture(t, async () => { calls++; return reply() })
  for (const principal of [undefined, true, '', 'x'.repeat(257)]) {
    assert.throws(() => f.runtime.forRequest({ principal, idempotencyKey: idem, payload }), { code: 'PRINCIPAL_INVALID' })
  }
  assert.equal(f.ledger().entries.length, 0)
  assert.equal(calls, 0)
  assert.equal(paidGatewayHttpStatus({ code: 'PRINCIPAL_INVALID' }), 401)
})

test('default main cap is shared across principals and denies the next call before egress', async t => {
  let calls = 0
  const f = fixture(t, async () => { calls++; return reply() })
  for (let n = 0; n < POLICY.maxCalls; n++) await f.fetch('principal-' + n)(endpoint, request())
  f.reopen()
  await assert.rejects(f.fetch('fourth-principal')(endpoint, request()), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(calls, POLICY.maxCalls)
  assert.equal(f.ledger().entries.length, POLICY.maxCalls)
  assert.ok(f.ledger().entries.reduce((sum, entry) => sum + entry.reserveNano, 0) <= POLICY.conservativeNano)
  assert.equal(POLICY.maxCalls, 8)
  assert.equal(POLICY.conservativeNano, 1_000_000_000)
})

test('concurrent principals share one in-flight gate and only the admitted call reserves', async t => {
  let release, calls = 0
  const f = fixture(t, () => { calls++; return new Promise(resolve => { release = () => resolve(reply()) }) })
  const first = f.fetch('one')(endpoint, request())
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(f.fetch('two')(endpoint, request()), { code: 'CONCURRENCY_LIMIT' })
  assert.equal(f.ledger().entries.length, 1)
  release(); await first
  assert.equal(calls, 1)
})

test('timeout and disconnect mark reservations uncertain and halt after restart', async t => {
  for (const mode of ['timeout', 'disconnect']) {
    const f = fixture(t, () => new Promise(() => {}), mode === 'timeout' ? 15 : undefined)
    const controller = new AbortController()
    const pending = f.fetch()(endpoint, request(controller.signal))
    if (mode === 'disconnect') controller.abort()
    await assert.rejects(pending)
    assert.equal(f.ledger().entries[0].status, 'uncertain')
    assert.equal(f.ledger().halted, true)
    f.reopen()
    await assert.rejects(f.fetch('another-principal')(endpoint, request()), { code: 'BUDGET_HALTED' })
  }
})
