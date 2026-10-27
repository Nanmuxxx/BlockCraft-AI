import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { crc32, inflateSync } from 'node:zlib'
import { createImageProvider } from '../../server/image-generation/provider.ts'
import { createAppServer } from '../../server/index.mjs'

test('disabled by default; unrecognized/extra provider options never select live transport', () => {
  for (const options of [undefined, {}, { mode: 'openai' }, { mode: 'MOCK' }, { mode: 'mock', endpoint: 'https://example.invalid' }]) {
    assert.throws(() => createImageProvider(options), { code: 'IMAGE_DISABLED' })
  }
})

test('explicit fixture is MOCK, bounded PNG with independent bytes on each call', async () => {
  const provider = createImageProvider({ mode: 'mock' })
  const generate = () => provider.generate({ prompt: '一只小猫' }, { signal: new AbortController().signal })
  const a = await generate(), b = await generate()
  assert.equal(provider.kind, 'MOCK'); assert.equal(a.kind, 'MOCK')
  assert.equal(a.mimeType, 'image/png'); assert.equal(a.width, 1); assert.equal(a.height, 1)
  assert.ok(a.bytes.length < 512 * 1024)
  assert.deepEqual([...a.bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(a.bytes.buffer)
  assert.equal(view.getUint32(16), 1); assert.equal(view.getUint32(20), 1)
  for (let offset = 8; offset < a.bytes.length;) {
    const length = view.getUint32(offset)
    assert.equal(view.getUint32(offset + 8 + length), crc32(a.bytes.slice(offset + 4, offset + 8 + length)))
    offset += 12 + length
  }
  // Check compressed raster is decodable, not just a claimed MIME/signature.
  assert.equal(inflateSync(a.bytes.slice(41, 52)).length, 3)
  a.bytes.fill(0); assert.notEqual(b.bytes[0], 0)
})

test('prompt validation rejects override fields, invalid shape, controls and excessive input', async () => {
  const provider = createImageProvider({ mode: 'mock' }), context = { signal: new AbortController().signal }
  for (const input of [null, [], {}, { prompt: '' }, { prompt: ' ' }, { prompt: 1 },
    { prompt: 'x'.repeat(501) }, { prompt: '\0bad' }, { prompt: 'cat', model: 'live' },
    { prompt: 'cat', projectId: 'forged' }, { prompt: 'cat', apiKey: 'not-accepted' }]) {
    await assert.rejects(provider.generate(input, context), { code: 'INVALID_INPUT' })
  }
})

test('cancellation before and during pending fixture delivery returns stable safe error', async () => {
  const provider = createImageProvider({ mode: 'mock' }), request = { prompt: 'cat' }
  const before = new AbortController(); before.abort(new Error('private cancellation details'))
  await assert.rejects(provider.generate(request, { signal: before.signal }), { code: 'CANCELLED', message: 'CANCELLED' })
  const during = new AbortController(), pending = provider.generate(request, { signal: during.signal })
  during.abort(); await assert.rejects(pending, { code: 'CANCELLED' })
  await assert.rejects(provider.generate(request, {}), { code: 'INVALID_INPUT' })
})

test('server guard refuses browser-like construction and subsequent use', async t => {
  const provider = createImageProvider({ mode: 'mock' })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window })
  assert.throws(() => createImageProvider({ mode: 'mock' }), { code: 'SERVER_ONLY' })
  await assert.rejects(provider.generate({ prompt: 'cat' }, { signal: new AbortController().signal }), { code: 'SERVER_ONLY' })
})

test('current HTTP server has no image route and cannot route image payload to text provider', async t => {
  let calls = 0
  const server = createAppServer({ apiKey: '', generationAccess: () => true,
    fetchImpl: async () => { calls++; throw new Error('must not call provider') } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const image = await fetch(base + '/api/image-generations', { method: 'POST' })
  assert.equal(image.status, 404)
  const text = await fetch(base + '/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'cat', projectId: 'local-project' }) })
  assert.equal(text.status, 400); assert.equal(calls, 0)
})
