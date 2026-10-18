import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createDeepSeekProvider } from '../../server/custom-block/provider.mjs'
import { LIMITS } from '../../server/custom-block/protocol.mjs'
import { runLiveGeneration } from '../../server/custom-block/live-generate.mjs'
import { request, response } from './fixtures.mjs'

// All transport calls below are injected. Any accidental global network call fails.
globalThis.fetch = () => { throw new Error('TEST_NETWORK_FORBIDDEN') }
const key = 'mock-only-not-a-real-api-key'
const envelope = (content = JSON.stringify(response())) => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] })
const make = (fetchImpl, extra = {}) => createDeepSeekProvider({ allowPaid: true, apiKey: key, fetchImpl, ...extra })
const reply = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

test('paid provider construction and future CLI fail closed without explicit gates', async () => {
  assert.throws(() => createDeepSeekProvider(), { code: 'PAID_API_DISABLED' })
  assert.throws(() => createDeepSeekProvider({ allowPaid: true }), { code: 'API_CONFIGURATION' })
  assert.throws(() => make(() => {}, { apiKey: 'bad\nkey' }))
  assert.throws(() => make(() => {}, { model: 'arbitrary-model' }))
  assert.throws(() => make(() => {}, { timeoutMs: 0 }))
  await assert.rejects(runLiveGeneration({}), { code: 'EXPERIMENT_DISABLED' })
  await assert.rejects(runLiveGeneration({ BLOCKCRAFT_CUSTOM_BLOCK_ENABLED: '1' }), { code: 'PAID_API_DISABLED' })
  const result = spawnSync(process.execPath, ['server/custom-block/live-generate.mjs'], {
    env: {}, encoding: 'utf8', timeout: 5000,
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.deepEqual(JSON.parse(result.stderr), { code: 'EXPERIMENT_DISABLED' })
})
test('mock transport receives fixed HTTPS endpoint, no redirects, bounded JSON request, server-only key', async () => {
  let calls = 0
  const provider = make(async (url, init) => {
    calls++
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    assert.equal(init.redirect, 'error')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.Authorization, `Bearer ${key}`)
    const body = JSON.parse(init.body)
    assert.equal(body.stream, false)
    assert.equal(body.max_tokens, 8192)
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.equal(body.messages[1].content, request().requirement)
    assert.ok(!init.body.includes(key))
    return reply(envelope())
  })
  assert.equal(await provider.generate(request()), JSON.stringify(response()))
  assert.equal(calls, 1)
  assert.ok(!JSON.stringify(provider).includes(key))
})
for (const [label, value] of [
  ['no choices', {}], ['too many choices', { choices: [envelope().choices[0], envelope().choices[0]] }],
  ['truncated', { choices: [{ ...envelope().choices[0], finish_reason: 'length' }] }],
  ['refusal', { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}', refusal: 'no' } }] }],
  ['tool call', { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}', tool_calls: [] } }] }],
  ['not text', envelope({})], ['wrong role', { choices: [{ finish_reason: 'stop', message: { role: 'user', content: '{}' } }] }],
]) test(`provider rejects ${label}`, async () => { await assert.rejects(make(async () => reply(value)).generate(request()), { code: 'UPSTREAM_INVALID' }) })

test('HTTP errors and transport failures are redacted and never retried', async () => {
  let calls = 0
  for (const fetcher of [async () => { calls++; return new Response(key, { status: 429 }) }, async () => { calls++; throw new Error(key) }]) {
    await assert.rejects(make(fetcher).generate(request()), error => {
      assert.ok(!String(error).includes(key)); return true
    })
  }
  assert.equal(calls, 2)
})
test('declared, streamed and content byte limits are independently enforced', async () => {
  await assert.rejects(make(async () => new Response('x', { headers: { 'content-length': String(LIMITS.upstreamBytes + 1) } })).generate(request()), { code: 'UPSTREAM_LIMIT' })
  let cancelled = false
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(262144)) }, cancel() { cancelled = true } })
  await assert.rejects(make(async () => new Response(stream)).generate(request()), { code: 'UPSTREAM_LIMIT' })
  assert.ok(cancelled)
  await assert.rejects(make(async () => reply(envelope('x'.repeat(LIMITS.outputBytes + 1)))).generate(request()), { code: 'OUTPUT_LIMIT' })
})
test('invalid UTF8 and malformed envelope JSON fail closed', async () => {
  for (const body of [new Uint8Array([0xff]), '{bad']) await assert.rejects(make(async () => new Response(body)).generate(request()), { code: 'UPSTREAM_INVALID' })
})
test('timeout bounds both connection and response body; aborts transport', async () => {
  let signal
  await assert.rejects(make(async (_, init) => { signal = init.signal; return new Promise(() => {}) }, { timeoutMs: 15 }).generate(request()), { code: 'UPSTREAM_TIMEOUT' })
  assert.ok(signal.aborted)
  await assert.rejects(make(async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 15 }).generate(request()), { code: 'UPSTREAM_TIMEOUT' })
})
