import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaidGenerationRuntime } from '../../server/paid-gateway/runtime.mjs'
import { PRICING, SMOKE_POLICY } from '../../server/paid-gateway/pricing.mjs'

const key = 'offline-runtime-key-never-real'
const endpoint = 'https://api.deepseek.com/chat/completions'
const spec = { version: 1, id: 'tasks', name: 'Tasks', entities: [], blocks: [], relations: [] }

function tempConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'blockcraft-paid-runtime-'))
  chmodSync(dir, 0o700)
  return { dir, env: { DEEPSEEK_API_KEY: key, DEEPSEEK_BUDGET_LEDGER_PATH: join(dir, 'ledger.json') } }
}

test('isolated smoke composition requires a synthetic key and an absolute ledger path', () => {
  const { env } = tempConfig()
  assert.throws(() => createPaidGenerationRuntime({ env: { ...env, DEEPSEEK_API_KEY: '' } }), { code: 'API_CONFIGURATION' })
  assert.throws(() => createPaidGenerationRuntime({ env: { DEEPSEEK_API_KEY: key } }), { code: 'LEDGER_PATH_REQUIRED' })
  assert.throws(() => createPaidGenerationRuntime({ env: { ...env, DEEPSEEK_BUDGET_LEDGER_PATH: 'ledger.json' } }), { code: 'LEDGER_PATH_REQUIRED' })
})

test('smoke transport uses the local-smoke profile and enforces the configured output bound', async t => {
  const { env } = tempConfig()
  let upstreamCalls = 0
  const runtime = createPaidGenerationRuntime({
    env,
    fetchImpl: async (_url, init) => {
      upstreamCalls++
      assert.equal(JSON.parse(init.body).model, PRICING.model)
      return Response.json({
        model: PRICING.model,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      })
    },
  })
  t.after(() => runtime.close())
  assert.equal(runtime.policy, SMOKE_POLICY)
  assert.equal(runtime.ledger.snapshot().profile, 'local-smoke')

  const request = max_tokens => ({ method: 'POST', body: JSON.stringify({
    model: PRICING.model,
    messages: [{ role: 'system', content: 'JSON' }, { role: 'user', content: 'task list' }],
    stream: false,
    response_format: { type: 'json_object' },
    max_tokens,
  }) })
  await assert.rejects(runtime.fetch(endpoint, request(SMOKE_POLICY.maxOutputTokens + 1)), { code: 'REQUEST_INVALID' })
  assert.equal(upstreamCalls, 0)
  const response = await runtime.fetch(endpoint, request(SMOKE_POLICY.maxOutputTokens))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    model: PRICING.model,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  })
  assert.equal(upstreamCalls, 1)
  assert.equal(runtime.ledger.snapshot().entries[0].status, 'settled')
})

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt - 1 }))
