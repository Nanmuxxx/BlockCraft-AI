import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeepSeekProvider, ENDPOINT, MAX_OUTPUT_TOKENS, tokenReservation } from '../../server/mochi-ai/provider.mjs'
import { projectContext, validateRequest, validateAdvice, bytes } from '../../src/integrations/mochi-ai/protocol.mjs'
import { context, request, advice, envelope } from './fixtures.mjs'

test('real provider request shape uses existing configuration, bounded context and no records', async () => {
  const source = { ...context(), records: { people: [{ name: 'BUSINESS_RECORD' }] }, secret: 'PRIVATE', snapshot: { dump: true } }
  source.entities[0].fields[0].values = ['VALUE']
  const input = request(); input.context = projectContext(source); input.prompt += ' api_key=sk-verysecret123456'
  let calls = 0
  const provider = createDeepSeekProvider({ apiKey: 'offline-key', model: 'existing-model', fetchImpl: async (url, init) => {
    calls++; assert.equal(url, ENDPOINT); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer offline-key')
    const body = JSON.parse(init.body); assert.equal(body.model, 'existing-model'); assert.equal(body.max_tokens, MAX_OUTPUT_TOKENS)
    assert.deepEqual(body.response_format, { type: 'json_object' }); assert.equal(body.stream, false)
    assert(!init.body.includes('BUSINESS_RECORD')); assert(!init.body.includes('VALUE')); assert(!init.body.includes('PRIVATE')); assert(!init.body.includes('sk-verysecret'))
    assert.equal(body.messages.length, 2); assert(tokenReservation(input) > bytes(input)); return envelope()
  } })
  assert.deepEqual(await provider.analyze(validateRequest(input)), advice()); assert.equal(calls, 1)
})

test('server rejects snapshots/records/extra metadata instead of forwarding them', () => {
  for (const field of ['records','snapshot','apiKey','commands']) {
    const input = request(); input.context[field] = {}; assert.throws(() => validateRequest(input))
  }
  const huge = context(); huge.blocks = Array.from({ length: 21 }, () => huge.blocks[0]); assert.throws(() => projectContext(huge))
  assert.throws(() => validateRequest({ ...request(), prompt: 'x'.repeat(1201) }))
  assert.throws(() => validateRequest({ ...request(), history: Array(5).fill('hi') }))
})

test('schema and referential validation reject unknown fields/blocks, capabilities and silent modifications', async () => {
  const variants = [
    { ...advice(), commands: [] }, { ...advice(), message: '' }, { ...advice(), suggestions: Array(6).fill(advice().suggestions[0]) },
    { ...advice(), suggestions: [{ ...advice().suggestions[0], blockId: 'missing' }] },
    { ...advice(), suggestions: [{ ...advice().suggestions[0], requiresUserAction: false }] },
    { ...advice(), suggestions: [{ ...advice().suggestions[0], priority: 'urgent' }] },
  ]
  for (const value of variants) {
    assert.throws(() => validateAdvice(value, context()))
    const p = createDeepSeekProvider({ apiKey: 'offline', fetchImpl: async () => envelope(value) })
    await assert.rejects(p.analyze(request()), { code: 'AI_INVALID_RESPONSE' })
  }
})

test('provider fails closed without key and never retries/falls back on HTTP, JSON or truncation errors', async () => {
  let calls = 0
  await assert.rejects(createDeepSeekProvider({ apiKey: '', fetchImpl: () => { calls++ } }).analyze(request()), { code: 'AI_NOT_CONFIGURED' })
  assert.equal(calls, 0)
  for (const response of [new Response('SECRET UPSTREAM', { status: 401 }), new Response('{'), new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })), new Response('x'.repeat(33_000))]) {
    let attempts = 0
    const p = createDeepSeekProvider({ apiKey: 'offline', fetchImpl: async () => { attempts++; return response } })
    await assert.rejects(p.analyze(request()), error => !error.message.includes('SECRET'))
    assert.equal(attempts, 1)
  }
})

test('provider aborts on deadline and external cancellation, including body reads', async () => {
  const hangingFetch = async (_url, { signal }) => { await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })) }
  await assert.rejects(createDeepSeekProvider({ apiKey: 'offline', timeoutMs: 10, fetchImpl: hangingFetch }).analyze(request()), { code: 'AI_TIMEOUT' })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(createDeepSeekProvider({ apiKey: 'offline', fetchImpl: hangingFetch }).analyze(request(), { signal: controller.signal }), { code: 'CANCELLED' })
  const abortBody = (_url, { signal }) => Promise.resolve(new Response(new ReadableStream({ start(stream) { signal.addEventListener('abort', () => stream.error(new Error('abort'))) } })))
  await assert.rejects(createDeepSeekProvider({ apiKey: 'offline', timeoutMs: 10, fetchImpl: abortBody }).analyze(request()), { code: 'AI_TIMEOUT' })
})
