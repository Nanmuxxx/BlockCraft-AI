import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'
import { buildInteractiveMessages } from '../../server/trusted-interactive.mjs'
const fixture = JSON.parse(readFileSync(new URL('./pomodoro.json', import.meta.url)))
const idea = '做一个 25 分钟的数学专注番茄钟'
export function offlineOptions(origin, overrides = {}) {
  return { enabled: true, approval: { providerVerified: true, permissionsVerified: true, reference: 'OFFLINE-TEST-ONLY', maxCalls: 40, expiresAt: Date.now() + 600000 }, allowedOrigin: origin,
    resolveAccess: async () => ({ sessionId: 'offline-session', appId: 'offline-app', readOnly: false }), reserveBudget: async () => true, ...overrides }
}
async function harness(t, interactive, fetchImpl) {
  const server = createAppServer({ generationAccess: () => true, apiKey: 'offline-test-key', model: 'offline-fixture-model', fetchImpl, interactive })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/api/ai/generate`
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return async (body = { idea, protocol: 'trusted-interactive/1' }, origin) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
}
const output = spec => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec) } }] })
test('real provider HTTP request shape is reused, paid fetch replaced by fixture, both ends validated', async t => {
  let calls = 0, reservation
  const request = await harness(t, offlineOptions('http://offline.test', { reserveBudget: async value => { reservation = value; return true } }), async (url, options) => {
    calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions')
    const body = JSON.parse(options.body)
    assert.deepEqual(body.messages, buildInteractiveMessages(idea))
    assert.equal(body.response_format.type, 'json_object'); assert.equal(body.stream, false)
    assert.equal(body.model, 'offline-fixture-model')
    return output(fixture)
  })
  const result = await request()
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.spec, fixture)
  assert.deepEqual(result.body.provenance, { source: 'offline-fixture', model: 'offline-fixture-model' })
  assert.equal(calls, 1); assert.ok(reservation.maxTokens > 8192)
  assert.equal(reservation.approvalReference, 'OFFLINE-TEST-ONLY')
})
test('all authorization and budget gates reject before upstream; no body can grant approval', async t => {
  for (const options of [undefined, offlineOptions('http://offline.test', { enabled: false }), offlineOptions('http://offline.test', { approval: {} }),
    offlineOptions('http://offline.test', { resolveAccess: async () => null }), offlineOptions('http://offline.test', { resolveAccess: async () => ({ sessionId: 's', appId: 'a', readOnly: true }) }),
    offlineOptions('http://offline.test', { reserveBudget: undefined }), offlineOptions('http://offline.test', { reserveBudget: async () => false }),
    offlineOptions('http://offline.test', { reserveBudget: async () => { throw new Error('ledger unavailable') } }), offlineOptions('http://offline.test', { approval: { expiresAt: 1 } }),
  ]) {
    let calls = 0
    const request = await harness(t, options, async () => { calls++; return output(fixture) })
    assert.notEqual((await request()).status, 200); assert.equal(calls, 0)
    assert.equal((await request({ idea, protocol: 'trusted-interactive/1', approval: true })).status, 400)
    assert.equal(calls, 0)
  }
})
test('approved call cap and origin remain enforced', async t => {
  let calls = 0
  const options = offlineOptions('http://offline.test'); options.approval.maxCalls = 1
  const request = await harness(t, options, async () => { calls++; return output(fixture) })
  assert.equal((await request(undefined, 'http://evil.test')).status, 403)
  assert.equal((await request()).status, 200)
  assert.equal((await request()).status, 429)
  assert.equal(calls, 1)
})
test('malformed, incompatible and executable model outputs fail closed; legacy route cannot admit v2', async t => {
  let candidate = structuredClone(fixture)
  const request = await harness(t, offlineOptions('http://offline.test'), async () => output(candidate))
  for (const mutate of [s => { s.blocks[0].durationSeconds = 99999 }, s => { s.blocks[0].code = 'alert(1)' }, s => { s.version = 1 }, s => { s.blocks = [] }, s => { s.blocks[0].protocolVersion = 2 }]) {
    candidate = structuredClone(fixture); mutate(candidate)
    const result = await request(); assert.equal(result.status, 502); assert.equal(result.body.error.code, 'AI_INVALID_SPEC')
  }
  candidate = fixture
  assert.equal((await request({ idea })).body.error.code, 'AI_INVALID_SPEC')
})
test('provider errors, truncated completion and invalid JSON never become successful configurations', async t => {
  for (const [response, code] of [
    [() => new Response('unavailable', { status: 503 }), 'AI_UNAVAILABLE'],
    [() => Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(fixture) } }] }), 'AI_INVALID_RESPONSE'],
    [() => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"version":2,' } }] }), 'AI_INVALID_SPEC'],
    [() => Response.json({ choices: [] }), 'AI_INVALID_RESPONSE'],
  ]) {
    let calls = 0
    const request = await harness(t, offlineOptions('http://offline.test'), async () => { calls++; return response() })
    const result = await request()
    assert.equal(result.status, 502); assert.equal(result.body.error.code, code); assert.equal(calls, 1)
    assert.equal(result.body.spec, undefined)
    for (const body of [{ idea, protocol: 'trusted-interactive/2' }, { idea, protocol: 'trusted-interactive/1', permissions: ['execute'] }]) {
      assert.equal((await request(body)).status, 400); assert.equal(calls, 1)
    }
  }
})
