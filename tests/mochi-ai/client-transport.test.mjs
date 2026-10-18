import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiApi } from '../../src/integrations/mochi-ai/client.mjs'

for (const stage of ['fetch', 'body']) test(`deadline retires ignored ${stage} abort`, { timeout: 500 }, async () => {
  const fetchImpl = stage === 'fetch' ? () => new Promise(() => {}) : async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}) } }))
  await assert.rejects(createMochiApi({ fetchImpl, timeoutMs: 10 }).status(), { code: 'AI_TIMEOUT' })
})

test('caller cancellation retires transport and cancels a late response body', { timeout: 500 }, async () => {
  let release, cancelled = 0
  const controller = new AbortController()
  const pending = createMochiApi({ fetchImpl: () => new Promise(resolve => { release = resolve }) }).status({ signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { code: 'CANCELLED' })
  release(new Response(new ReadableStream({ cancel() { cancelled++ } })))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancelled, 1)
})

test('reader cleanup cannot retain a completed response', { timeout: 500 }, async () => {
  const response = { headers: new Headers(), ok: true, body: { cancel() { return Promise.resolve() }, getReader() { let read = false; return {
    async read() { if (read) return { done: true }; read = true; return { done: false, value: new TextEncoder().encode('{}') } },
    cancel() { return new Promise(() => {}) }, releaseLock() {},
  } } } }
  assert.deepEqual(await createMochiApi({ fetchImpl: async () => response }).status(), {})
})

for (const bytes of [[0xc3, 0x28], [0xe4, 0xb8]]) test(`reject malformed UTF-8 ${bytes.join('-')} inside JSON`, async () => {
  const payload = new Uint8Array([...new TextEncoder().encode('{"text":"'), ...bytes, ...new TextEncoder().encode('"}')])
  await assert.rejects(createMochiApi({ fetchImpl: async () => new Response(payload) }).status(), { code: 'AI_INVALID_RESPONSE' })
})

test('declared oversized response is cancelled before acquiring a reader', async () => {
  let cancelled = 0
  await assert.rejects(createMochiApi({ fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled++ } }), { headers: { 'content-length': '999999' } }) }).status(), { code: 'AI_INVALID_RESPONSE' })
  assert.equal(cancelled, 1)
})

test('valid split multibyte UTF-8 remains accepted', async () => {
  const data = new TextEncoder().encode('{"text":"你好"}')
  const body = new ReadableStream({ start(c) { for (const byte of data) c.enqueue(new Uint8Array([byte])); c.close() } })
  assert.deepEqual(await createMochiApi({ fetchImpl: async () => new Response(body) }).status(), { text: '你好' })
})

for (const code of ['constructor', '__proto__', 'toString']) test(`inherited error code ${code} remains sanitized`, async () => {
  await assert.rejects(createMochiApi({ fetchImpl: async () => new Response(JSON.stringify({ error: { code, message: 'SECRET' } }), { status: 502 }) }).status(), e => e.code === 'AI_UNAVAILABLE' && typeof e.message === 'string' && !e.message.includes('SECRET'))
})
