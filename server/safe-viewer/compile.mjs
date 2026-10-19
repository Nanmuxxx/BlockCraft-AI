import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { version as esbuildVersion } from 'esbuild-wasm'
import { LIMITS, POLICY_VERSION, SafeViewerError, check } from './policy.mjs'
import { createProcessReaper } from './process-reaper.mjs'

const require = createRequire(import.meta.url)
const packageVersion = name => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version
const reactVersion = packageVersion('react')
const reactDomVersion = packageVersion('react-dom')

check(esbuildVersion === '0.25.12', 'TOOLCHAIN_VERSION_MISMATCH', 'esbuild version is not pinned')
check(reactVersion === '19.3.1' && reactDomVersion === '19.3.1', 'TOOLCHAIN_VERSION_MISMATCH', 'React version is not pinned')

const compileChildPath = fileURLToPath(new URL('./compile-child.mjs', import.meta.url))
const runtimeSource = readFileSync(new URL('./assets/runtime-core.js', import.meta.url), 'utf8')
const runtimeDigest = `sha256:${createHash('sha256').update(runtimeSource).digest('hex')}`

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function bundleKey(versionDigest) {
  return `${POLICY_VERSION}:${esbuildVersion}:${reactVersion}:${runtimeDigest}:${versionDigest}`
}

function copy(value) {
  return Buffer.from(value)
}

const PROCESS_RECORD_LIMIT = 256

/**
 * Process records survive a failed cleanup so a quarantined compiler can
 * report and retry the exact identities it observed. The registry may be
 * shared by trusted recovery code; a compiler created with a registry that
 * still has unresolved records must not start a new compile.
 */
export function createProcessRegistry() {
  const records = new Map()

  function prune() {
    if (records.size <= PROCESS_RECORD_LIMIT) return
    const gone = [...records.entries()]
      .filter(([, record]) => record.state === 'gone')
      .sort(([, left], [, right]) => left.updatedAt - right.updatedAt)
    while (records.size > PROCESS_RECORD_LIMIT && gone.length > 0) {
      records.delete(gone.shift()[0])
    }
  }

  function keyOf(pid, rootPid) {
    return `${rootPid}:${pid}`
  }

  function track(pid, rootPid, owner) {
    const key = keyOf(pid, rootPid)
    const existing = records.get(key)
    if (existing && existing.state !== 'gone') return existing
    const record = {
      pid,
      rootPid,
      owner,
      identity: null,
      parentPid: null,
      state: 'identity-pending',
      lastStatus: 'identity-pending',
      updatedAt: Date.now(),
    }
    records.set(key, record)
    prune()
    return record
  }

  function mark(pid, rootPid, patch) {
    const record = records.get(keyOf(pid, rootPid))
    if (!record) return null
    Object.assign(record, patch, { updatedAt: Date.now() })
    return record
  }

  function get(pid, rootPid) {
    const record = records.get(keyOf(pid, rootPid))
    return record ? Object.freeze({ ...record }) : null
  }

  function snapshot() {
    return [...records.values()].map(({ owner, ...record }) => Object.freeze({ ...record }))
  }

  function unresolved(owner) {
    return [...records.values()]
      .filter(record => record.state === 'unresolved' || record.state === 'identity-unknown')
      .filter(record => owner === undefined || record.owner === owner)
      .map(({ owner: ignored, ...record }) => Object.freeze({ ...record }))
  }

  return Object.freeze({ track, mark, get, snapshot, unresolved })
}

function compilerEnvironment({ testFaults = false } = {}) {
  const allowed = [
    'PATH', 'Path', 'PATHEXT', 'ComSpec', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
    'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL',
  ]
  const environment = { NODE_ENV: 'production' }
  for (const key of allowed) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key]
  }
  if (testFaults) environment.BLOCKCRAFT_SAFE_VIEWER_TEST_FAULTS = '1'
  return environment
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', onExit)
      resolve(value)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
  })
}


function compileInProcess(
  artifact,
  maxBundleBytes,
  compileTimeoutMs,
  signal,
  observer,
  activeChildren,
  processRegistry,
  owner,
  processReaper,
  testHooks,
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled'))
      return
    }
    const testFault = testHooks?.nextFault?.() ?? null
    let child
    try {
      child = fork(compileChildPath, [], {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        serialization: 'advanced',
        execArgv: ['--max-old-space-size=128', '--max-semi-space-size=32', '--stack-size=4096'],
        env: compilerEnvironment({ testFaults: Boolean(testHooks) }),
        cwd: path.resolve(path.dirname(compileChildPath), '../..'),
      })
    } catch {
      reject(new SafeViewerError('BUILD_FAILED', 'Compilation process failed to start'))
      return
    }
    activeChildren.add(child)

    let settled = false
    let resultReceived = false
    const knownInspections = new Map()
    const notify = event => {
      try { observer(Object.freeze({ ...event })) } catch {}
    }
    const trackKnownProcess = pid => {
      if (!Number.isSafeInteger(pid) || pid <= 0) return null
      if (knownInspections.has(pid)) return knownInspections.get(pid)
      processRegistry.track(pid, child.pid, owner)
      const inspection = Promise.resolve()
        .then(() => processReaper.inspect(pid))
        .then(identity => ({ ok: true, identity }))
        .catch(() => ({ ok: false, identity: null }))
      knownInspections.set(pid, inspection)
      void inspection.then(report => {
        processRegistry.mark(pid, child.pid, {
          identity: report.identity?.identity ?? null,
          parentPid: report.identity?.parentPid ?? null,
          state: report.ok ? (report.identity ? 'tracked' : 'gone') : 'identity-unknown',
          lastStatus: report.ok
            ? (report.identity ? 'identity-recorded' : 'already-gone')
            : 'identity-inspection-failed',
        })
        notify({
          type: 'process-identity',
          pid,
          ok: report.ok,
          identity: report.identity?.identity ?? null,
          parentPid: report.identity?.parentPid ?? null,
        })
      })
      return inspection
    }
    const reapKnownProcesses = async () => {
      let ok = true
      for (const [pid, inspection] of knownInspections) {
        const report = await inspection
        const record = processRegistry.get(pid, child.pid)
        if (!report.ok) {
          processRegistry.mark(pid, child.pid, {
            state: 'unresolved',
            lastStatus: 'identity-inspection-failed',
          })
          notify({ type: 'process-reaped', pid, ok: false, status: 'identity-inspection-failed' })
          ok = false
          continue
        }
        if (!report.identity) {
          processRegistry.mark(pid, child.pid, {
            state: 'gone',
            lastStatus: 'already-gone',
          })
          notify({ type: 'process-reaped', pid, ok: true, status: 'already-gone' })
          continue
        }
        if (!record?.identity) {
          processRegistry.mark(pid, child.pid, {
            state: 'unresolved',
            lastStatus: 'identity-unavailable',
          })
          notify({ type: 'process-reaped', pid, ok: false, status: 'identity-unavailable' })
          ok = false
          continue
        }
        const result = await processReaper.terminatePid(pid, { pid, identity: record.identity })
        processRegistry.mark(pid, child.pid, {
          state: result.ok ? 'gone' : 'unresolved',
          lastStatus: result.status,
        })
        notify({ type: 'process-reaped', pid, ...result })
        if (!result.ok) ok = false
      }
      return ok
    }
    const stopRoot = async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        notify({ type: 'root-tree-signal', pid: child.pid, ok: true, status: 'already-exited' })
        return true
      }
      const tree = await processReaper.terminateTree(child.pid)
      notify({ type: 'root-tree-signal', pid: child.pid, ...tree })
      if (!(await waitForExit(child, 2_000))) {
        try { child.kill('SIGKILL') } catch {}
        if (!(await waitForExit(child, 1_000))) return false
      }
      return true
    }
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      void (async () => {
        let failure = error
        const rootGone = error ? await stopRoot() : await waitForExit(child, 2_000)
        if (!rootGone) {
          try { child.kill('SIGKILL') } catch {}
        }
        const knownGone = await reapKnownProcesses()
        if (!rootGone || !knownGone) {
          failure = new SafeViewerError('COMPILER_TERMINATION_FAILED', 'Compilation process tree did not terminate')
        }
        activeChildren.delete(child)
        if (failure) reject(failure)
        else resolve(result)
      })()
    }
    const onAbort = () => finish(new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled'))
    const timer = setTimeout(
      () => finish(new SafeViewerError('COMPILE_TIMEOUT', 'Compilation timed out')),
      compileTimeoutMs,
    )

    notify({ type: 'compile-spawn', pid: child.pid })
    if (Number.isSafeInteger(testHooks?.extraPid)) trackKnownProcess(testHooks.extraPid)
    child.on('message', message => {
      if (message?.type === 'esbuild-child' && Number.isSafeInteger(message.pid) && message.pid > 0) {
        const inspection = trackKnownProcess(message.pid)
        notify({ type: 'esbuild-spawn', pid: message.pid })
        void inspection.then(report => notify({
          type: 'esbuild-identity',
          pid: message.pid,
          ok: report.ok,
          identity: report.identity?.identity ?? null,
          parentPid: report.identity?.parentPid ?? null,
        }))
        return
      }
      if (message?.type === 'result' && message.code instanceof Uint8Array) {
        resultReceived = true
        const code = copy(message.code)
        if (code.byteLength > maxBundleBytes) {
          finish(new SafeViewerError('BUNDLE_LIMIT', 'Compiled bundle exceeds its limit'))
          return
        }
        if (typeof testHooks?.beforeResult === 'function') {
          Promise.resolve()
            .then(() => testHooks.beforeResult())
            .then(
              () => finish(null, code),
              () => finish(new SafeViewerError('BUILD_FAILED', 'Compilation result gate failed')),
            )
          return
        }
        finish(null, code)
        return
      }
      if (message?.type === 'error') {
        notify({ type: 'compile-diagnostic', detail: typeof message.detail === 'string' ? message.detail : null })
        finish(new SafeViewerError(
          message.code === 'BUNDLE_LIMIT' ? 'BUNDLE_LIMIT' : message.code === 'CHILD_TERMINATION_FAILED' ? 'COMPILER_TERMINATION_FAILED' : 'BUILD_FAILED',
          'Compilation failed',
        ))
        return
      }
      finish(new SafeViewerError('BUILD_FAILED', 'Compilation process returned an invalid message'))
    })
    child.once('error', () => finish(new SafeViewerError('BUILD_FAILED', 'Compilation process failed')))
    child.once('exit', (code, signal) => {
      notify({ type: 'compile-exit', pid: child.pid, code, signal })
      if (!settled && !resultReceived) {
        finish(new SafeViewerError('BUILD_FAILED', 'Compilation process exited without a result'))
      }
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    child.send({
      sources: artifact.sources,
      entry: artifact.manifest.entry,
      maxBundleBytes,
      runtimeSource,
      testFault,
    }, error => {
      if (error) finish(new SafeViewerError('BUILD_FAILED', 'Compilation task could not be delivered'))
    })
  })
}

export function createBundleCache({ maxEntries = LIMITS.cacheEntries, maxBytes = LIMITS.cacheBytes } = {}) {
  const entries = new Map()
  const byDigest = new Map()
  let bytes = 0
  const stats = { entries: 0, bytes: 0, hits: 0, misses: 0, builds: 0, evictions: 0 }
  function touch(key, value) {
    entries.delete(key)
    entries.set(key, value)
  }
  function evict() {
    while (entries.size > maxEntries || bytes > maxBytes) {
      const oldest = entries.entries().next().value
      if (!oldest) break
      const [key, value] = oldest
      entries.delete(key)
      byDigest.delete(value.digest)
      bytes -= value.code.byteLength
      stats.evictions++
    }
  }
  return Object.freeze({
    get(key) {
      const value = entries.get(key)
      if (!value) { stats.misses++; return undefined }
      touch(key, value); stats.hits++
      return value
    },
    put(key, value) {
      const old = entries.get(key)
      if (old) bytes -= old.code.byteLength
      const entry = Object.freeze({ ...value, code: copy(value.code) })
      entries.set(key, entry)
      byDigest.set(entry.digest, entry)
      bytes += entry.code.byteLength
      stats.builds++
      evict()
      stats.entries = entries.size
      stats.bytes = bytes
      return entry
    },
    byDigest(digest) {
      const entry = byDigest.get(digest)
      if (entry) stats.hits++
      return entry
    },
    snapshot() {
      return Object.freeze({ ...stats, entries: entries.size, bytes })
    },
    clear() {
      entries.clear(); byDigest.clear(); bytes = 0
      stats.entries = 0; stats.bytes = 0
    },
  })
}
export function createCompiler({
  compileTimeoutMs = LIMITS.compileTimeoutMs,
  concurrency = LIMITS.compileConcurrency,
  cache = createBundleCache(),
  processObserver = () => {},
  processReaper = createProcessReaper(),
  processRegistry = createProcessRegistry(),
  testHooks = null,
} = {}) {
  check(Number.isSafeInteger(compileTimeoutMs) && compileTimeoutMs > 0, 'COMPILER_CONFIGURATION', 'Invalid compile timeout')
  check(Number.isSafeInteger(concurrency) && concurrency > 0, 'COMPILER_CONFIGURATION', 'Invalid compiler concurrency')
  const inFlight = new Map()
  const children = new Set()
  const owner = Symbol('safe-viewer-compiler')
  let active = 0
  let disposed = false
  let disposal
  let fused = false
  let cleanupFailures = 0

  function waitForJob(job, signal, cacheState) {
    if (signal?.aborted) return Promise.reject(new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled'))
    return new Promise((resolve, reject) => {
      let settled = false
      const waiter = {
        cancelled: false,
        settle(value, error) {
          if (settled) return
          settled = true
          job.waiters.delete(waiter)
          signal?.removeEventListener('abort', onAbort)
          if (error) reject(error)
          else resolve({ ...value, cache: cacheState })
        },
      }
      // A waiter's cancellation is local. The shared job is aborted only
      // after its last waiter leaves or a job-level timeout/dispose fires.
      const onAbort = () => {
        if (settled || job.done) return
        waiter.cancelled = true
        if ([...job.waiters].every(item => item.cancelled)) job.controller.abort()
      }
      job.waiters.add(waiter)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  async function reapOwnedKnownProcesses() {
    let ok = true
    for (const record of processRegistry.unresolved(owner)) {
      if (!record.identity) {
        ok = false
        continue
      }
      const result = await processReaper.terminatePid(record.pid, {
        pid: record.pid,
        identity: record.identity,
      })
      processRegistry.mark(record.pid, record.rootPid, {
        state: result.ok ? 'gone' : 'unresolved',
        lastStatus: result.status,
      })
      if (!result.ok) ok = false
    }
    return ok
  }

  return Object.freeze({
    cache,
    processRegistry,
    stats: () => {
      const records = processRegistry.snapshot()
      const unresolved = processRegistry.unresolved()
      return Object.freeze({
        ...cache.snapshot(),
        processes: children.size,
        rootProcesses: children.size,
        knownChildProcesses: records.filter(record => record.state !== 'gone').length,
        confirmedExitedProcesses: records.filter(record => record.state === 'gone').length,
        unresolvedProcesses: unresolved.map(record => Object.freeze({
          pid: record.pid,
          rootPid: record.rootPid,
          identity: record.identity,
          state: record.state,
          lastStatus: record.lastStatus,
        })),
        terminationState: unresolved.length > 0 || fused ? 'quarantined' : 'clean',
        waiters: [...inFlight.values()].reduce((count, job) => count + job.waiters.size, 0),
        activeWaiters: [...inFlight.values()].reduce(
          (count, job) => count + [...job.waiters].filter(waiter => !waiter.cancelled).length,
          0,
        ),
        fused,
        cleanupFailures,
      })
    },
    async compile(artifact, { signal } = {}) {
      check(!disposed, 'VIEWER_DISPOSED', 'Compiler disposed')
      check(!fused, 'COMPILER_QUARANTINED', 'Compiler cleanup is unresolved')
      check(processRegistry.unresolved().length === 0, 'COMPILER_QUARANTINED', 'Compiler cleanup is unresolved')
      if (signal?.aborted) throw new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled')
      const key = bundleKey(artifact.versionDigest)
      const cached = cache.get(key)
      if (cached) return { ...cached, cache: 'hit' }
      if (inFlight.has(key)) {
        const existing = inFlight.get(key)
        if (!existing.done) return waitForJob(existing, signal, 'hit')
        const completed = cache.get(key)
        if (completed) return { ...completed, cache: 'hit' }
      }
      check(active < concurrency, 'COMPILER_BUSY', 'Compiler busy')
      active++
      const job = { waiters: new Set(), done: false, controller: new AbortController(), promise: null }
      job.promise = (async () => {
        try {
          const maxBundleBytes = Math.min(artifact.build.maxBundleBytes, LIMITS.bundleBytes)
          const code = await compileInProcess(
            artifact,
            maxBundleBytes,
            compileTimeoutMs,
            job.controller.signal,
            processObserver,
            children,
            processRegistry,
            owner,
            processReaper,
            testHooks,
          )
          const digest = sha256(code)
          return cache.put(key, {
            code,
            bytes: code.byteLength,
            digest: `sha256:${digest}`,
            versionDigest: artifact.versionDigest,
          })
        } catch (error) {
          if (error?.code === 'COMPILER_TERMINATION_FAILED') {
            fused = true
            cleanupFailures++
          }
          throw error
        } finally {
          job.done = true
          if (inFlight.get(key) === job) inFlight.delete(key)
          active--
        }
      })()
      job.promise.then(
        value => {
          for (const waiter of [...job.waiters]) {
            waiter.settle(value, waiter.cancelled
              ? new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled')
              : null)
          }
        },
        error => {
          for (const waiter of [...job.waiters]) {
            waiter.settle(null, waiter.cancelled
              ? new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled')
              : error)
          }
        },
      )
      inFlight.set(key, job)
      return waitForJob(job, signal, 'build')
    },
    dispose() {
      if (disposal) return disposal
      disposed = true
      const jobs = [...inFlight.values()]
      for (const job of jobs) job.controller.abort()
      disposal = (async () => {
        await Promise.all([...children].map(child =>
          child.exitCode !== null || child.signalCode !== null
            ? true
            : processReaper.terminateTree(child.pid)))
        await Promise.allSettled(jobs.map(job => job.promise))
        await reapOwnedKnownProcesses()
        children.clear()
        cache.clear()
      })()
      return disposal
    },
  })
}
