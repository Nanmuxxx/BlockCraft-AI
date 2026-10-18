import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { createMochiHandler } from '../../server/mochi-ai/http.mjs'
import { createMochiService } from '../../server/mochi-ai/service.mjs'
import { createDeepSeekProvider } from '../../server/mochi-ai/provider.mjs'
import { createMochiIntegration } from '../../server/mochi-ai/index.mjs'
import { request, envelope, access, grant } from './fixtures.mjs'
async function fixture(t, options = {}, handlerOptions = {}) {
  let calls = 0
  const provider = createDeepSeekProvider({ apiKey: 'OFFLINE FIXTURE ONLY', fetchImpl: async () => { calls++; return envelope() } })
  const service = createMochiService({ provider, reserveBudget: () => true, enabled: true, approval: grant(Date.now()), ...options })
  let handler
  const server = createServer(async (req, res) => { if (!await handler(req,res)) { res.writeHead(404); res.end() } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  handler = createMochiHandler({ service, allowedOrigin: origin, resolveAccess: req => req.headers.cookie === 'test=trusted' ? access : null, ...handlerOptions })
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const post = (path, body, headers = {}) => fetch(`${origin}/api/mochi-ai/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: 'test=trusted', origin, ...headers }, body: JSON.stringify(body) })
  return { post, origin, count: () => calls }
}
test('full offline HTTP user chat -> provider -> schema -> structured suggestion', async t => {
  const f = await fixture(t); const response = await f.post('analyze', request()), body = await response.json()
  assert.equal(response.status, 200); assert.equal(body.source, 'deepseek'); assert.equal(body.suggestions[0].blockId, 'form')
  assert.match(body.suggestions[0].id, /^ai-/); assert.equal(body.capabilities.modifications, false); assert.equal(f.count(), 1)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('HTTP rejects malformed UTF-8 before provider egress', async t => {
  const f = await fixture(t)
  const input = { ...request(), prompt: 'MARKER' }
  const raw = Buffer.from(JSON.stringify(input)), at = raw.indexOf('MARKER')
  const body = Buffer.concat([raw.subarray(0, at), Buffer.from([0xc3, 0x28]), raw.subarray(at + 6)])
  const response = await fetch(`${f.origin}/api/mochi-ai/analyze`, { method: 'POST', headers: { origin: f.origin, cookie: 'test=trusted', 'Content-Type': 'application/json' }, body })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, 'INVALID_INPUT')
  assert.equal(f.count(), 0)
})

test('ignored access resolver deadline retires HTTP admission with no model call', { timeout: 1000 }, async t => {
  let rejectOld, observed
  const f = await fixture(t, {}, { accessTimeoutMs: 10, resolveAccess: (_req, { signal } = {}) => { observed = signal; return new Promise((_, reject) => { rejectOld = reject }) } })
  const response = await f.post('analyze', request())
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'ACCESS_UNAVAILABLE')
  assert.equal(observed.aborted, true); assert.equal(f.count(), 0)
  rejectOld(new Error('late private access error'))
  await new Promise(resolve => setImmediate(resolve))
})

test('HTTP disconnect aborts pending access and consumes a late rejection without egress', { timeout: 1000 }, async t => {
  let started, rejectOld
  const ready = new Promise(resolve => { started = resolve })
  const f = await fixture(t, {}, { resolveAccess: (_req, { signal }) => {
    started(signal)
    return new Promise((_, reject) => { rejectOld = reject })
  } })
  const controller = new AbortController()
  const pending = fetch(`${f.origin}/api/mochi-ai/analyze`, { method: 'POST', headers: { origin: f.origin, cookie: 'test=trusted', 'Content-Type': 'application/json' }, body: JSON.stringify(request()), signal: controller.signal })
  const signal = await ready, aborted = once(signal, 'abort')
  controller.abort(); await assert.rejects(pending)
  await aborted
  rejectOld(new Error('late private access failure'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(signal.aborted, true); assert.equal(f.count(), 0)
})
test('full offline HTTP opt-in -> event -> ignore -> opt-out -> rejected event', async t => {
  const f = await fixture(t)
  assert.equal((await f.post('analyze', request('proactive'))).status, 403)
  assert.equal((await f.post('consent', { enabled: true })).status, 200)
  const result = await (await f.post('analyze', request('proactive'))).json()
  assert.equal((await f.post('ignore', { id: result.suggestions[0].id })).status, 200)
  assert.equal((await f.post('consent', { enabled: false })).status, 200)
  assert.equal((await f.post('analyze', request('proactive'))).status, 403); assert.equal(f.count(), 1)
})
test('HTTP denies cross-origin, unauthenticated, invalid media/body/size/method with zero egress', async t => {
  const f = await fixture(t)
  for (const [headers, status] of [[{ origin: 'https://evil.test' },403],[{ cookie: 'spoof' },401],[{ 'Content-Type': 'text/plain' },415]]) {
    assert.equal((await f.post('analyze', request(), headers)).status, status)
  }
  assert.equal((await f.post('analyze', { ...request(), records: [] })).status, 400)
  assert.equal((await f.post('analyze', { data: 'x'.repeat(17_000) })).status, 413)
  assert.equal((await fetch(`${f.origin}/api/mochi-ai/analyze`)).status, 405)
  assert.equal((await fetch(`${f.origin}/unrelated`)).status, 404); assert.equal(f.count(), 0)
})
test('early HTTP rejection closes incomplete uploads without waiting for the remaining body', { timeout: 3000 }, async t => {
  const f = await fixture(t)
  for (const [headers, status] of [
    ['Cookie: spoof\r\nContent-Type: application/json', 401],
    ['Cookie: test=trusted\r\nContent-Type: text/plain', 415],
    ['Cookie: test=trusted\r\nContent-Type: application/json\r\nOrigin: https://evil.test', 403],
  ]) {
    const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(f.origin).port) })
    t.after(() => socket.destroy())
    await once(socket, 'connect')
    let response = ''
    socket.setEncoding('utf8'); socket.on('data', chunk => { response += chunk })
    const closed = once(socket, 'close')
    socket.write(`POST /api/mochi-ai/analyze HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\nContent-Length: 1000\r\n${headers}\r\n\r\n{`)
    let timer
    try {
      await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Rejected upload ${status} remained open`)), 300) })])
    } finally { clearTimeout(timer); socket.destroy() }
    assert.match(response, new RegExp(`^HTTP/1.1 ${status} `))
    assert.match(response, /\r\nconnection: close\r\n/i)
  }
  assert.equal(f.count(), 0)
})
test('HTTP production disabled remains explicit; no mock fallback', async t => {
  const f = await fixture(t, { enabled: false })
  const response = await f.post('analyze', request()); assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'AI_DISABLED'); assert.equal(f.count(), 0)
})
test('missing deployment resolver fails closed even with client identity headers', async t => {
  const f = await fixture(t, {}, { resolveAccess: undefined })
  const response = await f.post('analyze', request(), { 'x-session-id': access.sessionId, 'x-app-id': access.appId, 'x-permissions-verified': 'true' })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'AI_DISABLED'); assert.equal(f.count(), 0)
})
test('client identity cannot authenticate or override trusted project scope', async t => {
  const f = await fixture(t)
  const headers = { cookie: 'spoof', 'x-session-id': access.sessionId, 'x-app-id': access.appId }
  assert.equal((await f.post('analyze', { ...request(), sessionId: access.sessionId, permissionsVerified: true }, headers)).status, 401)
  const foreign = request(); foreign.context.appId = 'other-project'
  const response = await f.post('analyze', foreign, { 'x-app-id': 'other-project' })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'CONTEXT_MISMATCH'); assert.equal(f.count(), 0)
})
test('assembled integration stays disabled by default and cannot bypass a missing resolver', async t => {
  let integration, calls = 0
  const server = createServer((req, res) => integration.handle(req, res))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const origin = `http://127.0.0.1:${server.address().port}`
  const config = { apiKey: 'OFFLINE FIXTURE ONLY', allowedOrigin: origin, approval: grant(Date.now()),
    fetchImpl: async () => { calls++; throw new Error('unexpected upstream request') } }
  integration = createMochiIntegration({ ...config, resolveAccess: () => access })
  const status = await (await fetch(`${origin}/api/mochi-ai/status`)).json()
  assert.equal(status.enabled, false); assert.equal(status.modificationsEnabled, false)
  const post = () => fetch(`${origin}/api/mochi-ai/analyze`, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(request()) })
  assert.equal((await post()).status, 503)
  integration = createMochiIntegration({ ...config, enabled: true })
  const missing = await post()
  assert.equal(missing.status, 503); assert.equal((await missing.json()).error.code, 'AI_DISABLED')
  assert.equal(calls, 0)
})
