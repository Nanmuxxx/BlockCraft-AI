import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { createServer as createTcpServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPaidGenerationRuntime } from '../../server/paid-gateway/runtime.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { startServer, installShutdownHandlers } from '../../server/index.mjs'

const key = 'offline-lifecycle-key-1234'
const nativeNow = Date.now.bind(Date)
// Only historical Mock settlement paths use this clock. Production policy is unchanged.
beforeEach(t => {
  if (t.name === 'native-clock expired pricing denies before model egress') return
  const start = performance.now()
  t.mock.method(Date, 'now', () => Date.parse('2026-10-19T12:00:00Z') + performance.now() - start)
})
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

test('key and ledger configuration cannot activate generation without trusted identity', async t => {
  const configured = await tempEnvironment(t)
  for (const env of [{ DEEPSEEK_API_KEY: key }, configured]) {
    let runtimeCalls = 0
    const started = await startServer({
      port: 0, env,
      paidRuntimeFactory: () => { runtimeCalls++; throw new Error('must remain closed') },
    })
    try {
      const response = await fetch(`http://127.0.0.1:${started.server.address().port}/api/ai/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '健身训练记录' }),
      })
      assert.equal(response.status, 401)
      const body = await response.text()
      assert.equal(JSON.parse(body).error.code, 'UNAUTHORIZED')
      assert.equal(body.includes(key), false)
      assert.equal(runtimeCalls, 0)
    } finally { await started.shutdown() }
  }
  // No runtime construction means no budget reservation or model transport.
  const ledger = openLedger(configured.DEEPSEEK_BUDGET_LEDGER_PATH)
  assert.equal(ledger.snapshot().entries.length, 0)
  ledger.close()
})

test('explicit paid runtime keeps the ledger lock until an in-flight request is aborted', { timeout: 5000 }, async t => {
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

test('real process signals do not interrupt request drain or release the ledger early', { timeout: 10000, skip: process.platform === 'win32' ? 'Requires POSIX signal delivery' : false }, async t => {
  const env = await tempEnvironment(t)
  const moduleUrl = new URL('../../server/index.mjs', import.meta.url).href
  const runtimeUrl = new URL('../../server/paid-gateway/runtime.mjs', import.meta.url).href
  const childSource = `
    import { startServer, installShutdownHandlers } from ${JSON.stringify(moduleUrl)}
    import { createPaidGenerationRuntime } from ${JSON.stringify(runtimeUrl)}
    const testClockStart = performance.now()
    Date.now = () => Date.parse('2026-10-19T12:00:00Z') + performance.now() - testClockStart
    const started = await startServer({
      port: 0,
      env: process.env,
      resolveIdentity: () => true,
      drainTimeoutMs: 800,
      paidRuntimeFactory: options => createPaidGenerationRuntime({
        ...options,
        timeoutMs: 5000,
        fetchImpl: async (_url, { signal }) => {
          console.log('UPSTREAM_STARTED')
          return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'UPSTREAM_CANCELLED' })), { once: true }))
        },
      }),
    })
    console.log('READY:' + started.server.address().port)
    installShutdownHandlers(async () => {
      console.log('DRAIN_STARTED')
      await started.shutdown()
      console.log('DRAIN_COMPLETED')
    })
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', childSource], {
    env: { PATH: process.env.PATH, NODE_ENV: 'test', DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY, DEEPSEEK_BUDGET_LEDGER_PATH: env.DEEPSEEK_BUDGET_LEDGER_PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(child, 'close')
  let output = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const waitForOutput = async marker => {
    const deadline = Date.now() + 5000
    while (!output.includes(marker)) {
      if (child.exitCode !== null || child.signalCode) throw new Error(`Child exited before ${marker}: ${output}\n${stderr}`)
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${marker}: ${output}\n${stderr}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited.catch(() => {})
  })

  await waitForOutput('READY:')
  const port = Number(output.match(/READY:(\d+)/)?.[1])
  assert.ok(Number.isInteger(port) && port > 0)
  const request = fetch(`http://127.0.0.1:${port}/api/ai/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '任务工具' }),
  }).catch(() => null)
  await waitForOutput('UPSTREAM_STARTED')
  assert.throws(() => openLedger(env.DEEPSEEK_BUDGET_LEDGER_PATH), { code: 'LEDGER_LOCKED' })

  child.kill('SIGTERM')
  await waitForOutput('DRAIN_STARTED')
  child.kill('SIGINT')
  child.kill('SIGTERM')
  let lockChecks = 0
  const lockDeadline = Date.now() + 400
  while (Date.now() < lockDeadline) {
    assert.equal(child.signalCode, null, `Premature signal exit: ${output}`)
    assert.equal(output.includes('DRAIN_COMPLETED'), false)
    assert.throws(() => openLedger(env.DEEPSEEK_BUDGET_LEDGER_PATH), { code: 'LEDGER_LOCKED' })
    lockChecks++
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.ok(lockChecks >= 2)
  await waitForOutput('DRAIN_COMPLETED')
  const [exitCode, exitSignal] = await exited
  await request
  assert.equal(exitCode, 0, stderr)
  assert.equal(exitSignal, null)
  assert.equal(output.match(/DRAIN_STARTED/g)?.length, 1)
  assert.equal(output.match(/DRAIN_COMPLETED/g)?.length, 1)

  const reopened = openLedger(env.DEEPSEEK_BUDGET_LEDGER_PATH)
  const snapshot = reopened.snapshot()
  assert.equal(snapshot.halted, true)
  assert.equal(snapshot.entries[0].status, 'uncertain')
  reopened.close()

  const releasedPort = createTcpServer()
  releasedPort.listen(port, '127.0.0.1')
  await once(releasedPort, 'listening')
  await new Promise(resolve => releasedPort.close(resolve))
})

test('native-clock expired pricing denies before model egress', async t => {
  assert.equal(Date.now(), nativeNow())
  const env = await tempEnvironment(t)
  let calls = 0
  const started = await startServer({ port: 0, env, resolveIdentity: () => true, paidRuntimeFactory: options => createPaidGenerationRuntime({ ...options, fetchImpl: async () => { calls++; throw new Error('must not egress') } }) })
  t.after(() => started.shutdown())
  const response = await fetch(`http://127.0.0.1:${started.server.address().port}/api/ai/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '任务工具' }) })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, 'PRICING_EXPIRED')
  assert.equal(calls, 0)
  await started.shutdown()
  const ledger = openLedger(env.DEEPSEEK_BUDGET_LEDGER_PATH)
  assert.equal(ledger.snapshot().entries.length, 0)
  ledger.close()
})
