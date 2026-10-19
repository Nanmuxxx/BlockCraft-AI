import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { request } from 'node:http'
import { createAppServer, startServer, resolveGenerationPrincipal } from '../../server/index.mjs'
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
