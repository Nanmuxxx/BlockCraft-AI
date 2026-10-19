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
    const esbuildProcesses = new Map()
    const notify = event => {
      try { observer(Object.freeze({ ...event })) } catch {}
    }
    const trackKnownProcess = pid => {
      if (!Number.isSafeInteger(pid) || pid <= 0 || esbuildProcesses.has(pid)) return
      const inspection = Promise.resolve()
        .then(() => processReaper.inspect(pid))
        .then(identity => ({ ok: true, identity }))
        .catch(() => ({ ok: false, identity: null }))
      esbuildProcesses.set(pid, inspection)
      void inspection.then(report => {
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
      for (const [pid, inspection] of esbuildProcesses) {
        const report = await inspection
        if (!report.ok) {
          notify({ type: 'process-reaped', pid, ok: false, status: 'identity-inspection-failed' })
          ok = false
          continue
        }
        if (!report.identity) {
          notify({ type: 'process-reaped', pid, ok: true, status: 'already-gone' })
          continue
        }
        const result = await processReaper.terminatePid(pid, report.identity)
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
        const code = copy(message.code)
        if (code.byteLength > maxBundleBytes) {
          finish(new SafeViewerError('BUNDLE_LIMIT', 'Compiled bundle exceeds its limit'))
          return
        }
        finish(null, code)
        return
      }
      if (message?.type === 'error') {
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
      if (!settled) finish(new SafeViewerError('BUILD_FAILED', 'Compilation process exited without a result'))
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
  testHooks = null,
} = {}) {
  check(Number.isSafeInteger(compileTimeoutMs) && compileTimeoutMs > 0, 'COMPILER_CONFIGURATION', 'Invalid compile timeout')
  check(Number.isSafeInteger(concurrency) && concurrency > 0, 'COMPILER_CONFIGURATION', 'Invalid compiler concurrency')
  const inFlight = new Map()
  const children = new Set()
  let active = 0
  let disposed = false
  let disposal
  let fused = false
  let cleanupFailures = 0

  function waitForJob(job, signal, cacheState) {
    if (signal?.aborted) return Promise.reject(new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled'))
    job.waiters++
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      const settle = action => {
        if (settled) return
        settled = true
        job.waiters--
        cleanup()
        action()
      }
      // The caller observes cancellation only after the compile process tree
      // has been retired by the job's own cleanup path.
      const onAbort = () => { if (!job.done) job.controller.abort() }
      signal?.addEventListener('abort', onAbort, { once: true })
      job.promise.then(
        value => settle(() => resolve({ ...value, cache: cacheState })),
        error => settle(() => reject(error)),
      )
    })
  }

  return Object.freeze({
    cache,
    stats: () => Object.freeze({
      ...cache.snapshot(),
      processes: children.size,
      fused,
      cleanupFailures,
    }),
    async compile(artifact, { signal } = {}) {
      check(!disposed, 'VIEWER_DISPOSED', 'Compiler disposed')
      check(!fused, 'COMPILER_QUARANTINED', 'Compiler cleanup is unresolved')
      if (signal?.aborted) throw new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled')
      const key = bundleKey(artifact.versionDigest)
      const cached = cache.get(key)
      if (cached) return { ...cached, cache: 'hit' }
      if (inFlight.has(key)) return waitForJob(inFlight.get(key), signal, 'hit')
      check(active < concurrency, 'COMPILER_BUSY', 'Compiler busy')
      active++
      const job = { waiters: 0, done: false, controller: new AbortController(), promise: null }
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
        children.clear()
        cache.clear()
      })()
      return disposal
    },
  })
}
