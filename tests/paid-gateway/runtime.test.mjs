import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'
import { createPaidGenerationRuntime } from '../../server/paid-gateway/runtime.mjs'
import { PRICING } from '../../server/paid-gateway/pricing.mjs'

const key = 'offline-runtime-key-never-real'
const spec = { version: 1, id: 'tasks', name: 'Tasks', entities: [{ id: 'items', name: 'Items', fields: [{ id: 'title', name: 'Title', type: 'text', required: true }] }], blocks: [{ id: 'list', name: 'List', type: 'list', fieldIds: ['title'] }], relations: [{ id: 'binding', type: 'dataBinding', blockId: 'list', entityId: 'items' }] }

function tempConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'blockcraft-paid-runtime-'))
  chmodSync(dir, 0o700)
  return { dir, env: { DEEPSEEK_API_KEY: key, DEEPSEEK_BUDGET_LEDGER_PATH: join(dir, 'ledger.json') } }
}

test('production composition requires trusted identity, key and persistent ledger path', () => {
  const { env } = tempConfig()
  assert.throws(() => createPaidGenerationRuntime({ env }), { code: 'IDENTITY_ADAPTER_REQUIRED' })
  assert.throws(() => createPaidGenerationRuntime({ env: { ...env, DEEPSEEK_API_KEY: '' }, resolveIdentity: () => true }), { code: 'API_CONFIGURATION' })
  assert.throws(() => createPaidGenerationRuntime({ env: { DEEPSEEK_API_KEY: key }, resolveIdentity: () => true }), { code: 'LEDGER_PATH_REQUIRED' })
  assert.throws(() => createPaidGenerationRuntime({ env: { ...env, DEEPSEEK_BUDGET_LEDGER_PATH: 'ledger.json' }, resolveIdentity: () => true }), { code: 'LEDGER_PATH_REQUIRED' })
})

test('composed app server authenticates before a mock DeepSeek call and persists bounded audit', async t => {
  const { dir, env } = tempConfig()
  let upstreamCalls = 0
  const runtime = createPaidGenerationRuntime({
    env,
    resolveIdentity: req => req.headers.authorization === 'Bearer trusted-session',
    fetchImpl: async (_url, init) => {
      upstreamCalls++
      const body = JSON.parse(init.body)
      assert.equal(body.model, PRICING.model)
      assert.equal(body.max_tokens, 8192)
      return Response.json({
        model: PRICING.model,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      })
    },
  })
  t.after(() => runtime.close())
  const server = createAppServer({ ...runtime.appServerOptions, staticDir: dir })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = `http://127.0.0.1:${server.address().port}/api/ai/generate`
  const body = JSON.stringify({ idea: 'A task list' })
  const anonymous = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  assert.equal(anonymous.status, 401)
  assert.equal(upstreamCalls, 0)
  const authorized = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer trusted-session' }, body })
  assert.equal(authorized.status, 200)
  assert.deepEqual(await authorized.json(), spec)
  assert.equal(upstreamCalls, 1)
  runtime.close()
  const ledger = JSON.parse(readFileSync(env.DEEPSEEK_BUDGET_LEDGER_PATH, 'utf8'))
  assert.equal(ledger.entries.length, 1)
  assert.equal(ledger.entries[0].status, 'settled')
  assert.ok(!JSON.stringify(ledger).includes(key))
})