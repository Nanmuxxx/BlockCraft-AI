import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { EventEmitter } from 'node:events'
import { createServer as createTcpServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaidGenerationRuntime } from '../../server/paid-gateway/runtime.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { startServer, installShutdownHandlers } from '../../server/index.mjs'

const key = 'offline-lifecycle-key-1234'
const spec = {
  version: 1, id: 'lifecycle-app', name: '生命周期回归',
  entities: [{ id: 'tasks', name: '任务', fields: [{ id: 'title', name: '名称', type: 'text', required: true }] }],
  blocks: [{ id: 'task-list', name: '任务清单', type: 'list', fieldIds: ['title'] }],
  relations: [{ id: 'task-binding', type: 'dataBinding', blockId: 'task-list', entityId: 'tasks' }],
}

async function tempEnvironment(t) {
  const directory = await mkdtemp(join(tmpdir(), 'blockcraft-lifecycle-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { DEEPSEEK_API_KEY: key, DEEPSEEK_BUDGET_LEDGER_PATH: join(directory, 'ledger.json') }
}

test('ordinary start is closed by default and shuts down idempotently', async t => {
  let runtimeFactoryCalls = 0
  const started = await startServer({ port: 0, paidRuntimeFactory: () => { runtimeFactoryCalls++; throw new Error('must remain closed') } })
  t.after(() => started.shutdown())
  const address = started.server.address()
  const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '任务工具' }),
  })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).error.code, 'UNAUTHORIZED')
  assert.equal(runtimeFactoryCalls, 0)
  const first = started.shutdown()
  assert.strictEqual(first, started.shutdown())
  await first
  assert.equal(started.server.listening, false)
})

test('explicit paid runtime keeps the ledger lock until an in-flight request is aborted', async t => {
  const env = await tempEnvironment(t)
  let upstreamStarted
  const upstream = new Promise(resolve => { upstreamStarted = resolve })
  const neverSettlingFetch = async (_url, { signal }) => {
    upstreamStarted()
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'UPSTREAM_CANCELLED' })), { once: true }))
  }
  const paidRuntimeFactory = options => createPaidGenerationRuntime({ ...options, fetchImpl: neverSettlingFetch, timeoutMs: 1000 })
  const started = await startServer({
    port: 0, env, resolveIdentity: () => true, paidRuntimeFactory, drainTimeoutMs: 30,
  })
  t.after(() => started.shutdown().catch(() => {}))
  const address = started.server.address()
  const request = fetch(`http://127.0.0.1:${address.port}/api/ai/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '任务工具' }),
  }).catch(() => null)
  await upstream
  assert.throws(() => openLedger(env.DEEPSEEK_BUDGET_LEDGER_PATH), { code: 'LEDGER_LOCKED' })
  const shutdown = started.shutdown()
  assert.strictEqual(shutdown, started.shutdown())
  await shutdown
  await request
  const reopened = openLedger(env.DEEPSEEK_BUDGET_LEDGER_PATH)
  const snapshot = reopened.snapshot()
  assert.equal(snapshot.halted, true)
  assert.equal(snapshot.entries[0].status, 'uncertain')
  reopened.close()
})

test('explicit paid runtime serves a validated Mock AppSpec and settles before shutdown closes the ledger', async t => {
  const env = await tempEnvironment(t)
  let calls = 0
  const paidRuntimeFactory = options => createPaidGenerationRuntime({
    ...options,
    fetchImpl: async () => {
      calls++
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    },
  })
  const started = await startServer({ port: 0, env, resolveIdentity: () => true, paidRuntimeFactory })
  const response = await fetch(`http://127.0.0.1:${started.server.address().port}/api/ai/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '任务清单' }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), spec)
  assert.equal(calls, 1)
  await started.shutdown()
  const reopened = openLedger(env.DEEPSEEK_BUDGET_LEDGER_PATH)
  assert.equal(reopened.snapshot().entries[0].status, 'settled')
  reopened.close()
})

test('startup failure closes an explicitly opened paid runtime', async t => {
  const env = await tempEnvironment(t)
  const paidRuntimeFactory = options => createPaidGenerationRuntime({ ...options, fetchImpl: async () => { throw new Error('unused') } })
  await assert.rejects(startServer({
    port: 0, env, resolveIdentity: () => true, paidRuntimeFactory,
    appServerFactory: () => { throw new Error('startup failed') },
  }), /startup failed/)
  const reopened = openLedger(env.DEEPSEEK_BUDGET_LEDGER_PATH)
  reopened.close()
})

test('listen failure closes an explicitly opened paid runtime', async t => {
  const env = await tempEnvironment(t)
  const occupied = createTcpServer()
  occupied.listen(0, '127.0.0.1')
  await once(occupied, 'listening')
  t.after(() => new Promise(resolve => occupied.close(resolve)))
  await assert.rejects(startServer({
    port: occupied.address().port, host: '127.0.0.1', env, resolveIdentity: () => true,
    paidRuntimeFactory: options => createPaidGenerationRuntime({ ...options, fetchImpl: async () => { throw new Error('unused') } }),
  }), { code: 'EADDRINUSE' })
  const reopened = openLedger(env.DEEPSEEK_BUDGET_LEDGER_PATH)
  reopened.close()
})

test('SIGINT and SIGTERM hooks invoke one idempotent shutdown task', async () => {
  const signals = new EventEmitter()
  let calls = 0
  const remove = installShutdownHandlers(async () => { calls++ }, signals)
  signals.emit('SIGINT')
  signals.emit('SIGTERM')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  remove()
  signals.emit('SIGINT')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
})
