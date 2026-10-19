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
      assert.equal(body.max_tokens, 2048)
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
for (const [name, envelope] of [
  ['multiple choices', { choices: [0, 1].map(() => ({ finish_reason: 'stop', message: { content: JSON.stringify(spec) } })) }],
  ['tool calls', { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec), tool_calls: [] } }] }],
  ['legacy function call', { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec), function_call: {} } }] }],
  ['refusal with content', { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec), refusal: 'PRIVATE_MODEL_RESPONSE' } }] }],
  ['wrong message role', { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec), role: 'user' } }] }],
  ['error with choices', { error: { message: 'PRIVATE_MODEL_RESPONSE' }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec) } }] }],
]) test(`rejects ambiguous completion: ${name}`, async t => {
  const s = await setup(t, { fetchImpl: async () => Response.json(envelope) })
  await errorIs(await s.post(), 502, 'AI_INVALID_RESPONSE')
})
test('invalid UTF-8 input is rejected before upstream, even inside valid JSON strings', async t => {
  const s = await setup(t)
  const bytes = Buffer.concat([Buffer.from('{"idea":"task'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')])
  await errorIs(await s.post({}, { body: bytes }), 400, 'INVALID_INPUT')
  assert.equal(s.calls(), 0)
})
test('invalid UTF-8 upstream cannot silently replace bytes inside an otherwise valid AppSpec', async t => {
  const envelope = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec) } }] })
  const bytes = Buffer.from(envelope.replace('任务管理', 'INVALID_UTF8_MARKER'))
  const marker = bytes.indexOf('INVALID_UTF8_MARKER')
  const invalid = Buffer.concat([bytes.subarray(0, marker), Buffer.from([0xff]), bytes.subarray(marker + 'INVALID_UTF8_MARKER'.length)])
  const s = await setup(t, { fetchImpl: async () => new Response(invalid) })
  await errorIs(await s.post(), 502, 'AI_INVALID_RESPONSE')
})
test('timeout aborts an upstream call and returns safe 504', async t => {
  const s = await setup(t, { aiTimeoutMs: 25, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }) })
  await errorIs(await s.post(), 504, 'AI_TIMEOUT')
})
test('paid gateway budget failures remain service-unavailable and opaque', async t => {
  const s = await setup(t, { fetchImpl: async () => { throw Object.assign(new Error('private ledger detail'), { code: 'BUDGET_EXHAUSTED' }) } })
  await errorIs(await s.post(), 503, 'BUDGET_EXHAUSTED')
})
test('paid transport timeout is a safe 504 even when the HTTP deadline is longer', async t => {
  const s = await setup(t, { aiTimeoutMs: 1000, fetchImpl: async () => { throw Object.assign(new Error('bounded transport timer'), { code: 'UPSTREAM_CANCELLED' }) } })
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

test('deadline releases ignored-abort transport and cancels its late response body', async t => {
  let resolve, cancelled = 0
  const s = await setup(t, { aiTimeoutMs: 10, fetchImpl: () => new Promise(r => { resolve = r }) })
  await errorIs(await s.post(), 504, 'AI_TIMEOUT')
  resolve(new Response(new ReadableStream({ cancel() { cancelled++ } })))
  await new Promise(r => setImmediate(r))
  assert.equal(cancelled, 1)
})
test('HTTP and declared-size rejection cancel unused upstream bodies without blocking admission', async t => {
  for (const [init, code] of [[{ status: 503 }, 'AI_UNAVAILABLE'], [{ headers: { 'content-length': '9999999' } }, 'AI_OUTPUT_TOO_LARGE']]) {
    let cancelled = 0
    const s = await setup(t, { fetchImpl: async () => new Response(new ReadableStream({
      cancel() { cancelled++; return new Promise(() => {}) },
    }), init) })
    await errorIs(await s.post(), 502, code)
    assert.equal(cancelled, 1)
  }
})
test('deadline releases ignored-abort body, including nonsettling cancel', async t => {
  let cancelled = 0
  const s = await setup(t, { aiTimeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({
    cancel() { cancelled++; return new Promise(() => {}) },
  })) })
  await errorIs(await s.post(), 504, 'AI_TIMEOUT')
  assert.equal(cancelled, 1)
})
test('timed-out requests do not retain concurrency slots', async t => {
  let calls = 0
  const s = await setup(t, { aiTimeoutMs: 10, fetchImpl: () => { calls++; return new Promise(() => {}) } })
  const first = await Promise.all(Array.from({ length: LIMITS.concurrentRequests }, () => s.post()))
  for (const response of first) await errorIs(response, 504, 'AI_TIMEOUT')
  await errorIs(await s.post(), 504, 'AI_TIMEOUT')
  assert.equal(calls, LIMITS.concurrentRequests + 1)
})

test('HTTP disconnect aborts upstream and releases admission even when transport ignores cancellation', async t => {
  let begin, firstSignal, late, calls = 0
  const started = new Promise(resolve => { begin = resolve })
  const s = await setup(t, { fetchImpl: (_url, { signal }) => {
    if (++calls > 1) return Promise.resolve(completion())
    firstSignal = signal; begin()
    return new Promise(resolve => { late = resolve })
  } })
  const controller = new AbortController()
  const operation = s.post({ idea: '取消的请求' }, { signal: controller.signal })
  const rejection = assert.rejects(operation)
  await started; controller.abort(); await rejection
  if (!firstSignal.aborted) await once(firstSignal, 'abort')
  assert.equal(firstSignal.aborted, true)
  assert.equal((await s.post()).status, 200)
  late(completion())
})

test('disconnect at input completion prevents a generation call before upstream dispatch', async t => {
  let calls = 0
  const server = createAppServer({ generationAccess: () => true, apiKey: 'mock-key-never-real', fetchImpl: async () => { calls++; return completion() } })
  server.once('request', (req, res) => { req.once('end', () => res.destroy()) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = `http://127.0.0.1:${server.address().port}/api/ai/generate`
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '任务工具' }) }
  await assert.rejects(fetch(url, options))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 0, 'closed response must not incur a new upstream call')
  const next = await fetch(url, options)
  assert.equal(next.status, 200); assert.equal(calls, 1)
})
