import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { request as httpRequest } from 'node:http'
import { createAppServer, LIMITS } from '../../server/index.mjs'
import { cases } from './fixtures.mjs'

async function fixture(t) {
  let calls = 0
  const server = createAppServer({ apiKey: 'offline-ingress-key', fetchImpl: async () => {
    calls++
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(cases[0].spec) } }] })
  } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const port = server.address().port, origin = `http://127.0.0.1:${port}`
  return { port, origin, calls: () => calls,
    post: () => fetch(`${origin}/api/ai/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: cases[0].idea }) }) }
}

async function socketFor(t, port) {
  const socket = createConnection({ host: '127.0.0.1', port })
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  return socket
}
async function rejectedUpload(t, f, request, status, code) {
  const socket = await socketFor(t, f.port)
  let response = '', timer
  socket.setEncoding('utf8'); socket.on('data', chunk => { response += chunk })
  const closed = once(socket, 'close')
  socket.write(request)
  try {
    await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Rejected ${status} upload retained its socket`)), 500) })])
  } finally { clearTimeout(timer); socket.destroy() }
  assert.match(response, new RegExp(`^HTTP/1.1 ${status} `))
  assert.match(response, /\r\nConnection: close\r\n/i)
  const boundary = response.indexOf('\r\n\r\n')
  let body = Buffer.from(response.slice(boundary + 4))
  if (/\r\nTransfer-Encoding: chunked\r\n/i.test(response.slice(0, boundary + 2))) {
    const chunks = []
    while (body.length) {
      const line = body.indexOf('\r\n')
      assert.ok(line > 0, 'complete chunk size line')
      const size = Number.parseInt(body.subarray(0, line).toString(), 16)
      assert.ok(Number.isSafeInteger(size) && size >= 0)
      body = body.subarray(line + 2)
      if (size === 0) break
      assert.ok(body.length >= size + 2, 'complete response chunk')
      chunks.push(body.subarray(0, size))
      assert.equal(body.subarray(size, size + 2).toString(), '\r\n')
      body = body.subarray(size + 2)
    }
    body = Buffer.concat(chunks)
  }
  assert.equal(JSON.parse(body.toString()).error.code, code)
}

const head = (f, { path = '/api/ai/generate', method = 'POST', headers = 'Content-Type: application/json', length = 1000 } = {}) =>
  `${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1:${f.port}\r\nConnection: keep-alive\r\nContent-Length: ${length}\r\n${headers}\r\n\r\n{`

for (const [name, options, status, code] of [
  ['media type', { headers: 'Content-Type: text/plain' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
  ['cross-origin', { headers: 'Content-Type: application/json\r\nOrigin: https://untrusted.invalid' }, 403, 'ORIGIN_REJECTED'],
  ['declared size', { length: LIMITS.requestBytes + 1 }, 413, 'INPUT_TOO_LARGE'],
  ['method', { method: 'PUT' }, 405, 'METHOD_NOT_ALLOWED'],
  ['route', { path: '/api/ai/unknown' }, 404, 'NOT_FOUND'],
]) test(`generation rejects unfinished ${name} uploads and closes without waiting for body`, { timeout: 2000 }, async t => {
  const f = await fixture(t)
  await rejectedUpload(t, f, head(f, options), status, code)
  assert.equal(f.calls(), 0)
  const next = await f.post(); assert.equal(next.status, 200); await next.json()
  assert.equal(f.calls(), 1, 'a rejected incomplete upload leaves generation available')
})

test('over-limit unfinished chunked upload is structured 413 and releases the generation slot', { timeout: 2000 }, async t => {
  const f = await fixture(t), chunk = 'x'.repeat(LIMITS.requestBytes + 1)
  await rejectedUpload(t, f, `POST /api/ai/generate HTTP/1.1\r\nHost: 127.0.0.1:${f.port}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n${chunk.length.toString(16)}\r\n${chunk}\r\n`, 413, 'INPUT_TOO_LARGE')
  assert.equal(f.calls(), 0)
  const next = await f.post(); assert.equal(next.status, 200); await next.json()
  assert.equal(f.calls(), 1)
})

test('unfinished uploads occupy bounded slots, reject the fifth and release slots on disconnect', { timeout: 2500 }, async t => {
  const f = await fixture(t), sockets = []
  for (let i = 0; i < LIMITS.concurrentRequests; i++) {
    const socket = await socketFor(t, f.port); sockets.push(socket); socket.write(head(f))
  }
  await rejectedUpload(t, f, head(f), 503, 'SERVER_BUSY')
  assert.equal(f.calls(), 0)
  await Promise.all(sockets.map(async socket => { const closed = once(socket, 'close'); socket.destroy(); await closed }))
  // A valid request might race server-side close notification; observe cleanup
  // with a new connection after all the old peers have been closed locally.
  const next = await f.post(); assert.equal(next.status, 200); await next.json()
  assert.equal(f.calls(), 1)
})

test('generation accepts valid multibyte JSON split inside a UTF-8 codepoint', async t => {
  const f = await fixture(t), body = Buffer.from(JSON.stringify({ idea: '制作社团报名应用🙂' })), at = body.indexOf(Buffer.from('🙂')) + 1
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(`${f.origin}/api/ai/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode, spec: JSON.parse(Buffer.concat(chunks)) }))
    })
    req.on('error', reject); req.write(body.subarray(0, at)); req.end(body.subarray(at))
  })
  assert.equal(response.status, 200); assert.deepEqual(response.spec, cases[0].spec); assert.equal(f.calls(), 1)
})
