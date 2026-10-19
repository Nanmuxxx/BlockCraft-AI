import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { startServer } from '../../server/index.mjs'
import { createPrincipalPaidGenerationRuntime } from '../../server/paid-gateway/runtime.mjs'
import { cases } from './fixtures.mjs'

const token = 'principal-gateway-session-token-0001'
const bindingKey = Buffer.alloc(32, 0x4b)
const apiKey = 'synthetic-test-provider-key-only'
const requestId = index => `request-key-${String(index).padStart(4, '0')}-abcdef0123456789`
const endpoint = 'https://api.deepseek.com/chat/completions'
const spec = cases.find(item => item.id === 'fitness-log').spec

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-19T12:00:00+08:00') }))

function response() {
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  })
}

function fixture(t, fetchImpl) {
  const directory = mkdtempSync(join(tmpdir(), 'bc-principal-http-'))
  chmodSync(directory, 0o700)
  const allowlistPath = join(directory, 'sessions.json')
  writeFileSync(allowlistPath, JSON.stringify({ sessions: [{
    sessionHash: createHash('sha256').update(token).digest('hex'),
    principal: 'mock-owner', expiresAt: Date.now() + 60_000, revoked: false,
  }] }), { mode: 0o600 })
  chmodSync(allowlistPath, 0o600)
  const env = {
    AI_GENERATION_IDENTITY_MODE: 'opaque-session',
    AI_GENERATION_SESSION_ALLOWLIST_PATH: allowlistPath,
    DEEPSEEK_API_KEY: apiKey,
    DEEPSEEK_BUDGET_LEDGER_PATH: join(directory, 'ledger.json'),
  }
  const started = startServer({
    host: '127.0.0.1', port: 0, env, bindingKey,
    principalRuntimeFactory: options => createPrincipalPaidGenerationRuntime({ ...options, fetchImpl, timeoutMs: 40 }),
  })
  t.after(async () => {
    const instance = await started
    await instance.shutdown()
    rmSync(directory, { recursive: true, force: true })
  })
  return { directory, env, started }
}

async function post(started, headers = {}, body = { idea: '健身训练记录，记录训练项目与时长并统计总时长' }) {
  const { server } = await started
  return fetch(`http://127.0.0.1:${server.address().port}/api/ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId(0), ...headers },
    body: JSON.stringify(body),
  })
}

function ledger(f) { return JSON.parse(readFileSync(f.env.DEEPSEEK_BUDGET_LEDGER_PATH, 'utf8')) }

test('authenticated HTTP composition returns a generated AppSpec through the real Gateway runtime', async t => {
  let egress = 0
  const f = fixture(t, async (url, init) => {
    assert.equal(url, endpoint)
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${apiKey}`)
    egress++
    return response()
  })
  const result = await post(f.started, { Cookie: `__Host-bc_session=${token}` })
  assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), spec)
  assert.equal(egress, 1)
  assert.equal(ledger(f).entries.length, 1)
  assert.equal(ledger(f).entries[0].status, 'settled')
  const { shutdown } = await f.started
  await shutdown()
})

test('missing session rejects before request context, reservation, or provider egress', async t => {
  let egress = 0
  const f = fixture(t, async () => { egress++; return response() })
  const result = await post(f.started, { 'X-Principal': 'forged' })
  assert.equal(result.status, 401)
  assert.equal(egress, 0)
  assert.deepEqual(ledger(f).entries, [])
  const { shutdown } = await f.started
  await shutdown()
})

test('budget exhaustion maps to HTTP 503 without a seventh provider request', async t => {
  let egress = 0
  const f = fixture(t, async () => { egress++; return response() })
  for (let index = 0; index < 6; index++) {
    const result = await post(f.started, {
      Cookie: `__Host-bc_session=${token}`,
      'Idempotency-Key': requestId(index + 1),
    })
    assert.equal(result.status, 200)
  }
  const denied = await post(f.started, {
    Cookie: `__Host-bc_session=${token}`,
    'Idempotency-Key': requestId(7),
  })
  assert.equal(denied.status, 503)
  assert.equal(egress, 6)
  assert.equal(ledger(f).entries.length, 6)
  const { shutdown } = await f.started
  await shutdown()
})

test('upstream timeout maps to HTTP 504 and records uncertain spend before shutdown', async t => {
  const f = fixture(t, (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const result = await post(f.started, { Cookie: `__Host-bc_session=${token}` })
  assert.equal(result.status, 504)
  const { shutdown } = await f.started
  await shutdown()
  assert.equal(ledger(f).entries[0].status, 'uncertain')
  assert.equal(ledger(f).halted, true)
})

test('client disconnect aborts the Mock upstream and preserves the uncertain ledger claim', async t => {
  let beginEgress
  const egressStarted = new Promise(resolve => { beginEgress = resolve })
  const f = fixture(t, (_url, { signal }) => {
    beginEgress()
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  })
  const { server } = await f.started
  const req = request(`http://127.0.0.1:${server.address().port}/api/ai/generate`, {
    method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify({ idea: '健身训练记录' })),
      Cookie: `__Host-bc_session=${token}`, 'Idempotency-Key': requestId(0),
    },
  })
  req.on('error', () => {})
  req.end(JSON.stringify({ idea: '健身训练记录' }))
  await egressStarted
  req.destroy()
  await server.waitForRequests()
  assert.equal(ledger(f).entries[0].status, 'uncertain')
  assert.equal(ledger(f).halted, true)
  const { shutdown } = await f.started
  await shutdown()
})
