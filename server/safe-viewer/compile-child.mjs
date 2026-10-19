import childProcess from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build, initialize, stop } from 'esbuild-wasm'

const require = createRequire(import.meta.url)
const children = new Set()
const originalSpawn = childProcess.spawn
let testFault = null

function report(message) {
  return new Promise(resolve => {
    if (!process.connected || typeof process.send !== 'function') {
      resolve(false)
      return
    }
    process.send(message, error => resolve(!error))
  })
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

childProcess.spawn = function guardedSpawn(command, args, options) {
  const child = originalSpawn.call(this, command, args, options)
  if (Array.isArray(args) && args.some(value => /^--service=0\.25\.12$/.test(value))) {
    children.add(child)
    child.once('exit', () => children.delete(child))
    if (Number.isSafeInteger(child.pid) && child.pid > 0) {
      const message = { type: 'esbuild-child', pid: child.pid }
      if (testFault === 'crash-after-esbuild') {
        void report(message).then(() => process.exit(70))
      } else {
        void report(message)
      }
    }
  }
  return child
}

async function stopEsbuild() {
  try { await stop() } catch {}
  for (const child of children) {
    if (!(await waitForExit(child, 2_000))) {
      try { child.kill('SIGKILL') } catch {}
      if (!(await waitForExit(child, 1_000))) return false
    }
  }
  return true
}

let finishing = false
async function finish(message, exitCode) {
  if (finishing) return
  finishing = true
  const clean = await stopEsbuild()
  if (!clean) {
    await report({ type: 'error', code: 'CHILD_TERMINATION_FAILED' })
    process.exit(1)
  }
  await report(message)
  process.disconnect?.()
  process.exit(exitCode)
}

process.once('disconnect', () => {
  if (finishing) return
  finishing = true
  void stopEsbuild().finally(() => process.exit(1))
})

function loader(name) {
  return name.endsWith('.tsx') ? 'tsx' : 'ts'
}

function safePath(sources, from, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  if (base.startsWith('../') || path.posix.isAbsolute(base)) return null
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
    .filter(candidate => Object.prototype.hasOwnProperty.call(sources, candidate))
  return candidates.length === 1 ? candidates[0] : null
}

async function compile(task) {
  const { sources, entry, maxBundleBytes, runtimeSource } = task
  await initialize()
  const result = await build({
    stdin: {
      contents: `import { mountViewer } from "/__blockcraft_runtime__.js";\nmountViewer(() => import(${JSON.stringify(`./${entry}`)}));\n`,
      resolveDir: '/',
      sourcefile: 'safe-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    jsxImportSource: 'react',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    splitting: false,
    logLevel: 'silent',
    plugins: [{
      name: 'blockcraft-safe-sources',
      setup(context) {
        context.onResolve({ filter: /.*/ }, args => {
          if (args.path === '/__blockcraft_runtime__.js') return { path: '/__blockcraft_runtime__.js', namespace: 'blockcraft-runtime' }
          if (args.path === 'react' || args.path === 'react/jsx-runtime' || args.path === 'react-dom/client') {
            return { path: require.resolve(args.path) }
          }
          if (/(^|\/)node_modules\//.test(args.importer.replaceAll('\\', '/'))) return undefined
          if (args.path.startsWith('./') || args.path.startsWith('../')) {
            const resolved = safePath(sources, args.importer.replace(/^\//, ''), args.path)
            if (!resolved) return { errors: [{ text: 'IMPORT_RESOLUTION' }] }
            return { path: `/${resolved}`, namespace: 'blockcraft-source' }
          }
          return { errors: [{ text: 'IMPORT_REJECTED' }] }
        })
        context.onLoad({ filter: /.*/, namespace: 'blockcraft-runtime' }, () => ({
          contents: runtimeSource,
          loader: 'js',
          resolveDir: '/',
        }))
        context.onLoad({ filter: /.*/, namespace: 'blockcraft-source' }, args => {
          const name = args.path.replace(/^\//, '')
          if (!Object.prototype.hasOwnProperty.call(sources, name)) return { errors: [{ text: 'IMPORT_RESOLUTION' }] }
          return { contents: sources[name], loader: loader(name), resolveDir: `/${path.posix.dirname(name)}` }
        })
      },
    }],
  })
  const files = result.outputFiles ?? []
  if (files.length !== 1) throw new Error('Unexpected build output')
  const code = files[0].contents
  if (code.byteLength > maxBundleBytes) {
    const error = new Error('BUNDLE_LIMIT')
    error.code = 'BUNDLE_LIMIT'
    throw error
  }
  return code
}

process.once('message', task => {
  testFault = process.env.BLOCKCRAFT_SAFE_VIEWER_TEST_FAULTS === '1' ? task.testFault : null
  void (async () => {
    try {
      const code = await compile(task)
      await finish({ type: 'result', code }, 0)
    } catch (error) {
      await finish({
        type: 'error',
        code: error?.code === 'BUNDLE_LIMIT' ? 'BUNDLE_LIMIT' : 'BUILD_FAILED',
        detail: String(error?.message ?? error).slice(0, 500),
      }, 1)
    }
  })()
})
