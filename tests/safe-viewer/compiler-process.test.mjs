import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createCompiler, createProcessRegistry } from '../../server/safe-viewer/compile.mjs'
import { createProcessReaper } from '../../server/safe-viewer/process-reaper.mjs'
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

async function waitForEvent(events, type, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const event = events.find(item => item.type === type)
    if (event) return event
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`event ${type} was not observed within ${timeoutMs}ms`)
}

async function waitForState(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(message)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function startDecoy() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' })
  await once(child, 'spawn')
  return child
}

test('successful compile closes both the compile process and its esbuild service process', { timeout: 10_000 }, async t => {
  const events = []
  const compiler = createCompiler({
    processObserver(event) {
      events.push(event)
      if (event.type === 'compile-diagnostic') console.error(`compile diagnostic: ${event.detail}`)
    },
  })
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
  assert.equal(compiler.stats().unresolvedProcesses.length, 0)
  assert.equal(compiler.stats().terminationState, 'clean')
  assert.ok(compiler.stats().confirmedExitedProcesses >= 1)

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

test('timeout kills a parked esbuild service before COMPILE_TIMEOUT is returned', { timeout: 10_000 }, async t => {
  const events = []
  const compiler = createCompiler({
    compileTimeoutMs: 1_500,
    testHooks: { nextFault: () => 'hang-after-esbuild' },
    processObserver: event => events.push(event),
  })
  t.after(() => compiler.dispose())
  let ticks = 0
  const ticker = setInterval(() => { ticks++ }, 10)
  const pending = compiler.compile(artifactOf('counter'))
  const outcome = pending.then(value => ({ value }), error => ({ error }))
  try {
    const started = await waitForEvent(events, 'esbuild-spawn')
    assert.ok(Number.isSafeInteger(started.pid))
    const settled = await outcome
    assert.equal(settled.error?.code, 'COMPILE_TIMEOUT')
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

test('a compile child crash after esbuild starts is reaped through the known service identity', { timeout: 15_000 }, async t => {
  const events = []
  const faults = ['crash-after-esbuild']
  const compiler = createCompiler({
    processObserver: event => events.push(event),
    testHooks: { nextFault: () => faults.shift() ?? null },
  })
  t.after(() => compiler.dispose())
  await assert.rejects(compiler.compile(artifactOf('counter')), { code: 'BUILD_FAILED' })
  const compilePid = eventOf(events, 'compile-spawn').pid
  const esbuildPid = eventOf(events, 'esbuild-spawn').pid
  assert.notEqual(compilePid, esbuildPid)
  await waitForProcessGone(compilePid)
  await waitForProcessGone(esbuildPid)
  assert.equal(eventOf(events, 'esbuild-identity').ok, true)
  const reaped = eventOf(events, 'process-reaped')
  assert.equal(reaped.ok, true)
  assert.ok(['gone', 'already-gone'].includes(reaped.status))
  assert.equal(compiler.stats().processes, 0)
  assert.equal(compiler.stats().fused, false)

  const retry = await compiler.compile(artifactOf('todo'))
  assert.ok(retry.code.byteLength > 0)
  assert.equal(compiler.stats().processes, 0)
})

test('taskkill failure falls back to identity-checked direct PID cleanup and safely recovers', {
  timeout: 15_000,
  skip: process.platform !== 'win32',
}, async t => {
  const events = []
  let markRunning
  const running = new Promise(resolve => { markRunning = resolve })
  const processReaper = createProcessReaper({
    runTaskkill: async () => { throw new Error('forced taskkill failure') },
  })
  const compiler = createCompiler({
    processReaper,
    compileTimeoutMs: 5_000,
    processObserver(event) {
      events.push(event)
      if (event.type === 'esbuild-spawn') markRunning()
    },
  })
  t.after(() => compiler.dispose())
  const controller = new AbortController()
  const pending = compiler.compile(artifactOf('counter', busySource()), { signal: controller.signal })
  await running
  controller.abort()
  await assert.rejects(pending, { code: 'COMPILE_CANCELLED' })
  assert.equal(eventOf(events, 'root-tree-signal').ok, false)
  const compilePid = eventOf(events, 'compile-spawn').pid
  const esbuildPid = eventOf(events, 'esbuild-spawn').pid
  await waitForProcessGone(compilePid)
  await waitForProcessGone(esbuildPid)
  const reaped = eventOf(events, 'process-reaped')
  assert.equal(reaped.ok, true)
  assert.ok(['gone', 'already-gone'].includes(reaped.status))
  assert.equal(compiler.stats().fused, false)

  const retry = await compiler.compile(artifactOf('todo'))
  assert.ok(retry.code.byteLength > 0)
  assert.equal(compiler.stats().processes, 0)
})

test('a surviving tracked process fuses the compiler and starts no further processes', { timeout: 15_000 }, async t => {
  const events = []
  const baseReaper = createProcessReaper()
  const decoy = await startDecoy()
  let refuseCleanup = true
  const processReaper = Object.freeze({
    ...baseReaper,
    terminatePid(pid, identity) {
      if (refuseCleanup) return Promise.resolve({ ok: false, status: 'forced-cleanup-failure' })
      return baseReaper.terminatePid(pid, identity)
    },
  })
  const compiler = createCompiler({
    processReaper,
    compileTimeoutMs: 300,
    testHooks: { extraPid: decoy.pid },
    processObserver(event) {
      events.push(event)
    },
  })
  t.after(() => compiler.dispose())
  let surviving
  t.after(async () => {
    if (surviving) await baseReaper.terminatePid(surviving.pid, surviving.identity)
    if (decoy.exitCode === null && decoy.signalCode === null) {
      try { decoy.kill('SIGKILL') } catch {}
    }
  })
  await assert.rejects(compiler.compile(artifactOf('counter')), { code: 'COMPILER_TERMINATION_FAILED' })
  const identityEvent = events.find(event => event.type === 'process-identity' && event.pid === decoy.pid)
  assert.equal(identityEvent.ok, true)
  surviving = { pid: identityEvent.pid, identity: { pid: identityEvent.pid, identity: identityEvent.identity } }
  assert.equal((await baseReaper.inspect(surviving.pid))?.identity, identityEvent.identity)
  assert.equal(compiler.stats().fused, true)
  assert.equal(compiler.stats().cleanupFailures, 1)
  const spawnCount = events.filter(event => event.type === 'compile-spawn').length
  await assert.rejects(compiler.compile(artifactOf('todo')), { code: 'COMPILER_QUARANTINED' })
  assert.equal(events.filter(event => event.type === 'compile-spawn').length, spawnCount)
  assert.equal(compiler.stats().processes, 0)
  refuseCleanup = false
  const cleaned = await baseReaper.terminatePid(surviving.pid, surviving.identity)
  assert.equal(cleaned.ok, true)
  assert.equal(await baseReaper.inspect(surviving.pid), null)
  surviving = null
})

test('one waiter cancellation leaves a shared compile running for another waiter', { timeout: 15_000 }, async t => {
  const gate = deferred()
  const events = []
  const compiler = createCompiler({
    testHooks: { beforeResult: () => gate.promise },
    processObserver: event => events.push(event),
  })
  t.after(() => compiler.dispose())
  const artifact = artifactOf('counter')
  const controller = new AbortController()
  const aOutcome = compiler.compile(artifact, { signal: controller.signal })
    .then(value => ({ value }), error => ({ error }))
  const bOutcome = compiler.compile(artifact)
    .then(value => ({ value }), error => ({ error }))

  await waitForEvent(events, 'esbuild-spawn')
  await waitForState(() => compiler.stats().waiters === 2, 'both callers must share the job')
  controller.abort()
  gate.resolve()

  const [first, second] = await Promise.all([aOutcome, bOutcome])
  assert.equal(first.error?.code, 'COMPILE_CANCELLED')
  assert.ok(second.value?.code.byteLength > 0)
  assert.equal(events.filter(event => event.type === 'compile-spawn').length, 1)
  assert.equal(compiler.stats().waiters, 0)
  await waitForProcessGone(eventOf(events, 'compile-spawn').pid)
  await waitForProcessGone(eventOf(events, 'esbuild-spawn').pid)
})

test('all waiters cancelling retires the shared compile and permits a later compile', { timeout: 15_000 }, async t => {
  const faults = ['hang-after-esbuild']
  const events = []
  const compiler = createCompiler({
    compileTimeoutMs: 5_000,
    testHooks: { nextFault: () => faults.shift() ?? null },
    processObserver: event => events.push(event),
  })
  t.after(() => compiler.dispose())
  const artifact = artifactOf('counter')
  const firstController = new AbortController()
  const secondController = new AbortController()
  const firstOutcome = compiler.compile(artifact, { signal: firstController.signal })
    .then(value => ({ value }), error => ({ error }))
  const secondOutcome = compiler.compile(artifact, { signal: secondController.signal })
    .then(value => ({ value }), error => ({ error }))

  await waitForEvent(events, 'esbuild-spawn')
  await waitForState(() => compiler.stats().waiters === 2, 'both callers must share the job')
  firstController.abort()
  secondController.abort()

  const [first, second] = await Promise.all([firstOutcome, secondOutcome])
  assert.equal(first.error?.code, 'COMPILE_CANCELLED')
  assert.equal(second.error?.code, 'COMPILE_CANCELLED')
  await waitForProcessGone(eventOf(events, 'compile-spawn').pid)
  await waitForProcessGone(eventOf(events, 'esbuild-spawn').pid)
  assert.equal(compiler.stats().processes, 0)
  assert.equal(compiler.stats().waiters, 0)

  const retry = await compiler.compile(artifactOf('todo'))
  assert.ok(retry.code.byteLength > 0)
})

test('dispose retires a shared in-flight compile and settles every waiter', { timeout: 15_000 }, async () => {
  const faults = ['hang-after-esbuild']
  const events = []
  const compiler = createCompiler({
    compileTimeoutMs: 5_000,
    testHooks: { nextFault: () => faults.shift() ?? null },
    processObserver: event => events.push(event),
  })
  const artifact = artifactOf('counter')
  const firstOutcome = compiler.compile(artifact)
    .then(value => ({ value }), error => ({ error }))
  const secondOutcome = compiler.compile(artifact)
    .then(value => ({ value }), error => ({ error }))

  await waitForEvent(events, 'esbuild-spawn')
  await waitForState(() => compiler.stats().waiters === 2, 'both callers must share the job')
  await compiler.dispose()

  const [first, second] = await Promise.all([firstOutcome, secondOutcome])
  assert.equal(first.error?.code, 'COMPILE_CANCELLED')
  assert.equal(second.error?.code, 'COMPILE_CANCELLED')
  await waitForProcessGone(eventOf(events, 'compile-spawn').pid)
  await waitForProcessGone(eventOf(events, 'esbuild-spawn').pid)
  assert.equal(compiler.stats().processes, 0)
  assert.equal(compiler.stats().waiters, 0)
})

test('identity inspection failure is quarantined without guessing a PID', { timeout: 15_000 }, async t => {
  const baseReaper = createProcessReaper()
  const decoy = await startDecoy()
  const registry = createProcessRegistry()
  const processReaper = Object.freeze({
    ...baseReaper,
    inspect(pid) {
      if (pid === decoy.pid) return Promise.reject(new Error('forced identity inspection failure'))
      return baseReaper.inspect(pid)
    },
  })
  const compiler = createCompiler({
    processRegistry: registry,
    processReaper,
    compileTimeoutMs: 2_000,
    testHooks: { extraPid: decoy.pid },
  })
  t.after(async () => {
    await compiler.dispose()
    if (decoy.exitCode === null && decoy.signalCode === null) {
      try { decoy.kill('SIGKILL') } catch {}
    }
  })

  await assert.rejects(compiler.compile(artifactOf('counter')), { code: 'COMPILER_TERMINATION_FAILED' })
  const stats = compiler.stats()
  assert.equal(stats.fused, true)
  assert.equal(stats.processes, 0)
  assert.equal(stats.unresolvedProcesses.length, 1)
  assert.equal(stats.unresolvedProcesses[0].pid, decoy.pid)
  assert.equal(stats.unresolvedProcesses[0].lastStatus, 'identity-inspection-failed')
  assert.equal(stats.terminationState, 'quarantined')
  await assert.rejects(compiler.compile(artifactOf('todo')), { code: 'COMPILER_QUARANTINED' })

  await compiler.dispose()
  assert.equal(compiler.stats().unresolvedProcesses.length, 1)
  assert.equal(decoy.exitCode, null, 'unknown identity must never be killed')
})

test('dispose retries retained identities and a shared registry can recover', { timeout: 20_000 }, async t => {
  const baseReaper = createProcessReaper()
  const decoy = await startDecoy()
  const registry = createProcessRegistry()
  let refuseCleanup = true
  const processReaper = Object.freeze({
    ...baseReaper,
    terminatePid(pid, identity) {
      if (refuseCleanup) return Promise.resolve({ ok: false, status: 'forced-cleanup-failure' })
      return baseReaper.terminatePid(pid, identity)
    },
  })
  const compiler = createCompiler({
    processRegistry: registry,
    processReaper,
    compileTimeoutMs: 2_000,
    testHooks: { extraPid: decoy.pid },
  })
  const second = createCompiler({ processRegistry: registry })
  t.after(async () => {
    await second.dispose()
    if (decoy.exitCode === null && decoy.signalCode === null) {
      try { decoy.kill('SIGKILL') } catch {}
    }
  })

  await assert.rejects(compiler.compile(artifactOf('counter')), { code: 'COMPILER_TERMINATION_FAILED' })
  const stats = compiler.stats()
  assert.equal(stats.processes, 0)
  assert.ok(stats.knownChildProcesses >= 2)
  assert.ok(stats.unresolvedProcesses.some(record => record.pid === decoy.pid))
  assert.equal(stats.terminationState, 'quarantined')
  await assert.rejects(second.compile(artifactOf('todo')), { code: 'COMPILER_QUARANTINED' })

  refuseCleanup = false
  const firstDisposal = compiler.dispose()
  const secondDisposal = compiler.dispose()
  assert.equal(firstDisposal, secondDisposal)
  await firstDisposal
  assert.equal(compiler.stats().unresolvedProcesses.length, 0)
  assert.equal(compiler.stats().processes, 0)
  assert.equal(processAlive(decoy.pid), false)

  const recovered = createCompiler({ processRegistry: registry })
  t.after(() => recovered.dispose())
  const result = await recovered.compile(artifactOf('todo'))
  assert.ok(result.code.byteLength > 0)
})

test('aborting a signal after completion does not alter the completed result', { timeout: 10_000 }, async t => {
  const compiler = createCompiler()
  t.after(() => compiler.dispose())
  const controller = new AbortController()
  const result = await compiler.compile(artifactOf('counter'), { signal: controller.signal })
  assert.ok(result.code.byteLength > 0)
  controller.abort()
  assert.equal(compiler.stats().waiters, 0)
  const again = await compiler.compile(artifactOf('todo'))
  assert.ok(again.code.byteLength > 0)
})
