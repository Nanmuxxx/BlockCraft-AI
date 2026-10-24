import ts from 'typescript'
import { packageLock } from './package-lock.mjs'
import { protocol, json } from '../../server/custom-block/protocol.mjs'
import { checkImports } from '../../server/custom-block/import-policy.mjs'
import { PACKAGE_PINS } from '../../server/custom-block/policy.mjs'
import { ProjectExportError, ensure, assertOutputPath, encodeProjectZip } from './zip.mjs'
import * as templates from './templates.mjs'

export { ProjectExportError, ZIP_LIMITS } from './zip.mjs'
export const EXPORT_PROFILE = 'react-props-local-v1'
export const EXPORT_LIMITS = Object.freeze({ maxArtifacts: 32, maxArtifactSourceBytes: 1048576, maxBlocks: 128 })
const encoder = new TextEncoder()
// Keep generated modules below the ZIP per-file cap while retaining the original
// data URL in the generated project's in-memory model.
const ASSET_CHUNK_CHARS = 180000
const key = ref => `${ref.definitionId}/${ref.versionDigest}`
const stringify = value => json.canonicalJson(value)
const content = value => `${stringify(value)}\n`
const preserved = new Set(['VERSION_MISSING', 'DIGEST_MISMATCH', 'LIMIT'])
function guarded(action, fallback) {
  try { return action() } catch (error) {
    if (error instanceof ProjectExportError) throw error
    const reason = fallback === 'UNSUPPORTED_SOURCE' && /^[A-Z_]{1,64}$/.test(error?.code ?? '') ? error.code : undefined
    throw new ProjectExportError(preserved.has(error?.code) ? error.code : fallback, reason)
  }
}
function checkPrivateText(text) {
  // Defense in depth, not a universal DLP classifier. No environment or host reads.
  ensure(!/(?:\/(?:Users|home|private|etc|var|root|Volumes)\/|[A-Za-z]:[\\/]+(?:Users|Windows)[\\/]+|file:\/\/)/i.test(text), 'PRIVATE_CONTENT')
  ensure(!/(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{12,})/i.test(text), 'PRIVATE_CONTENT')
  ensure(!/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|authorization)["'\s]*[:=]/i.test(text), 'PRIVATE_CONTENT')
  ensure(!/(?:\.env\b|process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env)/i.test(text), 'PRIVATE_CONTENT')
}
function sourcePolicy(artifact) {
  const manifest = artifact.manifest
  ensure(manifest.requestedCapabilities.length === 0 && Object.keys(manifest.events).length === 0 && Object.keys(manifest.stateSchema.properties).length === 0, 'UNSUPPORTED_PROTOCOL')
  ensure(Object.hasOwn(artifact.dependencies, 'react'), 'UNSUPPORTED_DEPENDENCY')
  for (const [name, dependency] of Object.entries(artifact.dependencies)) {
    ensure(Object.hasOwn(PACKAGE_PINS, name) && stringify(dependency) === stringify(PACKAGE_PINS[name]), 'UNSUPPORTED_DEPENDENCY')
  }
  // Every source is checked, even unreachable sources. The shared generation
  // parser checks syntax, bounded complexity, exact imports, reachability and entry.
  guarded(() => checkImports(artifact), 'UNSUPPORTED_SOURCE')
  const forbidden = new Set(['window', 'document', 'globalThis', 'parent', 'top', 'opener', 'frames', 'self', 'postMessage', 'MessageChannel', 'MessagePort', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'location', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'process'])
  // DOM event/ref objects expose Window through properties that deliberately do
  // not spell "window". The token scanner alone misses `event.view`,
  // `node.ownerDocument.defaultView` and `iframe.contentWindow`.
  const forbiddenWindowHandles = new Set(['view', 'defaultView', 'contentWindow', 'ownerDocument', 'parentWindow'])
  for (const [path, source] of Object.entries(artifact.sources)) {
    assertOutputPath(`src/components/custom/a/${path}`)
    checkPrivateText(source)
    // Conservative host-protocol admission, not a JS security analysis. Reject
    // ambiguous indirect globals instead of claiming to support their runtime.
    const scanner = ts.createScanner(ts.ScriptTarget.ES2020, true, ts.LanguageVariant.JSX, source)
    let token
    while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
      if (token === ts.SyntaxKind.Identifier) ensure(!forbidden.has(scanner.getTokenValue()), 'UNSUPPORTED_PROTOCOL')
    }
    ensure(!/\bimport\s*\.\s*meta\b/.test(source), 'UNSUPPORTED_SOURCE')
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2020, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const stack = [file]
    while (stack.length) {
      const node = stack.pop()
      if (ts.isPropertyAccessExpression(node)) ensure(!forbiddenWindowHandles.has(node.name.text), 'UNSUPPORTED_PROTOCOL')
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
        ensure(!forbiddenWindowHandles.has(node.argumentExpression.text), 'UNSUPPORTED_PROTOCOL')
      }
      ts.forEachChild(node, child => { stack.push(child) })
    }
  }
}

/**
 * Pure export boundary: JSON snapshot + already-resolved exact Registry entries.
 * No Registry callback, IO, fetch, subprocess, owner, Runtime or code execution.
 * Validation is repeated here; callers cannot bypass it with a "validated" flag.
 */
export async function exportProjectZip(input, options = {}) {
  guarded(() => { protocol.assertProjectJson(input); json.object(input); json.keys(input, ['project', 'artifacts']) }, 'INVALID_INPUT')
  const snapshot = json.cloneJson(input)
  ensure(snapshot.project?.base?.spec?.version === 1, 'UNSUPPORTED_APP_SPEC')
  ensure(!snapshot.project.base.spec.blocks.some(block => ['filter', 'chart', 'details'].includes(block.type)), 'UNSUPPORTED_INTERACTIVE_EXPORT')
  guarded(() => { protocol.assertJson(options); json.object(options); json.keys(options, [], ['filename', 'limits']) }, 'INVALID_OPTIONS')
  const settings = json.cloneJson(options)
  const filename = settings.filename ?? 'blockcraft-project.zip'
  ensure(typeof filename === 'string' && filename.length <= 80 && /^[a-z0-9][a-z0-9_-]*\.zip$/.test(filename) && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\.zip$/i.test(filename), 'INVALID_FILENAME')
  checkPrivateText(stringify(snapshot.project))
  ensure(Array.isArray(snapshot.artifacts) && snapshot.artifacts.length <= EXPORT_LIMITS.maxArtifacts, 'ARTIFACT_COUNT_LIMIT')
  const artifacts = new Map()
  let sourceBytes = 0
  for (const entry of snapshot.artifacts) {
    guarded(() => { json.object(entry); json.keys(entry, ['versionDigest', 'artifact']); json.object(entry.artifact); json.object(entry.artifact.dependencies) }, 'INVALID_ARTIFACT')
    for (const [name, dependency] of Object.entries(entry.artifact.dependencies)) {
      ensure(Object.hasOwn(PACKAGE_PINS, name) && stringify(dependency) === stringify(PACKAGE_PINS[name]), 'UNSUPPORTED_DEPENDENCY')
    }
    guarded(() => protocol.assertSourceArtifact(entry.artifact), 'INVALID_ARTIFACT')
    // Enforce the standalone source profile before passing entries to parser.
    sourcePolicy(entry.artifact)
    sourceBytes += Object.values(entry.artifact.sources).reduce((total, text) => total + encoder.encode(text).length, 0)
    ensure(sourceBytes <= EXPORT_LIMITS.maxArtifactSourceBytes, 'SOURCE_SIZE_LIMIT')
    const reference = { definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest }
    const referenceKey = key(reference)
    ensure(!artifacts.has(referenceKey), 'DUPLICATE_ARTIFACT')
    let verified
    try { verified = await protocol.resolveArtifact({ resolve: async () => entry }, reference) }
    catch (error) { throw new ProjectExportError(preserved.has(error?.code) ? error.code : 'INVALID_ARTIFACT') }
    artifacts.set(referenceKey, verified)
  }
  let project
  try { project = await protocol.parseCustomProject(snapshot.project, { resolve: async ref => artifacts.get(key(ref)) }) }
  catch (error) { throw new ProjectExportError(preserved.has(error?.code) ? error.code : 'INVALID_PROJECT') }
  ensure(project.renderOrder.length <= EXPORT_LIMITS.maxBlocks, 'BLOCK_COUNT_LIMIT')
  ensure(Object.keys(project.custom.states).length === 0, 'UNSUPPORTED_PROTOCOL')
  const used = new Set(project.custom.instances.map(key))
  ensure(used.size === artifacts.size, 'UNUSED_ARTIFACT')
  const ordered = [...artifacts.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  const ids = new Map(ordered.map(([ref], index) => [ref, `a${index}`]))
  const imports = ordered.map(([ref, entry]) => {
    const path = entry.artifact.manifest.entry.replace(/\.tsx?$/, '')
    return `import Custom_${ids.get(ref)} from ${JSON.stringify(`./components/custom/${ids.get(ref)}/${path}`)};`
  }).join('\n')
  const cases = project.custom.instances.map(instance => `${JSON.stringify(instance.id)}: Custom_${ids.get(key(instance))}`).join(', ')
  const files = []
  const add = (path, text) => { assertOutputPath(path); files.push({ path, content: text }) }
  add('package.json', content(templates.packageJson))
  add('package-lock.json', content(packageLock))
  add('tsconfig.json', content(templates.tsconfig))
  add('index.html', '<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Independent App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n')
  add('vite.config.ts', "import { defineConfig } from 'vite';\nexport default defineConfig({ base: './', server: { host: '127.0.0.1' } });\n")
  add('src/main.tsx', templates.main)
  add('src/App.tsx', templates.app(imports, cases))
  add('src/model.ts', templates.model)
  // Asset payloads are emitted as static chunks so their aggregate size cannot
  // overflow src/data.ts or ZIP_LIMITS.maxFileBytes. Static imports reconstruct
  // the exact original data URLs at module evaluation time.
  const dataProject = structuredClone(project)
  const assetImports = []
  const assetAssignments = []
  for (const [index, [assetId, asset]] of Object.entries(dataProject.base.assets ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).entries()) {
    const parts = []
    for (let offset = 0, part = 0; offset < asset.dataUrl.length; offset += ASSET_CHUNK_CHARS, part++) {
      const value = asset.dataUrl.slice(offset, offset + ASSET_CHUNK_CHARS)
      const path = `src/assets/asset-${index}-part-${part}.ts`
      const alias = `asset_${index}_${part}`
      add(path, `export default ${JSON.stringify(value)};\n`)
      assetImports.push(`import ${alias} from './assets/asset-${index}-part-${part}';`)
      parts.push(alias)
    }
    asset.dataUrl = ''
    assetAssignments.push(`project.base.assets![${JSON.stringify(assetId)}].dataUrl = [${parts.join(', ')}].join('');`)
  }
  // Contextual JSON escaping: U+2028/29 are escaped; data never becomes JSX/HTML.
  const dataSource = stringify(dataProject).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  add('src/data.ts', `import type { Project } from './model';\n${assetImports.join('\n')}${assetImports.length ? '\n' : ''}export const project: Project = ${dataSource};\n${assetAssignments.join('\n')}${assetAssignments.length ? '\n' : ''}`)
  add('src/components/FormBlock.tsx', templates.form)
  add('src/components/ListBlock.tsx', templates.list)
  add('src/components/MetricBlock.tsx', templates.metric)
  add('src/components/GalleryBlock.tsx', templates.gallery)
  add('src/styles.css', templates.css)
  add('README.md', templates.readme)
  add('provenance.json', content({ formatVersion: 1, profile: EXPORT_PROFILE, projectRevision: project.revision, artifacts: ordered.map(([, entry]) => ({ definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest })) }))
  for (const [ref, entry] of ordered) for (const path of Object.keys(entry.artifact.sources).sort()) add(`src/components/custom/${ids.get(ref)}/${path}`, entry.artifact.sources[path])
  const zip = encodeProjectZip(files, settings.limits)
  return { filename, bytes: zip, files: files.map(file => ({ path: file.path, bytes: encoder.encode(file.content).length })).sort((a, b) => a.path < b.path ? -1 : 1) }
}
