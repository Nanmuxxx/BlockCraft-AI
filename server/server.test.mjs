import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import { createAppServer, LIMITS } from './index.mjs'

const spec = {
  version: 1, id: 'tasks-app', name: '任务管理',
  entities: [{ id: 'tasks', name: '任务', fields: [{ id: 'title', name: '名称', type: 'text', required: true }] }],
  blocks: [{ id: 'task-form', name: '添加任务', type: 'form', fieldIds: ['title'] }],
  relations: [{ id: 'task-binding', type: 'dataBinding', blockId: 'task-form', entityId: 'tasks' }],
}
const completion = (content = JSON.stringify(spec), finish_reason = 'stop') => Response.json({
  choices: [{ finish_reason, message: { content } }],
})
async function setup(t, options = {}) {
  let calls = 0
  const server = createAppServer({ generationAccess: () => true,
    apiKey: 'mock-key-never-real',
    fetchImpl: async () => { calls++; return completion() },
    ...options,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return {
    base,
    calls: () => calls,
    post: (input = { idea: '做一个任务管理工具' }, extra = {}) => fetch(`${base}/api/ai/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), ...extra,
    }),
  }
}
async function errorIs(response, status, code) {
  assert.equal(response.status, status)
  const body = await response.json()
  assert.equal(body.error.code, code)
  assert.deepEqual(Object.keys(body), ['error'])
  assert.ok(!JSON.stringify(body).includes('mock-key-never-real'))
}

test('health works without a key and never calls upstream', async t => {
  const s = await setup(t, { apiKey: '' })
  const response = await fetch(`${s.base}/api/health`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { status: 'ok' })
  assert.equal(s.calls(), 0)
})
test('missing key produces safe 503 without upstream call', async t => {
  const s = await setup(t, { apiKey: '' })
  await errorIs(await s.post(), 503, 'AI_NOT_CONFIGURED')
  assert.equal(s.calls(), 0)
})
test('invalid idea, unexpected fields, and malformed JSON never reach upstream', async t => {
  const s = await setup(t)
  for (const input of [null, [], {}, { idea: '' }, { idea: '   ' }, { idea: 42 }, { idea: 'x'.repeat(4001) }, { idea: 'x', model: 'override' }]) {
    await errorIs(await s.post(input), 400, 'INVALID_INPUT')
  }
  await errorIs(await s.post({}, { body: '{' }), 400, 'INVALID_INPUT')
  assert.equal(s.calls(), 0)
})
test('body byte limit and content type are enforced before upstream', async t => {
  const s = await setup(t)
  await errorIs(await s.post({ idea: 'x'.repeat(LIMITS.requestBytes) }), 413, 'INPUT_TOO_LARGE')
  await errorIs(await s.post({}, { headers: { 'Content-Type': 'text/plain' } }), 415, 'UNSUPPORTED_MEDIA_TYPE')
  assert.equal(s.calls(), 0)
})
test('chunked body cannot bypass byte limit', async t => {
  const s = await setup(t)
  const result = await new Promise((resolve, reject) => {
    const req = httpRequest(`${s.base}/api/ai/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
    })
    req.on('error', reject)
    req.write('x'.repeat(LIMITS.requestBytes))
    req.end('x')
  })
  assert.equal(result.status, 413)
  assert.equal(result.body.error.code, 'INPUT_TOO_LARGE')
  assert.equal(s.calls(), 0)
})
test('mock valid result uses official endpoint, default model, JSON mode, and actual AppSpec source', async t => {
  let called = false
  const s = await setup(t, {
    model: 'deepseek-v4-flash',
    fetchImpl: async (url, options) => {
      called = true
      assert.equal(url, 'https://api.deepseek.com/chat/completions')
      assert.equal(options.headers.Authorization, 'Bearer mock-key-never-real')
      assert.equal(options.redirect, 'error')
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'deepseek-v4-flash')
      assert.deepEqual(body.response_format, { type: 'json_object' })
      assert.equal(body.stream, false)
      assert.equal(body.max_tokens, 8192)
      assert.match(body.messages[0].content, /JSON/)
      assert.match(body.messages[0].content, /export interface AppSpec/)
      assert.equal(body.messages[1].content, '做一个任务管理工具')
      return completion()
    },
  })
  const response = await s.post()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), spec)
  assert.equal(called, true)
})
test('DEEPSEEK_MODEL overrides the default server-side', async t => {
  const previous = process.env.DEEPSEEK_MODEL
  process.env.DEEPSEEK_MODEL = 'mock-configured-model'
  try {
    const s = await setup(t, { fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).model, 'mock-configured-model')
      return completion()
    } })
    assert.equal((await s.post()).status, 200)
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_MODEL
    else process.env.DEEPSEEK_MODEL = previous
  }
})
for (const [name, content] of [
  ['non-JSON model content', 'PRIVATE_MODEL_RESPONSE'],
  ['wrong protocol', '{}'],
  ['extra executable property', JSON.stringify({ ...spec, script: 'PRIVATE_MODEL_RESPONSE' })],
  ['missing binding', JSON.stringify({ ...spec, relations: [] })],
  ['cross-entity field', JSON.stringify({ ...spec, blocks: [{ ...spec.blocks[0], fieldIds: ['absent'] }] })],
]) test(`rejects ${name} with the existing validator and safe errors`, async t => {
  const s = await setup(t, { fetchImpl: async () => completion(content) })
  const response = await s.post()
  assert.equal(response.status, 502)
  const body = await response.json()
  assert.equal(body.error.code, 'AI_INVALID_SPEC')
  assert.ok(!JSON.stringify(body).includes('PRIVATE_MODEL_RESPONSE'))
})
for (const [name, response, code] of [
  ['malformed upstream JSON', () => new Response('PRIVATE_MODEL_RESPONSE'), 'AI_INVALID_RESPONSE'],
  ['truncated output', () => completion(JSON.stringify(spec), 'length'), 'AI_INVALID_RESPONSE'],
  ['empty choices', () => Response.json({ choices: [] }), 'AI_INVALID_RESPONSE'],
  ['upstream HTTP failure', () => new Response('PRIVATE_MODEL_RESPONSE', { status: 401 }), 'AI_UNAVAILABLE'],
  ['oversized envelope', () => new Response('x'.repeat(LIMITS.upstreamBytes + 1)), 'AI_OUTPUT_TOO_LARGE'],
  ['oversized generated content', () => completion('x'.repeat(LIMITS.outputBytes + 1)), 'AI_OUTPUT_TOO_LARGE'],
]) test(`handles ${name}`, async t => {
  const s = await setup(t, { fetchImpl: async () => response() })
  await errorIs(await s.post(), 502, code)
})
test('timeout aborts an upstream call and returns safe 504', async t => {
  const s = await setup(t, { aiTimeoutMs: 25, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }) })
  await errorIs(await s.post(), 504, 'AI_TIMEOUT')
})
test('timeout also covers upstream body consumption', async t => {
  const s = await setup(t, { aiTimeoutMs: 25, fetchImpl: async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }) },
  })) })
  await errorIs(await s.post(), 504, 'AI_TIMEOUT')
})
test('rate limit ignores forged forwarding headers and leaves health available', async t => {
  const s = await setup(t, { apiKey: '' })
  for (let i = 0; i < LIMITS.requestsPerMinute; i++) {
    assert.equal((await s.post({}, { headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${i}` } })).status, 400)
  }
  const response = await s.post()
  assert.ok(Number(response.headers.get('retry-after')) > 0)
  await errorIs(response, 429, 'RATE_LIMITED')
  assert.equal((await fetch(`${s.base}/api/health`)).status, 200)
  assert.equal(s.calls(), 0)
})
test('concurrency cap rejects excess calls without starting another upstream request', async t => {
  const pending = []
  const s = await setup(t, { fetchImpl: async () => new Promise(resolve => pending.push(resolve)) })
  const requests = Array.from({ length: LIMITS.concurrentRequests }, () => s.post())
  while (pending.length < LIMITS.concurrentRequests) await new Promise(resolve => setTimeout(resolve, 5))
  await errorIs(await s.post(), 503, 'SERVER_BUSY')
  pending.forEach(resolve => resolve(completion()))
  for (const response of await Promise.all(requests)) assert.equal(response.status, 200)
})
test('cross-origin requests and wrong methods/paths never call upstream', async t => {
  const s = await setup(t)
  await errorIs(await s.post({}, { headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' } }), 403, 'ORIGIN_REJECTED')
  await errorIs(await fetch(`${s.base}/api/ai/generate`), 405, 'METHOD_NOT_ALLOWED')
  await errorIs(await fetch(`${s.base}/unknown`), 404, 'NOT_FOUND')
  assert.equal(s.calls(), 0)
})
