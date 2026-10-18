import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createMochiHandler } from '../../server/mochi-ai/http.mjs'
import { createMochiService } from '../../server/mochi-ai/service.mjs'
import { createDeepSeekProvider } from '../../server/mochi-ai/provider.mjs'
import { createMochiIntegration } from '../../server/mochi-ai/index.mjs'
import { request, envelope, access, grant } from './fixtures.mjs'
async function fixture(t, options = {}, handlerOptions = {}) {
  let calls = 0
  const provider = createDeepSeekProvider({ apiKey: 'OFFLINE FIXTURE ONLY', fetchImpl: async () => { calls++; return envelope() } })
  const service = createMochiService({ provider, enabled: true, approval: grant(Date.now()), ...options })
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
