// Offline integration only: no credentials, native egress, TSX build or execution.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'
import { createDeepSeekProvider as custom } from '../../server/custom-block/provider.mjs'
import { createDeepSeekProvider as mochi } from '../../server/mochi-ai/provider.mjs'
import { createPaidTransport } from '../../server/paid-gateway/provider.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { PRICING, POLICY } from '../../server/paid-gateway/pricing.mjs'
import { request as customRequest } from '../custom-block-generation/fixtures.mjs'
import { request as mochiRequest, advice } from '../mochi-ai/fixtures.mjs'

const key = 'offline-model-contract-key'
function modelEnvironment(t, value) {
  const previous = process.env.DEEPSEEK_MODEL
  if (value === undefined) delete process.env.DEEPSEEK_MODEL
  else process.env.DEEPSEEK_MODEL = value
  t.after(() => { if (previous === undefined) delete process.env.DEEPSEEK_MODEL; else process.env.DEEPSEEK_MODEL = previous })
}
const spec = { version: 1, id: 'tasks', name: '任务', entities: [{ id: 'items', name: '任务', fields: [{ id: 'title', name: '名称', type: 'text', required: true }] }], blocks: [{ id: 'list', name: '清单', type: 'list', fieldIds: ['title'] }], relations: [{ id: 'binding', type: 'dataBinding', blockId: 'list', entityId: 'items' }] }
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'blockcraft-model-contract-')); chmodSync(dir, 0o700)
  const ledger = openLedger(join(dir, 'ledger.json')); t.after(() => ledger.close())
  let calls = 0, content = spec
  const transport = createPaidTransport({ apiKey: key, ledger, fetchImpl: async (_url, init) => {
    calls++; const body = JSON.parse(init.body)
    assert.equal(body.model, PRICING.model); assert.equal(body.thinking.type, 'disabled')
    assert.equal(init.redirect, 'error'); assert.ok(body.max_tokens <= POLICY.maxOutputTokens)
    assert.equal(ledger.snapshot().entries.length, calls) // reserve before network
    return Response.json({ model: PRICING.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })
  } })
  return { ledger, transport, calls: () => calls, reply: value => { content = value } }
}
async function post(t, options) {
  const s = createAppServer({ apiKey: key, generationAccess: () => true, ...options })
  s.listen(0, '127.0.0.1'); await once(s, 'listening')
  t.after(() => new Promise(resolve => { s.closeAllConnections(); s.close(resolve) }))
  return fetch(`http://127.0.0.1:${s.address().port}/api/ai/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '任务清单' }) })
}

test('legacy model names fail before reservation/network in all three consumers; no alias rewriting', async t => {
  const f = await setup(t)
  for (const model of ['deepseek-v4-flash', 'deepseek-chat']) {
    const r = await post(t, { model, fetchImpl: f.transport }); assert.equal(r.status, 502); await r.json()
    await assert.rejects(custom({ allowPaid: true, apiKey: key, model, fetchImpl: f.transport }).generate(customRequest()))
    await assert.rejects(mochi({ apiKey: key, model, fetchImpl: f.transport }).analyze(mochiRequest()))
  }
  assert.equal(f.calls(), 0); assert.equal(f.ledger.snapshot().entries.length, 0)
})

test('explicit priced model composes entry/Mochi/CustomBlock with one shared audited call ceiling', async t => {
  const f = await setup(t), options = { apiKey: key, model: PRICING.model, fetchImpl: f.transport }
  const r = await post(t, options); assert.equal(r.status, 200); assert.deepEqual(await r.json(), spec)
  f.reply(advice()); assert.deepEqual(await mochi(options).analyze(mochiRequest()), advice())
  // Provider returns inert text only; no generated source is compiled or run.
  f.reply({ mock: 'inert provider contract response' })
  const provider = custom({ ...options, allowPaid: true })
  for (let i = 2; i < POLICY.maxCalls; i++) assert.equal(await provider.generate(customRequest()), JSON.stringify({ mock: 'inert provider contract response' }))
  assert.equal(f.calls(), POLICY.maxCalls)
  await assert.rejects(provider.generate(customRequest()))
  assert.equal(f.calls(), POLICY.maxCalls); assert.equal(f.ledger.snapshot().entries.length, POLICY.maxCalls)
  assert.ok(f.ledger.snapshot().entries.every(e => e.status === 'settled'))
})

test('branded paid transport selects the priced default in all three consumers without a model override', async t => {
  modelEnvironment(t, undefined)
  const f = await setup(t), options = { apiKey: key, fetchImpl: f.transport }
  const r = await post(t, options); assert.equal(r.status, 200); assert.deepEqual(await r.json(), spec)
  f.reply(advice()); const m = mochi(options); assert.equal(m.model, PRICING.model)
  assert.deepEqual(await m.analyze(mochiRequest()), advice())
  f.reply({ mock: 'inert' })
  assert.equal(await custom({ ...options, allowPaid: true }).generate(customRequest()), '{"mock":"inert"}')
  assert.equal(f.calls(), 3); assert.equal(f.ledger.snapshot().entries.length, 3)
  assert.ok(f.ledger.snapshot().entries.every(e => e.status === 'settled'))
})

test('explicit invalid environment or constructor model never falls back for a paid transport', async t => {
  modelEnvironment(t, 'unapproved-model')
  const f = await setup(t), options = { apiKey: key, fetchImpl: f.transport }
  const r = await post(t, options); assert.equal(r.status, 502); await r.json()
  assert.equal(mochi(options).model, 'unapproved-model')
  await assert.rejects(mochi(options).analyze(mochiRequest()))
  for (const model of ['unapproved-model', 'deepseek-v4-flash', 'deepseek-chat']) {
    const r = await post(t, { ...options, model }); assert.equal(r.status, 502); await r.json()
    await assert.rejects(mochi({ ...options, model }).analyze(mochiRequest()))
    if (model === 'unapproved-model') assert.throws(() => custom({ ...options, allowPaid: true, model }), { code: 'API_CONFIGURATION' })
    else await assert.rejects(custom({ ...options, allowPaid: true, model }).generate(customRequest()))
  }
  assert.equal(f.calls(), 0); assert.equal(f.ledger.snapshot().entries.length, 0)
})

test('ordinary injected offline adapters keep the historical default in all consumers', async t => {
  modelEnvironment(t, undefined)
  let calls = 0, content = spec
  const options = { apiKey: key, fetchImpl: async (_url, init) => {
    calls++; assert.equal(JSON.parse(init.body).model, 'deepseek-v4-flash')
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }] })
  } }
  const r = await post(t, options); assert.equal(r.status, 200); await r.json()
  content = advice(); assert.deepEqual(await mochi(options).analyze(mochiRequest()), advice())
  content = { mock: 'inert' }; assert.equal(await custom({ ...options, allowPaid: true }).generate(customRequest()), '{"mock":"inert"}')
  assert.equal(calls, 3)
})
