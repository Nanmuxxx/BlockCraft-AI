import { parentPort, workerData } from 'node:worker_threads'
import path from 'node:path'
import { build, stop } from 'esbuild'

const { sources, entry, maxBundleBytes, runtimeSource } = workerData

function loader(name) {
  return name.endsWith('.tsx') ? 'tsx' : 'ts'
}

function safePath(from, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  if (base.startsWith('../') || path.posix.isAbsolute(base)) return null
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
    .filter(candidate => Object.prototype.hasOwnProperty.call(sources, candidate))
  return candidates.length === 1 ? candidates[0] : null
}

try {
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
          if (args.path === 'react' || args.path === 'react/jsx-runtime' || args.path === 'react-dom/client') return undefined
          if (/(^|\/)node_modules\//.test(args.importer.replaceAll('\\', '/'))) return undefined
          if (args.path.startsWith('./') || args.path.startsWith('../')) {
            const resolved = safePath(args.importer.replace(/^\//, ''), args.path)
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
  if (code.byteLength > maxBundleBytes) throw new Error('BUNDLE_LIMIT')
  parentPort.postMessage({ ok: true, code })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    code: error?.message === 'BUNDLE_LIMIT' ? 'BUNDLE_LIMIT' : 'BUILD_FAILED',
  })
} finally {
  await stop().catch(() => {})
}
