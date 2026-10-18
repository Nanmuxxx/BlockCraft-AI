// Deliberately compiles ONLY two immutable repository fixtures. No source/path/options input.
import path from 'node:path'
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { verifySupply, compilerRoot } from './supply.mjs'
import { trustedSample } from './trusted-samples.mjs'
import { validateBuildEntry, demand, sha256, canonicalDigest } from './policy.mjs'

async function main() {
  demand(process.argv.length === 3 && ['counter', 'temperature'].includes(process.argv[2]), 'TRUSTED_SAMPLE_ONLY')
  demand(process.version === 'v24.22.0', 'NODE_VERSION')
  const supply = await verifySupply()
  const entry = await trustedSample(process.argv[2])
  const reference = { definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest }
  await validateBuildEntry(entry, reference)
  // Only verified, fixed trusted compiler code enters Node's loader. Never the artifact.
  const binary = path.join(compilerRoot, 'node_modules', `@esbuild/${supply.platform}`, 'bin/esbuild')
  // No caller-supplied binary override or esbuild plugin is accepted.
  process.env.ESBUILD_BINARY_PATH = binary
  const require = createRequire(import.meta.url)
  const esbuild = require('./node_modules/esbuild/lib/main.js')
  demand(esbuild.version === '0.25.12', 'COMPILER_VERSION')
  const root = await realpath(path.join(compilerRoot, 'node_modules'))
  const allowedPackages = new Set(['react', 'react-dom', 'scheduler'])
  const packageEntries = {
    react: 'react/index.js', 'react/jsx-runtime': 'react/jsx-runtime.js',
    'react-dom': 'react-dom/index.js', 'react-dom/client': 'react-dom/client.js', scheduler: 'scheduler/index.js',
  }
  const sources = entry.artifact.sources
  const bootstrap = `import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport Component from './${entry.artifact.manifest.entry}';\nexport default Component;\nexport function mount(root, props) { const app = createRoot(root); app.render(React.createElement(Component, props)); return () => app.unmount(); }\n`
  const inputFiles = new Map()
  const resolver = {
    name: 'fixed-memory-resolver',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.kind === 'entry-point') return { path: 'bootstrap', namespace: 'bootstrap' }
        if (Object.hasOwn(packageEntries, args.path)) {
          if (args.namespace !== 'package' && args.path !== 'scheduler') {
            const pkg = args.path.startsWith('react-dom') ? 'react-dom' : 'react'
            demand(Object.hasOwn(entry.artifact.dependencies, pkg), 'UNDECLARED_DEPENDENCY')
          }
          demand(args.namespace === 'package' || args.path !== 'scheduler', 'TRANSITIVE_IMPORT_DENIED')
          return { path: packageEntries[args.path], namespace: 'package' }
        }
        demand(args.path.startsWith('./') || args.path.startsWith('../'), 'IMPORT_DENIED')
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path))
        demand(!base.startsWith('../') && !path.posix.isAbsolute(base), 'PATH_ESCAPE')
        if (args.namespace === 'package') {
          demand(allowedPackages.has(base.split('/')[0]) && base.split('/')[0] === args.importer.split('/')[0], 'PACKAGE_ESCAPE')
          return { path: base, namespace: 'package' }
        }
        const matches = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].filter(file => Object.hasOwn(sources, file))
        demand(matches.length === 1, 'IMPORT_RESOLUTION')
        return { path: matches[0], namespace: 'artifact' }
      })
      build.onLoad({ filter: /.*/, namespace: 'bootstrap' }, () => ({ contents: bootstrap, loader: 'js' }))
      build.onLoad({ filter: /.*/, namespace: 'artifact' }, args => ({ contents: sources[args.path], loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' }))
      build.onLoad({ filter: /.*/, namespace: 'package' }, async args => {
        const filename = await realpath(path.join(root, args.path))
        demand(filename.startsWith(root + path.sep) && allowedPackages.has(args.path.split('/')[0]), 'PACKAGE_ESCAPE')
        const bytes = await readFile(filename)
        inputFiles.set(args.path, sha256(bytes))
        return { contents: bytes.toString('utf8'), loader: 'js' }
      })
    },
  }
  try {
    const result = await esbuild.build({
      absWorkingDir: compilerRoot, entryPoints: ['bootstrap'], bundle: true, write: false,
      platform: 'browser', format: 'esm', target: 'es2020', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' }, minify: true, sourcemap: false,
      legalComments: 'eof', treeShaking: true, logLevel: 'silent', metafile: true,
      plugins: [resolver],
    })
    demand(result.outputFiles.length === 1 && result.warnings.length === 0, 'UNEXPECTED_OUTPUT')
    const bundle = Buffer.from(result.outputFiles[0].contents)
    demand(bundle.length > 0 && bundle.length <= entry.artifact.build.maxBundleBytes, 'BUNDLE_LIMIT')
    const output = Object.values(result.metafile.outputs)
    demand(output.length === 1 && output[0].imports.length === 0, 'EXTERNAL_IMPORT_REMAINS')
    demand(Object.keys(result.metafile.inputs).every(name => /^(bootstrap|artifact|package):/.test(name)), 'UNEXPECTED_BUILD_INPUT')
    // Recheck all verified installed bytes after the compiler has finished.
    demand(canonicalDigest(await verifySupply()) === canonicalDigest(supply), 'SUPPLY_CHANGED_DURING_BUILD')
    const receipt = {
      contractVersion: 1, status: 'compiled', execution: 'denied', reference,
      sourceDigest: entry.versionDigest, sourcesDigest: canonicalDigest(sources),
      bundleDigest: sha256(bundle), bundleBytes: bundle.length,
      toolchain: { name: 'esbuild', version: esbuild.version, binaryDigest: supply.binaryDigest,
        node: process.version, parser: 'typescript@5.9.3', sdk: '1.0.0',
        driverDigest: sha256(await readFile(new URL('./worker.mjs', import.meta.url))) },
      profile: entry.artifact.build, supply,
      packageInputs: Object.fromEntries([...inputFiles].sort(([a], [b]) => a.localeCompare(b))),
      bootstrapDigest: sha256(bootstrap),
      isolation: { build: 'trusted-fixture-subprocess-only', execution: 'unverified' },
      provenance: 'repository-developer-fixture',
    }
    process.stdout.write(JSON.stringify({ receipt, bundle: bundle.toString('base64') }))
  } finally { esbuild.stop() }
}

main().catch(() => { process.stderr.write('TRUSTED_BUILD_FAILED\n'); process.exitCode = 1 })
