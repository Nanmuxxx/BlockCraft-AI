import { execFile, fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { version as esbuildVersion } from 'esbuild-wasm'
import { LIMITS, POLICY_VERSION, SafeViewerError, check } from './policy.mjs'

const require = createRequire(import.meta.url)
const packageVersion = name => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version
const reactVersion = packageVersion('react')
const reactDomVersion = packageVersion('react-dom')

check(esbuildVersion === '0.25.12', 'TOOLCHAIN_VERSION_MISMATCH', 'esbuild version is not pinned')
check(reactVersion === '19.3.1' && reactDomVersion === '19.3.1', 'TOOLCHAIN_VERSION_MISMATCH', 'React version is not pinned')

const compileChildPath = fileURLToPath(new URL('./compile-child.mjs', import.meta.url))
const taskkillPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
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

function compilerEnvironment() {
  const allowed = [
    'PATH', 'Path', 'PATHEXT', 'ComSpec', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
    'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL',
  ]
  const environment = { NODE_ENV: 'production' }
  for (const key of allowed) {
    if (typeof process.env[key] === 'string') environment[key] = process.env[key]
  }
  return environment
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
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

async function terminateTree(child) {
  if (!child?.pid) return true
  if (processAlive(child.pid)) {
    if (process.platform === 'win32') {
      try {
        await new Promise(resolve => execFile(taskkillPath, ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 3_000,
          maxBuffer: 64 * 1024,
        }, () => resolve()))
      } catch {}
    } else {
      try { process.kill(-child.pid, 'SIGKILL') }
      catch { try { child.kill('SIGKILL') } catch {} }
    }
  }
  if (await waitForExit(child, 3_000)) return true
  try { child.kill('SIGKILL') } catch {}
  return waitForExit(child, 1_000)
}

async function waitForProcessesGone(pids, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  let alive = pids.filter(processAlive)
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50))
    alive = alive.filter(processAlive)
  }
  return alive
}

function compileInProcess(artifact, maxBundleBytes, compileTimeoutMs, signal, observer, activeChildren) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled'))
      return
    }
    let child
    try {
      child = fork(compileChildPath, [], {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        serialization: 'advanced',
        execArgv: ['--max-old-space-size=128', '--max-semi-space-size=32', '--stack-size=4096'],
        env: compilerEnvironment(),
        cwd: path.resolve(path.dirname(compileChildPath), '../..'),
      })
    } catch {
      reject(new SafeViewerError('BUILD_FAILED', 'Compilation process failed to start'))
      return
    }
    activeChildren.add(child)

    let settled = false
    const esbuildPids = new Set()
    const notify = event => {
      try { observer(Object.freeze({ ...event })) } catch {}
    }
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      void (async () => {
        let failure = error
        if (error) {
          const exited = await terminateTree(child)
          const leaked = await waitForProcessesGone([...esbuildPids])
          if (!exited || leaked.length > 0) {
            failure = new SafeViewerError('COMPILER_TERMINATION_FAILED', 'Compilation process tree did not terminate')
          }
          activeChildren.delete(child)
          reject(failure)
        } else {
          const exited = await waitForExit(child, 2_000)
          const leaked = exited ? await waitForProcessesGone([...esbuildPids]) : []
          if (!exited || leaked.length > 0) {
            await terminateTree(child)
            activeChildren.delete(child)
            reject(new SafeViewerError('COMPILER_TERMINATION_FAILED', 'Compilation process tree did not terminate'))
          } else {
            activeChildren.delete(child)
            resolve(result)
          }
        }
      })()
    }
    const onAbort = () => finish(new SafeViewerError('COMPILE_CANCELLED', 'Compilation cancelled'))
    const timer = setTimeout(
      () => finish(new SafeViewerError('COMPILE_TIMEOUT', 'Compilation timed out')),
      compileTimeoutMs,
    )

    notify({ type: 'compile-spawn', pid: child.pid })
    child.on('message', message => {
      if (message?.type === 'esbuild-child' && Number.isSafeInteger(message.pid) && message.pid > 0) {
        esbuildPids.add(message.pid)
        notify({ type: 'esbuild-spawn', pid: message.pid })
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
} = {}) {
  check(Number.isSafeInteger(compileTimeoutMs) && compileTimeoutMs > 0, 'COMPILER_CONFIGURATION', 'Invalid compile timeout')
  check(Number.isSafeInteger(concurrency) && concurrency > 0, 'COMPILER_CONFIGURATION', 'Invalid compiler concurrency')
  const inFlight = new Map()
  const children = new Set()
  let active = 0
  let disposed = false
  let disposal

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
    stats: () => Object.freeze({ ...cache.snapshot(), processes: children.size }),
    async compile(artifact, { signal } = {}) {
      check(!disposed, 'VIEWER_DISPOSED', 'Compiler disposed')
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
          )
          const digest = sha256(code)
          return cache.put(key, {
            code,
            bytes: code.byteLength,
            digest: `sha256:${digest}`,
            versionDigest: artifact.versionDigest,
          })
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
      for (const job of inFlight.values()) job.controller.abort()
      disposal = Promise.all([...children].map(child => terminateTree(child))).finally(() => {
        children.clear()
        cache.clear()
      })
      return disposal
    },
  })
}
