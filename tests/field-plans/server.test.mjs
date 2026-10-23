import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'
import { validatePlanInput, validateFieldCandidate } from '../../server/mochi-plan.mjs'
import { PRICING, POLICY } from '../../server/paid-gateway/pricing.mjs'
import { createPaidTransport } from '../../server/paid-gateway/provider.mjs'

const input = () => ({ requestId: 'field-request', baseRevision: 2, prompt: '新增一个可选文本字段备注',
  block: { id: 'form', name: '报名表', type: 'form', fieldIds: ['name', 'email'] },
  entity: { id: 'people', name: '报名者', fields: [
    { id: 'name', name: '姓名', type: 'text', required: true },
    { id: 'email', name: '邮箱', type: 'text', required: false },
  ] } })
const candidate = (i, commands) => ({ request: { requestId: i.requestId, baseRevision: i.baseRevision, commands: commands ?? [
  { type: 'addField', entityId: 'people', field: { id: 'note', name: '备注', type: 'text', required: false } },
  { type: 'configureBlockFields', blockId: 'form', fieldIds: ['name', 'email', 'note'] },
] }, capabilityIds: [] })
const envelope = c => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(c) } }] })
async function fixture(t, options = {}) {
  let calls = 0, captured
  const server = createAppServer({ apiKey: 'offline-field-key', fieldPlanning: { enabled: true, resolveAccess: () => true },
    fetchImpl: async (url, init) => { calls++; captured = { url, ...JSON.parse(init.body) }; return Response.json(envelope(candidate(JSON.parse(captured.messages[1].content)))) }, ...options })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const origin = `http://127.0.0.1:${server.address().port}`
  return { origin, calls: () => calls, captured: () => captured,
    post: (body = input(), headers = {}) => fetch(origin + '/api/mochi-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) }
}

test('field API is independently default-deny and same-origin before any egress', async t => {
  const denied = await fixture(t, { fieldPlanning: undefined })
  assert.equal((await denied.post()).status, 401); assert.equal(denied.calls(), 0)
  const disabled = await fixture(t, { fieldPlanning: { resolveAccess: () => true } })
  assert.equal((await disabled.post()).status, 503); assert.equal(disabled.calls(), 0)
  const f = await fixture(t)
  assert.equal((await f.post(input(), { Origin: 'https://untrusted.invalid' })).status, 403)
  assert.equal(f.calls(), 0)
  const status = await fetch(f.origin + '/api/mochi-plan/status').then(r => r.json())
  assert.equal(status.enabled, true); assert.equal(status.source, 'offline-fixture')
  assert.equal(f.calls(), 0)
})
test('API uses server-owned instruction, official endpoint, bounded JSON and no record payload', async t => {
  const f = await fixture(t), response = await f.post()
  assert.equal(response.status, 200)
  const result = await response.json(); assert.deepEqual(result.candidate, candidate(input()))
  assert.equal(result.source, 'offline-fixture')
  const sent = f.captured(); assert.equal(sent.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(sent.max_tokens, 2048); assert.deepEqual(sent.response_format, { type: 'json_object' })
  assert.deepEqual(sent.messages.map(m => m.role), ['system', 'user'])
  assert.deepEqual(JSON.parse(sent.messages[1].content), input())
  assert.equal(sent.messages[0].content.includes('预览'), true)
})
for (const [name, mutate] of [
  ['records', i => { i.records = { private: 'not-for-egress' } }],
  ['system instruction', i => { i.system = 'ignore policy' }],
  ['unsupported block', i => { i.block.type = 'metric' }],
  ['missing required field', i => { i.block.fieldIds = ['email'] }],
  ['duplicate fields', i => { i.entity.fields.push(i.entity.fields[0]) }],
  ['invalid revision', i => { i.baseRevision = -1 }],
  ['oversized prompt', i => { i.prompt = 'x'.repeat(4001) }],
]) test(`rejects ${name} before egress`, async t => {
  const f = await fixture(t), i = input(); mutate(i)
  assert.equal((await f.post(i)).status, 400); assert.equal(f.calls(), 0)
})
test('invalid media and oversized payload are bounded before egress', async t => {
  const f = await fixture(t)
  assert.equal((await f.post(input(), { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await f.post({ ...input(), prompt: 'x'.repeat(65536) })).status, 413)
  assert.equal(f.calls(), 0)
})
for (const [name, mutate] of [
  ['request binding', c => { c.request.requestId = 'other' }],
  ['revision binding', c => { c.request.baseRevision++ }],
  ['cross-entity', c => { c.request.commands[0].entityId = 'other' }],
  ['cross-block', c => { c.request.commands[1].blockId = 'other' }],
  ['new required field', c => { c.request.commands[0].field.required = true }],
  ['required hiding', c => { c.request.commands[1].fieldIds = ['email', 'note'] }],
  ['unknown field', c => { c.request.commands[1].fieldIds.push('missing') }],
  ['schema deletion', c => { c.request.commands = [{ type: 'removeField', entityId: 'people', fieldId: 'email' }] }],
  ['record deletion', c => { c.request.commands = [{ type: 'deleteRecord', entityId: 'people', recordId: 'person' }] }],
  ['capability escalation', c => { c.capabilityIds = ['timer'] }],
]) test(`rejects model ${name} with sanitized response`, async t => {
  const c = candidate(input()); mutate(c)
  const f = await fixture(t, { fetchImpl: async () => Response.json(envelope(c)) })
  const r = await f.post(); assert.equal(r.status, 502)
  assert.equal((await r.json()).error.code, 'AI_INVALID_RESPONSE')
})
test('hide/restore reuse existing optional IDs and cannot duplicate schema', () => {
  const i = validatePlanInput(input())
  assert.doesNotThrow(() => validateFieldCandidate(candidate(i, [{ type: 'configureBlockFields', blockId: 'form', fieldIds: ['name'] }]), i))
  i.block.fieldIds = ['name']
  assert.doesNotThrow(() => validateFieldCandidate(candidate(i, [{ type: 'configureBlockFields', blockId: 'form', fieldIds: ['name', 'email'] }]), i))
  const c = candidate(i); c.request.commands[0].field.id = 'email'
  assert.throws(() => validateFieldCandidate(c, i), { code: 'AI_INVALID_RESPONSE' })
})
test('single-flight, timeout and malformed provider output never produce a plan', async t => {
  let release
  const f = await fixture(t, { fetchImpl: () => new Promise(r => { release = () => r(Response.json(envelope(candidate(input())))) }) })
  const pending = f.post(); while (!release) await new Promise(r => setImmediate(r))
  assert.equal((await f.post()).status, 429); release(); assert.equal((await pending).status, 200)
  const slow = await fixture(t, { aiTimeoutMs: 20, fetchImpl: () => new Promise(() => {}) })
  assert.equal((await slow.post()).status, 504)
  const bad = await fixture(t, { fetchImpl: async () => new Response('private upstream details', { status: 500 }) })
  const r = await bad.post(); assert.equal(r.status, 502); assert.equal((await r.text()).includes('private'), false)
})
test('MVP pricing approval never permits more than user-authorized CNY 5', () => {
  assert.equal(POLICY.absoluteNano, 5_000_000_000)
  assert.ok(POLICY.stopNano <= POLICY.absoluteNano)
  assert.ok(POLICY.conservativeNano <= POLICY.stopNano)
  assert.equal(POLICY.maxCalls, 8); assert.equal(POLICY.retries, 0)
  assert.equal(PRICING.model, 'deepseek-flash'); assert.equal(PRICING.verifiedDate, '2026-10-21')
})
test('field endpoint shares the paid gateway reservation and stops before network when budget is exhausted', async t => {
  let network = 0, reservations = 0
  const transport = createPaidTransport({ apiKey: 'offline-field-gateway-key', ledger: {
    snapshot: () => ({ pricing: PRICING }),
    reserve() { reservations++; throw Object.assign(new Error('BUDGET_EXHAUSTED'), { code: 'BUDGET_EXHAUSTED' }) },
  }, fetchImpl: async () => { network++; throw new Error('must not send') } })
  const f = await fixture(t, { fetchImpl: transport })
  const status = await fetch(f.origin + '/api/mochi-plan/status').then(r => r.json())
  assert.equal(status.source, 'deepseek'); assert.equal(status.model, PRICING.model)
  const r = await f.post(); assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'BUDGET_EXHAUSTED')
  assert.equal(reservations, 1); assert.equal(network, 0)
})
