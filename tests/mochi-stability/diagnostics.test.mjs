import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createDeepSeekProvider } from '../../server/mochi-ai/provider.mjs'
import { createMochiPlanHandler } from '../../server/mochi-plan.mjs'
import { invalidResponse, reportModelFailure } from '../../server/mochi-response.mjs'
import { request, advice } from '../mochi-ai/fixtures.mjs'

const secret = 'PRIVATE_BUSINESS_OR_CREDENTIAL_SENTINEL'
const wrap = (content, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { role: 'assistant', content } }] })
const input = () => ({ requestId: 'diagnostic-request', baseRevision: 0, prompt: '只给表单增加一个可选文本字段备注',
  block: { id: 'form', name: '表单', type: 'form', fieldIds: ['name', 'email'] },
  entity: { id: 'people', name: '人员', fields: [
    { id: 'name', name: '姓名', type: 'text', required: true }, { id: 'email', name: '邮箱', type: 'text', required: false },
  ] } })
const candidate = () => ({ request: { requestId: input().requestId, baseRevision: 0, commands: [
  { type: 'addField', entityId: 'people', field: { id: 'note', name: '备注', type: 'text', required: false } },
  { type: 'configureBlockFields', blockId: 'form', fieldIds: ['name', 'email', 'note'] },
] }, capabilityIds: [] })

for (const [name, response, stage, reason, finish] of [
  ['outer JSON', () => new Response(secret), 'body', 'json', 'unavailable'],
  ['UTF8', () => new Response(new Uint8Array([0xc3, 0x28])), 'body', 'encoding', 'unavailable'],
  ['truncated', () => Response.json(wrap('{'+secret, 'length')), 'envelope', 'finish', 'length'],
  ['inner JSON', () => Response.json(wrap(secret)), 'content', 'json', 'stop'],
  ['unknown key', () => Response.json(wrap(JSON.stringify({ ...advice(), [secret]: secret }))), 'advice', 'shape', 'stop'],
  ['unknown reference', () => { const a = advice(); a.suggestions[0].blockId = secret; return Response.json(wrap(JSON.stringify(a))) }, 'advice', 'reference', 'stop'],
  ['illegal action', () => { const a = advice(); a.suggestions[0].requiresUserAction = false; return Response.json(wrap(JSON.stringify(a))) }, 'advice', 'action', 'stop'],
  ['untrusted finish', () => Response.json(wrap(secret, secret)), 'envelope', 'finish', 'unknown'],
]) test(`advice diagnostic: ${name}; safe enums and exactly one transport call`, async () => {
  let calls = 0; const events = []
  const provider = createDeepSeekProvider({ apiKey: secret, fetchImpl: async () => { calls++; return response() }, onDiagnostic: event => events.push(event) })
  await assert.rejects(provider.analyze(request()), { code: 'AI_INVALID_RESPONSE' })
  assert.equal(calls, 1)
  assert.deepEqual(events, [{ event: 'mochi_model_rejected', channel: 'advice', stage, reason, finishReason: finish }])
  assert.equal(JSON.stringify(events).includes(secret), false)
})

test('diagnostic sink failure cannot alter safe rejection; arbitrary metadata is dropped', () => {
  const events = []
  reportModelFailure('plan', { diagnostic: { stage: secret, reason: secret, finishReason: secret, body: secret } }, e => events.push(e))
  assert.deepEqual(events[0], { event: 'mochi_model_rejected', channel: 'plan', stage: 'envelope', reason: 'schema', finishReason: 'unknown' })
  assert.doesNotThrow(() => reportModelFailure('plan', invalidResponse('content', 'json', 'stop'), () => { throw Error(secret) }))
})

async function planFixture(t, output, resolveRequest) {
  let calls = 0; const events = []
  const handler = createMochiPlanHandler({ enabled: true, resolveAccess: () => true, apiKey: secret, resolveRequest,
    fetchImpl: async () => { calls++; return output() }, onDiagnostic: e => events.push(e) })
  const server = createServer((req, res) => void handler(req, res)); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  return { events, calls: () => calls, post: async (i = input()) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/mochi-plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(i) })
    const body = await response.json(); assert.equal(JSON.stringify(body).includes(secret), false)
    return { status: response.status, body }
  } }
}
for (const [name, mutate, reason] of [
  ['unknown field', c => { c.request.commands[0].field[secret] = secret }, 'command_schema'],
  ['foreign block', c => { c.request.commands[1].blockId = 'foreign' }, 'command_constraints'],
  ['required field', c => { c.request.commands[0].field.required = true }, 'command_constraints'],
  ['record write', c => { c.request.commands = [{ type: 'deleteRecord', recordId: secret }] }, 'command_schema'],
  ['stale model binding', c => { c.request.baseRevision++ }, 'binding'],
]) test(`plan diagnostic: ${name} rejects without returning plan`, async t => {
  const c = candidate(); mutate(c)
  const f = await planFixture(t, () => Response.json(wrap(JSON.stringify(c))))
  const result = await f.post(); assert.equal(result.status, 502); assert.equal(result.body.error.code, 'AI_INVALID_RESPONSE')
  assert.equal(f.calls(), 1); assert.equal(f.events[0].reason, reason)
  assert.deepEqual(Object.keys(f.events[0]).sort(), ['channel', 'event', 'finishReason', 'reason', 'stage'])
})
test('plan truncation has finish reason; ambiguous intent makes zero reservation/egress', async t => {
  const f = await planFixture(t, () => Response.json(wrap(secret, 'length')))
  assert.equal((await f.post()).body.error.code, 'AI_INVALID_RESPONSE'); assert.equal(f.events[0].finishReason, 'length')
  let reservations = 0
  const ambiguous = await planFixture(t, () => { throw Error('no egress') }, () => { reservations++; throw Error('no reservation') })
  assert.equal((await ambiguous.post({ ...input(), prompt: '完善一下' })).body.error.code, 'INTENT_CLARIFICATION_REQUIRED')
  assert.equal(ambiguous.calls(), 0); assert.equal(reservations, 0)
})
test('model widening hides an old optional field: separate scope rejection', async t => {
  const c = candidate(); c.request.commands[1].fieldIds = ['name', 'note']
  const f = await planFixture(t, () => Response.json(wrap(JSON.stringify(c))))
  const r = await f.post(); assert.equal(r.status, 422); assert.equal(r.body.error.code, 'INTENT_SCOPE_VIOLATION')
  assert.equal(f.events[0].reason, 'intent')
})

test('plan outer JSON and UTF8 failures are distinguished from interrupted body transport', async t => {
  for (const [output, code, reason] of [
    [() => new Response(secret), 'AI_INVALID_RESPONSE', 'json'],
    [() => new Response(new Uint8Array([0xc3, 0x28])), 'AI_INVALID_RESPONSE', 'encoding'],
    [() => new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)) } })), 'AI_UNAVAILABLE', null],
  ]) {
    const f = await planFixture(t, output)
    const result = await f.post()
    assert.equal(result.status, 502); assert.equal(result.body.error.code, code); assert.equal(f.calls(), 1)
    if (reason) assert.deepEqual(f.events, [{ event: 'mochi_model_rejected', channel: 'plan', stage: 'body', reason, finishReason: 'unavailable' }])
    else assert.deepEqual(f.events, [])
  }
})
