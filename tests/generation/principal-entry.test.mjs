import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { createAppServer, startServer, resolveGenerationPrincipal, createOpaqueSessionPrincipalResolver, OPAQUE_SESSION_COOKIE_POLICY } from '../../server/index.mjs'
import { cases } from './fixtures.mjs'

const spec = cases.find(c => c.id === 'fitness-log').spec
const key = 'a'.repeat(32)

async function serve(t, options) {
  const server = createAppServer(options)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}/api/ai/generate`
}
const post = (url, idea = '健身训练记录', headers = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...headers },
  body: JSON.stringify({ idea }),
})

test('principal resolver is bounded and rejects boolean, malformed, errors and late results', async () => {
  const req = {}
  for (const value of [true, false, undefined, null, 3, {}, '', ' ', 'x'.repeat(257), '中'.repeat(86), 'user\n']) {
    const res = new EventEmitter()
    assert.equal(await resolveGenerationPrincipal(req, res, () => value, 20), null)
    assert.equal(res.listenerCount('close'), 0)
  }
  const res = new EventEmitter()
  assert.equal(await resolveGenerationPrincipal(req, res, () => { throw new Error('private') }, 20), null)
  let signal
  assert.equal(await resolveGenerationPrincipal(req, res, (_req, context) => { signal = context.signal; return new Promise(() => {}) }, 10), null)
  assert.equal(signal.aborted, true)
  assert.equal(await resolveGenerationPrincipal(req, res, () => '中'.repeat(85), 20), '中'.repeat(85))
  const pending = resolveGenerationPrincipal(req, res, () => new Promise(resolve => setTimeout(() => resolve('late-user'), 20)), 100)
  res.emit('close')
  assert.equal(await pending, null)
})

test('boolean identity alone cannot construct a runtime even with key and ledger configuration', async t => {
  let calls = 0
  const started = await startServer({ port: 0, env: { DEEPSEEK_API_KEY: 'synthetic-only-key', DEEPSEEK_BUDGET_LEDGER_PATH: '/synthetic/ledger' }, resolveIdentity: () => true, principalRuntimeFactory: () => { calls++; throw new Error('unused') } })
  t.after(() => started.shutdown())
  const response = await post(`http://127.0.0.1:${started.server.address().port}/api/ai/generate`)
  assert.equal(response.status, 401)
  assert.equal(calls, 0)
})

test('invalid principal rejects before request context construction', async t => {
  let calls = 0
  const url = await serve(t, { resolvePrincipal: () => true, principalRuntime: { forRequest() { calls++ } } })
  const response = await post(url)
  assert.equal(response.status, 401)
  assert.equal(calls, 0)
})

test('request contexts isolate principals, keys and normalized semantic payload under concurrency', async t => {
  const contexts = [], transports = []
  const url = await serve(t, {
    resolvePrincipal: async req => { await new Promise(resolve => setTimeout(resolve, req.headers['x-test-user'] === 'one' ? 15 : 1)); return req.headers['x-test-user'] },
    principalRuntime: { forRequest(context) {
      contexts.push(context)
      return Object.freeze({ apiKey: 'synthetic-key', model: 'mock-model', fetchImpl: async (_url, options) => {
        transports.push({ principal: context.principal, idea: JSON.parse(options.body).messages.at(-1).content })
        return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }] })
      } })
    } },
  })
  const responses = await Promise.all([post(url, '  健身一  ', { 'x-test-user': 'one' }), post(url, '健身二', { 'x-test-user': 'two', 'Idempotency-Key': 'b'.repeat(32) })])
  for (const response of responses) { assert.equal(response.status, 200); assert.deepEqual(await response.json(), spec) }
  assert.deepEqual(contexts.sort((a, b) => a.principal.localeCompare(b.principal)), [
    { principal: 'one', idempotencyKey: key, payload: { idea: '健身一' } },
    { principal: 'two', idempotencyKey: 'b'.repeat(32), payload: { idea: '健身二' } },
  ])
  assert.deepEqual(transports.sort((a, b) => a.principal.localeCompare(b.principal)), [{ principal: 'one', idea: '健身一' }, { principal: 'two', idea: '健身二' }])
})

test('invalid input and duplicate or malformed idempotency headers never construct request context', async t => {
  let calls = 0
  const url = await serve(t, { resolvePrincipal: () => 'trusted-mock-user', principalRuntime: { forRequest() { calls++; throw new Error('unused') } } })
  for (const value of ['', 'short', 'a'.repeat(129), 'a'.repeat(32) + ', ' + 'b'.repeat(32)]) assert.equal((await post(url, '健身', { 'Idempotency-Key': value })).status, 400)
  assert.equal((await post(url, '')).status, 400)
  await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: ['Content-Type', 'application/json', 'Idempotency-Key', key, 'Idempotency-Key', 'b'.repeat(32)] }, res => { assert.equal(res.statusCode, 400); res.resume(); res.on('end', resolve) })
    req.on('error', reject); req.end(JSON.stringify({ idea: '健身' }))
  })
  assert.equal(calls, 0)
})

test('request context errors return a fixed sanitized response', async t => {
  const url = await serve(t, { resolvePrincipal: () => 'private-principal', principalRuntime: { forRequest() { throw new Error('private-key private-principal private-path') } } })
  const response = await post(url)
  assert.equal(response.status, 503)
  const body = await response.text()
  assert.equal(body.includes('private'), false)
})

test('opaque cookie adapter rejects absent, expired, revoked, unknown and forged-header identities before runtime work', async t => {
  const token = 'a'.repeat(40)
  const digest = value => createHash('sha256').update(value).digest('hex')
  let calls = 0
  const resolver = createOpaqueSessionPrincipalResolver({ now: () => 10_000, sessions: [
    { sessionHash: digest(token), principal: 'stable-owner', expiresAt: 20_000, revoked: false },
    { sessionHash: digest('b'.repeat(40)), principal: 'expired-owner', expiresAt: 9_999, revoked: false },
    { sessionHash: digest('c'.repeat(40)), principal: 'revoked-owner', expiresAt: 20_000, revoked: true },
  ] })
  const url = await serve(t, { resolvePrincipal: resolver, principalRuntime: { forRequest() { calls++; throw new Error('must not run') } } })
  const denied = [
    {},
    { Cookie: `__Host-bc_session=${'b'.repeat(40)}` },
    { Cookie: `__Host-bc_session=${'c'.repeat(40)}` },
    { Cookie: `__Host-bc_session=${'d'.repeat(40)}` },
    { 'X-Principal': 'forged-owner' },
    { Origin: 'https://trusted.example', 'X-Forwarded-For': '127.0.0.1', 'X-Principal': 'forged-owner' },
    { Cookie: `__Host-bc_session=${token}; __Host-bc_session=${token}` },
  ]
  for (const headers of denied) assert.equal((await post(url, '健身', headers)).status, 401)
  assert.equal(calls, 0)
  assert.deepEqual(OPAQUE_SESSION_COOKIE_POLICY, { httpOnly: true, secure: true, sameSite: 'Strict', path: '/' })
})

test('opaque cookie hashes resolve stable principals and isolate identical keys across principals', async t => {
  const one = 'e'.repeat(40), two = 'f'.repeat(40)
  const digest = value => createHash('sha256').update(value).digest('hex')
  const contexts = []
  const resolver = createOpaqueSessionPrincipalResolver({ sessions: [
    { sessionHash: digest(one), principal: 'principal-one', expiresAt: Date.now() + 60_000, revoked: false },
    { sessionHash: digest(two), principal: 'principal-two', expiresAt: Date.now() + 60_000, revoked: false },
  ] })
  const url = await serve(t, { resolvePrincipal: resolver, principalRuntime: { forRequest(context) {
    contexts.push(context)
    return { apiKey: 'synthetic', model: 'mock', fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }] }) }
  } } })
  for (const token of [one, two]) {
    const response = await post(url, '健身记录', { Cookie: `__Host-bc_session=${token}` })
    assert.equal(response.status, 200)
  }
  assert.deepEqual(contexts.map(context => context.principal).sort(), ['principal-one', 'principal-two'])
  assert.deepEqual(contexts.map(context => context.idempotencyKey), [key, key])
})

test('CLI identity mode stays closed by default and requires a private explicit allowlist', async t => {
  let factoryCalls = 0
  const closed = await startServer({ port: 0, env: {}, principalRuntimeFactory: () => { factoryCalls++; throw new Error('must remain closed') } })
  const denied = await post(`http://127.0.0.1:${closed.server.address().port}/api/ai/generate`)
  assert.equal(denied.status, 401)
  await closed.shutdown()
  assert.equal(factoryCalls, 0)

  const directory = await mkdtemp(join(tmpdir(), 'bc-session-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const token = 'g'.repeat(40)
  const path = join(directory, 'allowlist.json')
  await writeFile(path, JSON.stringify({ sessions: [{ sessionHash: createHash('sha256').update(token).digest('hex'), principal: 'cli-owner', expiresAt: Date.now() + 60_000, revoked: false }] }), { mode: 0o600 })
  await chmod(path, 0o600)
  await chmod(path, 0o644)
  await assert.rejects(startServer({ port: 0, env: { AI_GENERATION_IDENTITY_MODE: 'opaque-session', AI_GENERATION_SESSION_ALLOWLIST_PATH: path } }), /private file/)
  await chmod(path, 0o600)
  const started = await startServer({ port: 0, env: { AI_GENERATION_IDENTITY_MODE: 'opaque-session', AI_GENERATION_SESSION_ALLOWLIST_PATH: path }, principalRuntimeFactory: () => {
    factoryCalls++
    return { forRequest: ({ principal }) => ({
      apiKey: 'synthetic', model: 'mock', fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }] }),
      principal,
    }), close() {} }
  } })
  t.after(() => started.shutdown())
  const explicitDenied = await post(`http://127.0.0.1:${started.server.address().port}/api/ai/generate`)
  assert.equal(explicitDenied.status, 401)
  const explicitMock = await post(`http://127.0.0.1:${started.server.address().port}/api/ai/generate`, 'CLI mock session', { Cookie: `__Host-bc_session=${token}` })
  assert.equal(explicitMock.status, 200)
  assert.deepEqual(await explicitMock.json(), spec)
  assert.equal(factoryCalls, 1)
})
