import { Worker } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { version as esbuildVersion } from 'esbuild-wasm'
import { LIMITS, POLICY_VERSION, SafeViewerError, check } from './policy.mjs'

const require = createRequire(import.meta.url)
const packageVersion = name => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version
const reactVersion = packageVersion('react')
const reactDomVersion = packageVersion('react-dom')

check(esbuildVersion === '0.25.12', 'TOOLCHAIN_VERSION_MISMATCH', 'esbuild version is not pinned')
check(reactVersion === '19.3.1' && reactDomVersion === '19.3.1', 'TOOLCHAIN_VERSION_MISMATCH', 'React version is not pinned')

const workerUrl = new URL('./compile-worker.mjs', import.meta.url)
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
} = {}) {
  const inFlight = new Map()
  const workers = new Set()
  let active = 0
  let disposed = false

  function compileInWorker(artifact, maxBundleBytes) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl, {
        type: 'module',
        workerData: { sources: artifact.sources, entry: artifact.manifest.entry, maxBundleBytes, runtimeSource },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      })
      workers.add(worker)
      let settled = false
      const finish = (error, result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        worker.removeAllListeners()
        workers.delete(worker)
        if (error) {
          worker.terminate().catch(() => {})
          reject(error)
        } else {
          resolve(result)
        }
      }
      const timer = setTimeout(() => finish(new SafeViewerError('COMPILE_TIMEOUT', 'Compilation timed out')), compileTimeoutMs)
      worker.once('message', message => {
        if (message?.ok === true && message.code) {
          finish(null, copy(message.code))
        } else {
          finish(new SafeViewerError(message?.code === 'BUNDLE_LIMIT' ? 'BUNDLE_LIMIT' : 'BUILD_FAILED', 'Compilation failed'))
        }
      })
      worker.once('error', () => finish(new SafeViewerError('BUILD_FAILED', 'Compilation worker failed')))
      worker.once('exit', code => {
        if (!settled && code !== 0) finish(new SafeViewerError('BUILD_FAILED', 'Compilation worker exited'))
      })
    })
  }

  return Object.freeze({
    cache,
    stats: () => cache.snapshot(),
    async compile(artifact) {
      check(!disposed, 'VIEWER_DISPOSED', 'Compiler disposed')
      const key = bundleKey(artifact.versionDigest)
      const cached = cache.get(key)
      if (cached) return { ...cached, cache: 'hit' }
      if (inFlight.has(key)) return { ...(await inFlight.get(key)), cache: 'hit' }
      check(active < concurrency, 'COMPILER_BUSY', 'Compiler busy')
      active++
      const job = (async () => {
        const maxBundleBytes = Math.min(artifact.build.maxBundleBytes, LIMITS.bundleBytes)
        const code = await compileInWorker(artifact, maxBundleBytes)
        const digest = sha256(code)
        const stored = cache.put(key, {
          code,
          bytes: code.byteLength,
          digest: `sha256:${digest}`,
          versionDigest: artifact.versionDigest,
        })
        return stored
      })()
      inFlight.set(key, job)
      try {
        return { ...(await job), cache: 'build' }
      } finally {
        inFlight.delete(key)
        active--
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const worker of workers) worker.terminate().catch(() => {})
      workers.clear()
      cache.clear()
    },
  })
}
