import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompiler } from '../../server/safe-viewer/compile.mjs'
import { createFixtures } from './fixtures.mjs'

const fixtures = await createFixtures()

function artifactOf(name, source) {
  const fixture = structuredClone(fixtures[name])
  if (source !== undefined) fixture.artifact.sources[fixture.artifact.manifest.entry] = source
  return { ...fixture.artifact, versionDigest: fixture.instance.versionDigest }
}

function busySource() {
  const spans = Array.from({ length: 1_350 }, (_, index) => `<span data-i="${index}">{value+${index}}</span>`).join('')
  return `import { useState } from 'react'
export default function Heavy() {
  const [value] = useState(0)
  const nested = ${'('.repeat(7_000)}1${')'.repeat(7_000)}
  return <div>{nested}${spans}</div>
}`
}

function eventOf(events, type) {
  return events.find(event => event.type === type)
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

async function waitForProcessGone(pid, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (processAlive(pid) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.equal(processAlive(pid), false, `process ${pid} must be gone`)
}

test('successful compile closes both the compile process and its esbuild service process', { timeout: 10_000 }, async t => {
  const events = []
  const compiler = createCompiler({ processObserver: event => events.push(event) })
  t.after(() => compiler.dispose())
  const artifact = artifactOf('counter')
  const result = await compiler.compile(artifact)
  assert.ok(result.code.byteLength > 0)
  const compilePid = eventOf(events, 'compile-spawn').pid
  const esbuildPid = eventOf(events, 'esbuild-spawn').pid
  assert.ok(Number.isSafeInteger(compilePid))
  assert.ok(Number.isSafeInteger(esbuildPid))
  assert.notEqual(compilePid, esbuildPid)
  await waitForProcessGone(compilePid)
  await waitForProcessGone(esbuildPid)
  assert.equal(eventOf(events, 'compile-exit').code, 0)
  assert.equal(compiler.stats().processes, 0)

  const cached = await compiler.compile(artifact)
  assert.equal(cached.cache, 'hit')
  assert.equal(events.filter(event => event.type === 'compile-spawn').length, 1)
})

test('compile errors retire the esbuild process and a later compile still succeeds', { timeout: 10_000 }, async t => {
  const events = []
  const compiler = createCompiler({ processObserver: event => events.push(event) })
  t.after(() => compiler.dispose())
  await assert.rejects(
    compiler.compile(artifactOf('counter', 'export default function Broken() { return <div>')),
    { code: 'BUILD_FAILED' },
  )
  const failedEsbuild = eventOf(events, 'esbuild-spawn').pid
  await waitForProcessGone(failedEsbuild)
  assert.equal(compiler.stats().processes, 0)

  const good = await compiler.compile(artifactOf('todo'))
  assert.ok(good.code.byteLength > 0)
  const successfulEsbuild = events.filter(event => event.type === 'esbuild-spawn').at(-1).pid
  await waitForProcessGone(successfulEsbuild)
})

test('cancellation kills a busy esbuild child, keeps the host responsive and permits a retry', { timeout: 10_000 }, async t => {
  const events = []
  let markRunning
  const running = new Promise(resolve => { markRunning = resolve })
  const compiler = createCompiler({
    compileTimeoutMs: 5_000,
    processObserver(event) {
      events.push(event)
      if (event.type === 'esbuild-spawn') markRunning()
    },
  })
  t.after(() => compiler.dispose())
  const heavy = busySource()
  assert.ok(Buffer.byteLength(heavy) <= 65_536)
  const controller = new AbortController()
  let ticks = 0
  const ticker = setInterval(() => { ticks++ }, 10)
  try {
    const pending = compiler.compile(artifactOf('counter', heavy), { signal: controller.signal })
    await running
    const before = ticks
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.ok(ticks > before, 'host event loop remains responsive while esbuild is busy')
    controller.abort()
    await assert.rejects(pending, { code: 'COMPILE_CANCELLED' })
  } finally {
    clearInterval(ticker)
  }
  const compilePid = eventOf(events, 'compile-spawn').pid
  const esbuildPid = eventOf(events, 'esbuild-spawn').pid
  await waitForProcessGone(compilePid)
  await waitForProcessGone(esbuildPid)
  assert.equal(compiler.stats().processes, 0)

  const beforeRetry = events.length
  const retry = await compiler.compile(artifactOf('counter'))
  assert.ok(retry.code.byteLength > 0)
  const retryPids = events.slice(beforeRetry)
  assert.notEqual(eventOf(retryPids, 'compile-spawn').pid, compilePid)
  await waitForProcessGone(eventOf(retryPids, 'esbuild-spawn').pid)
})

test('timeout kills the actual busy esbuild child before COMPILE_TIMEOUT is returned', { timeout: 10_000 }, async t => {
  const events = []
  const compiler = createCompiler({ compileTimeoutMs: 450, processObserver: event => events.push(event) })
  t.after(() => compiler.dispose())
  const heavy = busySource()
  assert.ok(Buffer.byteLength(heavy) <= 65_536)
  let ticks = 0
  const ticker = setInterval(() => { ticks++ }, 10)
  try {
    await assert.rejects(compiler.compile(artifactOf('counter', heavy)), { code: 'COMPILE_TIMEOUT' })
  } finally {
    clearInterval(ticker)
  }
  assert.ok(ticks > 0, 'host remained responsive during the bounded compile')
  const compilePid = eventOf(events, 'compile-spawn').pid
  const esbuildPid = eventOf(events, 'esbuild-spawn').pid
  assert.ok(Number.isSafeInteger(esbuildPid), 'timeout occurred after esbuild had started')
  await waitForProcessGone(compilePid)
  await waitForProcessGone(esbuildPid)
  assert.equal(compiler.stats().processes, 0)

  const laterCompiler = createCompiler()
  t.after(() => laterCompiler.dispose())
  const later = await laterCompiler.compile(artifactOf('todo'))
  assert.ok(later.code.byteLength > 0)
  assert.equal(laterCompiler.stats().processes, 0)
})

test('repeated compiles do not accumulate compiler or esbuild processes', { timeout: 15_000 }, async t => {
  const events = []
  const compiler = createCompiler({ processObserver: event => events.push(event) })
  t.after(() => compiler.dispose())
  for (const name of ['counter', 'todo', 'pomodoro']) {
    const result = await compiler.compile(artifactOf(name))
    assert.ok(result.code.byteLength > 0)
  }
  assert.equal(events.filter(event => event.type === 'compile-spawn').length, 3)
  assert.equal(events.filter(event => event.type === 'esbuild-spawn').length, 3)
  for (const event of events.filter(item => item.type === 'compile-spawn' || item.type === 'esbuild-spawn')) {
    await waitForProcessGone(event.pid)
  }
  assert.equal(compiler.stats().processes, 0)
})

test('dispose retires an in-flight busy compile process tree', { timeout: 10_000 }, async () => {
  const events = []
  let markRunning
  const running = new Promise(resolve => { markRunning = resolve })
  const compiler = createCompiler({
    compileTimeoutMs: 5_000,
    processObserver(event) {
      events.push(event)
      if (event.type === 'esbuild-spawn') markRunning()
    },
  })
  const heavy = busySource()
  assert.ok(Buffer.byteLength(heavy) <= 65_536)
  const pending = compiler.compile(artifactOf('counter', heavy))
  const rejected = assert.rejects(pending, error => ['COMPILE_CANCELLED', 'BUILD_FAILED'].includes(error.code))
  await running
  await compiler.dispose()
  await rejected
  const compilePid = eventOf(events, 'compile-spawn').pid
  const esbuildPid = eventOf(events, 'esbuild-spawn').pid
  await waitForProcessGone(compilePid)
  await waitForProcessGone(esbuildPid)
  assert.equal(compiler.stats().processes, 0)
})
