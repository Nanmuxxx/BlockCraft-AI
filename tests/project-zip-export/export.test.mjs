import test from 'node:test'
import ts from 'typescript'
import { recordOperations } from '../../tools/project-zip-export/templates.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { builtin, mixed, rehash, unzip, createAppRuntime, createClubRegistrationExample } from './fixtures.mjs'
import { protocol } from '../../server/custom-block/protocol.mjs'
import { exportProjectZip } from '../../tools/project-zip-export/export.mjs'
import { encodeProjectZip, ZIP_LIMITS } from '../../tools/project-zip-export/zip.mjs'
import { exportSessionSnapshot } from '../../tools/project-zip-export/integration.example.mjs'

test('builtins produce a full standalone archive, fixed scripts and configured data', async () => {
  const input = builtin(), result = await exportProjectZip(input), files = unzip(result.bytes)
  assert.equal(files.size, 15)
  for (const name of ['package.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'src/main.tsx', 'src/App.tsx', 'src/components/FormBlock.tsx', 'src/components/ListBlock.tsx', 'src/components/MetricBlock.tsx', 'src/styles.css', 'README.md']) assert.ok(files.has(name), name)
  const pkg = JSON.parse(files.get('package.json'))
  assert.equal(pkg.dependencies.react, '19.3.1'); assert.equal(pkg.scripts.build, 'tsc --noEmit && vite build')
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['build', 'dev', 'preview'])
  assert.ok(!files.get('src/App.tsx').includes('BlockCraft'))
  assert.ok(files.get('src/data.ts').includes('applicant-name'))
  assert.deepEqual(result.files.map(file => file.path), [...files.keys()])
})
test('exported list exposes update flow that preserves ids and clears stale editing state', async () => {
  const files = unzip((await exportProjectZip(builtin())).bytes)
  const app = files.get('src/App.tsx')
  const list = files.get('src/components/ListBlock.tsx')
  const form = files.get('src/components/FormBlock.tsx')
  assert.match(list, /onClick=\{\(\) => onEdit\(row\.id\)\}/)
  assert.match(list, /onUpdate\(editing\.id, values\)/)
  assert.match(form, /initial \? '保存修改' : '保存'/)
  assert.match(app, /updateRows\(own\(current, entity\)/)
  assert.match(app, /current\?\.entity === entity && current\.id === id \? null : current/)
})
test('real TSX, helper module, exact digest, props, coordinates and interleaved order survive', async () => {
  const input = await mixed(), result = await exportProjectZip(input), files = unzip(result.bytes)
  const dataText = files.get('src/data.ts')
  const data = JSON.parse(dataText.slice(dataText.indexOf(' = ') + 3, dataText.lastIndexOf(';')))
  assert.deepEqual(data, input.project)
  assert.equal(data.renderOrder[0].id, 'temperature')
  assert.equal(data.custom.instances[0].props.initial, 7)
  const provenance = JSON.parse(files.get('provenance.json'))
  for (const entry of input.artifacts) {
    assert.ok(provenance.artifacts.some(ref => ref.definitionId === entry.artifact.manifest.definitionId && ref.versionDigest === entry.versionDigest))
    for (const [path, source] of Object.entries(entry.artifact.sources)) assert.ok([...files].some(([name, text]) => name.endsWith('/' + path) && text === source))
  }
  assert.ok(files.get('src/App.tsx').includes('project.renderOrder.map'))
  assert.ok(files.get('src/styles.css').includes('var(--x)'))
})
test('bytes deterministic across repeated runs, JSON key order, registry entry order; no mutations', async () => {
  const input = await mixed(), before = structuredClone(input)
  const first = await exportProjectZip(input), second = await exportProjectZip(input)
  assert.deepEqual(first.bytes, second.bytes); assert.deepEqual(input, before)
  const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value
  const reordered = reverse(input); reordered.artifacts.reverse()
  assert.deepEqual((await exportProjectZip(reordered)).bytes, first.bytes)
})
test('captures input before async digest; concurrent caller mutation cannot change exported source or data', async () => {
  const input = await mixed(), before = structuredClone(input)
  const pending = exportProjectZip(input)
  input.project.custom.instances[0].props.initial = 999
  input.artifacts[0].artifact.sources['Counter.tsx'] = 'tampered after call'
  assert.deepEqual((await pending).bytes, (await exportProjectZip(before)).bytes)
})
test('missing exact version refuses rather than resolving another version', async () => {
  const input = await mixed(); input.artifacts.pop()
  await assert.rejects(exportProjectZip(input), { code: 'VERSION_MISSING' })
})
test('tampered source, swapped digest and wrong definition refuse', async () => {
  for (const mutate of [input => { input.artifacts[0].artifact.sources['Counter.tsx'] += '\n//changed' }, input => { input.artifacts[0].versionDigest = 'sha256:' + 'f'.repeat(64) }, input => { input.project.custom.instances[0].definitionId = 'another-definition' }]) {
    const input = await mixed(); mutate(input)
    await assert.rejects(exportProjectZip(input), error => ['DIGEST_MISMATCH', 'VERSION_MISSING'].includes(error.code))
  }
})
test('props Schema, duplicate order and invalid layout refuse', async () => {
  for (const mutate of [input => { input.project.custom.instances[0].props.initial = 'wrong' }, input => { input.project.renderOrder[0] = input.project.renderOrder[1] }, input => { input.project.custom.positions.counter.x = 2 }]) {
    const input = await mixed(); mutate(input)
    await assert.rejects(exportProjectZip(input), { code: 'INVALID_PROJECT' })
  }
})
test('source is inert even when valid syntax would throw on import', async () => {
  const input = await mixed()
  input.artifacts[0].artifact.sources['Counter.tsx'] = "throw new Error('MUST_NEVER_EXECUTE'); export default function Component() { return <div>inert</div> }"
  await rehash(input)
  assert.ok((await exportProjectZip(input)).bytes.length > 0)
})
test('export path has no IO, network, runtime, dynamic import or subprocess capability', async () => {
  // Module graph is fixed and reviewed: import-policy only parses strings, protocol
  // only validates/hashes. These guards also detect accidental fetch use at runtime.
  const fetch = globalThis.fetch, WebSocket = globalThis.WebSocket
  globalThis.fetch = () => { throw new Error('NETWORK_USED') }
  globalThis.WebSocket = class { constructor() { throw new Error('NETWORK_USED') } }
  try {
    const input = await mixed(), frozen = structuredClone(input)
    await exportProjectZip(input)
    assert.deepEqual(input, frozen)
    for (const module of ['export.mjs', 'zip.mjs', 'templates.mjs']) {
      const text = readFileSync(new URL('../../tools/project-zip-export/' + module, import.meta.url), 'utf8')
      assert.ok(!/from ['"]node:(?:fs|http|https|net|child_process|vm)|\beval\s*\(|\bimport\s*\(/.test(text))
    }
  } finally { globalThis.fetch = fetch; globalThis.WebSocket = WebSocket }
})
for (const path of ['../evil.tsx', '/evil.tsx', 'C:/evil.tsx', 'src/../../evil.tsx', 'src\\evil.tsx', '.env', 'src/.env', 'src/secret.key', 'src/CON.tsx', 'src/%2e%2e/a.ts']) test('reject output path ' + path, () => {
  assert.throws(() => encodeProjectZip([{ path, content: '' }]), { code: 'OUTPUT_PATH' })
})
for (const filename of ['../app.zip', '/app.zip', 'evil.zip.exe', 'con.zip', 'a'.repeat(81) + '.zip', 'C:\\app.zip', '.env.zip']) test('reject filename ' + filename.slice(0, 25), async () => {
  await assert.rejects(exportProjectZip(builtin(), { filename }), { code: 'INVALID_FILENAME' })
})
test('archive bounds include UTF-8, exact total, count, collisions and prohibit raising hard caps', async () => {
  assert.throws(() => encodeProjectZip(Array.from({ length: ZIP_LIMITS.maxFiles + 1 }, (_, i) => ({ path: `src/a${i}.ts`, content: '' }))), { code: 'FILE_COUNT_LIMIT' })
  assert.throws(() => encodeProjectZip([{ path: 'src/a.ts', content: '中'.repeat(174763) }]), { code: 'FILE_SIZE_LIMIT' })
  const files = Array.from({ length: 8 }, (_, i) => ({ path: `src/a${i}.ts`, content: 'x'.repeat(524288) }))
  assert.ok(encodeProjectZip(files).length > ZIP_LIMITS.maxTotalBytes)
  assert.throws(() => encodeProjectZip([...files, { path: 'src/more.ts', content: 'x' }]), { code: 'TOTAL_SIZE_LIMIT' })
  assert.throws(() => encodeProjectZip([{ path: 'src/a.ts', content: '' }, { path: 'src/A.ts', content: '' }]), { code: 'OUTPUT_COLLISION' })
  assert.throws(() => encodeProjectZip([{ path: 'src/a.ts', content: 'x' }], { maxTotalBytes: 9999999 }), { code: 'LIMIT_CONFIG' })
  for (const [limits, code] of [[{ maxFiles: 1 }, 'FILE_COUNT_LIMIT'], [{ maxFileBytes: 1 }, 'FILE_SIZE_LIMIT'], [{ maxTotalBytes: 1 }, 'TOTAL_SIZE_LIMIT'], [{ maxZipBytes: 22 }, 'ZIP_SIZE_LIMIT']]) await assert.rejects(exportProjectZip(builtin(), { limits }), { code })
})
for (const value of ['sk-' + 'x'.repeat(30), '/Users/private/person.txt', 'C:\\Users\\name\\secret', 'apiKey="example-secret"', '.env.local', 'Bearer ' + 'a'.repeat(20)]) test('reject private input ' + value.slice(0, 12), async () => {
  const input = builtin(); input.project.base.spec.name = value
  await assert.rejects(exportProjectZip(input), { code: 'PRIVATE_CONTENT' })
})
test('artifact source paths/count/size and unknown dependencies refuse', async () => {
  for (const mutate of [a => { a.sources['../escape.tsx'] = '' }, a => { a.sources['.env'] = 'secret' }, a => { a.sources = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}.tsx`, ''])); a.sources['Counter.tsx'] = '' }, a => { a.sources['Counter.tsx'] = 'x'.repeat(262145) }, a => { a.dependencies.evil = { version: '1', integrity: 'bad' } }, a => { a.build.scripts = { preinstall: 'bad' } }]) {
    const input = await mixed(); mutate(input.artifacts[0].artifact)
    await assert.rejects(exportProjectZip(input), error => ['INVALID_ARTIFACT', 'LIMIT', 'UNSUPPORTED_DEPENDENCY'].includes(error.code))
  }
})
test('forged SRI cannot authorize dependency, even with recomputed digest', async () => {
  const input = await mixed(); input.artifacts[0].artifact.dependencies.react.integrity = `sha512-${'A'.repeat(86)}==`
  await rehash(input); await assert.rejects(exportProjectZip(input), { code: 'UNSUPPORTED_DEPENDENCY' })
})
for (const [name, source, code] of [
  ['unknown import', "import x from 'evil'; export default function C() {return x}", 'UNSUPPORTED_SOURCE'],
  ['undeclared react-dom', "import { createRoot } from 'react-dom/client'; export default function C() {return null}", 'UNSUPPORTED_SOURCE'],
  ['dynamic import', "export default function C() {import('react'); return null}", 'UNSUPPORTED_SOURCE'],
  ['require', "export default function C() {require('react'); return null}", 'UNSUPPORTED_SOURCE'],
  ['syntax error', 'export default function (', 'UNSUPPORTED_SOURCE'],
  ['missing default', 'export const a = 1', 'UNSUPPORTED_SOURCE'],
  ['escaping import', "import x from '../outside'; export default function C() {return x}", 'UNSUPPORTED_SOURCE'],
  ['host protocol', "export default function C() {parent.postMessage('x', '*'); return null}", 'UNSUPPORTED_PROTOCOL'],
  ['network source', "export default function C() {fetch('https://example.com'); return null}", 'UNSUPPORTED_PROTOCOL'],
  ['window through event.view', "export default function C() {return <button onClick={event => event.view.open('https://example.com')}>x</button>}", 'UNSUPPORTED_PROTOCOL'],
  ['window through event string subscript', "export default function C() {return <button onClick={event => event['view'].open('https://example.com')}>x</button>}", 'UNSUPPORTED_PROTOCOL'],
  ['window through ownerDocument.defaultView', "export default function C() {return <div ref={node => node?.ownerDocument.defaultView?.open('https://example.com')}>x</div>}", 'UNSUPPORTED_PROTOCOL'],
  ['window through iframe.contentWindow', "export default function C() {return <iframe ref={node => node?.contentWindow?.open('https://example.com')} />}", 'UNSUPPORTED_PROTOCOL'],
  ['private source', "// /Users/private/code\nexport default function C() {return null}", 'PRIVATE_CONTENT'],
]) test('refuse ' + name, async () => {
  const input = await mixed(); input.artifacts[0].artifact.sources['Counter.tsx'] = source
  if (name === 'undeclared react-dom') delete input.artifacts[0].artifact.dependencies['react-dom']
  await rehash(input); await assert.rejects(exportProjectZip(input), { code })
})
test('declared capabilities, events, stateSchema and saved host state refuse without partial success', async () => {
  for (const mutate of [a => { a.manifest.requestedCapabilities = [{ kind: 'state.write' }] }, a => { a.manifest.events.ready = { type: 'object', properties: {}, required: [], additionalProperties: false } }, a => { a.manifest.stateSchema.properties.n = { type: 'number' } }]) {
    const input = await mixed(); mutate(input.artifacts[0].artifact); await rehash(input)
    await assert.rejects(exportProjectZip(input), { code: 'UNSUPPORTED_PROTOCOL' })
  }
  const input = await mixed()
  input.project.custom.states.counter = { versionDigest: input.artifacts[0].versionDigest, stateRevision: 0, value: {} }
  await assert.rejects(exportProjectZip(input), { code: 'UNSUPPORTED_PROTOCOL' })
})
test('reported DeepSeek Pomodoro stateSchema refuses without changing the artifact', async () => {
  const input = await mixed()
  const artifact = input.artifacts[0].artifact
  artifact.manifest.name = 'DeepSeek 番茄钟（非空 stateSchema 回归）'
  artifact.manifest.stateSchema = {
    type: 'object',
    properties: {
      remainingSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
      running: { type: 'boolean' },
      phase: { type: 'string', maxLength: 16, enum: ['focus', 'break'] },
    },
    required: ['remainingSeconds', 'running', 'phase'],
    additionalProperties: false,
  }
  await rehash(input)
  const before = structuredClone(input)
  await assert.rejects(exportProjectZip(input), { code: 'UNSUPPORTED_PROTOCOL' })
  assert.deepEqual(input, before)
  assert.equal(Object.keys(input.artifacts[0].artifact.manifest.stateSchema.properties).length, 3)
})
test('unreachable source, duplicate or unused entries refuse', async () => {
  const input = await mixed(); input.artifacts[0].artifact.sources['extra.ts'] = 'export const x = 1'; await rehash(input)
  await assert.rejects(exportProjectZip(input), { code: 'UNSUPPORTED_SOURCE' })
  const duplicate = await mixed(); duplicate.artifacts.push(structuredClone(duplicate.artifacts[0]))
  await assert.rejects(exportProjectZip(duplicate), { code: 'DUPLICATE_ARTIFACT' })
  const unused = await mixed(); unused.project = builtin().project
  await assert.rejects(exportProjectZip(unused), { code: 'UNUSED_ARTIFACT' })
})
test('data accessors and host path sources cannot trigger reads or getters', async () => {
  let touched = false
  const input = builtin(); Object.defineProperty(input, 'artifacts', { enumerable: true, get() { touched = true; return [] } })
  await assert.rejects(exportProjectZip(input), { code: 'INVALID_INPUT' }); assert.equal(touched, false)
  await assert.rejects(exportProjectZip({ project: builtin().project, artifacts: '/Users/some/private/file' }), { code: 'ARTIFACT_COUNT_LIMIT' })
})
test('existing v1 validator remains the only migration route; no revision is incremented', async () => {
  const input = builtin(); input.project.revision = 42
  const result = unzip((await exportProjectZip(input)).bytes)
  assert.equal(JSON.parse(result.get('provenance.json')).projectRevision, 42)
  assert.equal(input.project.revision, 42)
  assert.equal(typeof protocol.migrateProjectState, 'function')
})
test('two exact versions of one definition keep distinct sources; repeated instances share only their version', async () => {
  const input = await mixed(), old = input.artifacts[0], newer = structuredClone(old)
  newer.artifact.sources['Counter.tsx'] += '\n// separate registered version\n'
  newer.versionDigest = await protocol.computeVersionDigest(newer.artifact)
  input.artifacts.push(newer)
  for (const [id, entry] of [['counter-new', newer], ['counter-reuse', old]]) {
    input.project.custom.instances.push({ id, definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest, props: { initial: 9 } })
    input.project.custom.positions[id] = { x: .5, y: .5 }
    input.project.renderOrder.push({ kind: 'custom', id })
  }
  const files = unzip((await exportProjectZip(input)).bytes)
  const counters = [...files].filter(([path]) => path.endsWith('/Counter.tsx'))
  assert.equal(counters.length, 2)
  assert.deepEqual(new Set(counters.map(([, text]) => text)), new Set([old.artifact.sources['Counter.tsx'], newer.artifact.sources['Counter.tsx']]))
  const app = files.get('src/App.tsx')
  const oldComponent = app.match(/"counter": (Custom_a\d+)/)[1]
  const newComponent = app.match(/"counter-new": (Custom_a\d+)/)[1]
  assert.notEqual(oldComponent, newComponent)
  assert.ok(app.includes(`"counter-reuse": ${oldComponent}`))
})
test('artifact and block aggregate caps reject before any partial archive is returned', async () => {
  const input = builtin(); input.artifacts = Array(33).fill({})
  await assert.rejects(exportProjectZip(input), { code: 'ARTIFACT_COUNT_LIMIT' })
  const many = builtin()
  for (let i = many.project.renderOrder.length; i < 129; i++) {
    many.project.base.spec.blocks.push({ id: `block-${i}`, name: '统计', type: 'metric', aggregation: 'count' })
    many.project.base.spec.relations.push({ id: `binding-${i}`, type: 'dataBinding', blockId: `block-${i}`, entityId: 'applicants' })
    many.project.renderOrder.push({ kind: 'builtin', id: `block-${i}` })
  }
  await assert.rejects(exportProjectZip(many), { code: 'BLOCK_COUNT_LIMIT' })
})
test('aggregate artifact source bytes are bounded independently of archive caps', async () => {
  const input = builtin(), template = (await mixed()).artifacts[0].artifact
  for (let i = 0; i < 5; i++) {
    const artifact = structuredClone(template)
    artifact.manifest.definitionId = `large-${i}`
    const padding = `\n/*${'x'.repeat(59900)}*/`
    artifact.sources = { 'Counter.tsx': "import './a'; export default function C() { return null }" + padding, 'a.ts': "import './b';" + padding, 'b.ts': "import './c';" + padding, 'c.ts': 'export {};' + padding }
    input.artifacts.push({ artifact, versionDigest: await protocol.computeVersionDigest(artifact) })
  }
  await assert.rejects(exportProjectZip(input), { code: 'SOURCE_SIZE_LIMIT' })
})
test('integration reads exact refs once, supports readonly snapshots, and never writes owner', async () => {
  const input = await mixed(), references = []
  const session = {
    getSnapshot: () => input.project,
    getAuthorization: () => ({ readOnly: true }),
    compareAndSwap: () => { throw new Error('MUST_NOT_WRITE_OWNER') },
    registry: { resolve: async ref => { references.push(ref); return input.artifacts.find(entry => entry.versionDigest === ref.versionDigest && entry.artifact.manifest.definitionId === ref.definitionId) } },
  }
  assert.deepEqual((await exportSessionSnapshot(session)).bytes, (await exportProjectZip(input)).bytes)
  assert.deepEqual(new Set(references.map(ref => ref.definitionId + '/' + ref.versionDigest)), new Set(input.project.custom.instances.map(ref => ref.definitionId + '/' + ref.versionDigest)))
  assert.equal(references.length, input.artifacts.length)
})
test('integration rejects a replaced snapshot even at the same revision', async () => {
  const input = await mixed(); let current = input.project
  const session = { getSnapshot: () => current, registry: { resolve: async ref => { current = structuredClone(current); return input.artifacts.find(entry => entry.versionDigest === ref.versionDigest) } } }
  await assert.rejects(exportSessionSnapshot(session), { code: 'STALE_SNAPSHOT' })
})
test('merged Workshop session exports builtin and mixed readonly snapshots without publication or revision changes', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample()), owner = runtime.customProject
  for (const custom of [false, true]) {
    owner.setReadOnly(false)
    if (custom) {
      const input = await mixed()
      for (const [index, entry] of input.artifacts.entries()) {
        const instance = input.project.custom.instances[index]
        assert.equal((await owner.install({ baseRevision: owner.getSnapshot().revision, instance, artifact: entry, expectedReference: null })).ok, true)
      }
    }
    owner.setReadOnly(true)
    const before = owner.getSnapshot(), base = runtime.getSnapshot(), authorization = owner.getAuthorization()
    let notifications = 0
    const stop = owner.subscribe(() => notifications++)
    const result = await exportSessionSnapshot(owner)
    const entries = []
    for (const { definitionId, versionDigest } of before.custom.instances) entries.push(await protocol.resolveArtifact(owner.registry, { definitionId, versionDigest }))
    assert.deepEqual(result.bytes, (await exportProjectZip({ project: before, artifacts: entries })).bytes)
    assert.strictEqual(owner.getSnapshot(), before)
    assert.strictEqual(runtime.getSnapshot(), base)
    assert.strictEqual(owner.getAuthorization(), authorization)
    assert.equal(notifications, 0)
    assert.equal(owner.getSnapshot().revision, custom ? 2 : 0)
    stop()
  }
})
test('merged session registry exports only the current exact version after replacement, preserving historical entries', async () => {
  const owner = createAppRuntime(createClubRegistrationExample()).customProject
  const old = (await mixed()).artifacts[0], current = structuredClone(old)
  current.artifact.sources['Counter.tsx'] += '\n// fixed test-only replacement version\n'
  current.versionDigest = await protocol.computeVersionDigest(current.artifact)
  for (const entry of [old, current]) {
    const previous = owner.getSnapshot().custom.instances[0]
    const instance = { id: 'counter', definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest, props: { initial: 9 } }
    assert.equal((await owner.install({ baseRevision: owner.getSnapshot().revision, instance, artifact: entry, expectedReference: previous ? { definitionId: previous.definitionId, versionDigest: previous.versionDigest } : null })).ok, true)
  }
  assert.ok(await owner.registry.resolve({ definitionId: old.artifact.manifest.definitionId, versionDigest: old.versionDigest }))
  const snapshot = owner.getSnapshot(), files = unzip((await exportSessionSnapshot(owner)).bytes)
  assert.deepEqual(JSON.parse(files.get('provenance.json')).artifacts, [{ definitionId: current.artifact.manifest.definitionId, versionDigest: current.versionDigest }])
  assert.equal([...files.values()].filter(text => text === current.artifact.sources['Counter.tsx']).length, 1)
  assert.ok(![...files.values()].includes(old.artifact.sources['Counter.tsx']))
  assert.strictEqual(owner.getSnapshot(), snapshot)
})

test('actual exported update function preserves identity, hidden fields, types and invalid-id safety', async () => {
  const js = ts.transpileModule(recordOperations, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
  const { updateRows } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
  const rows = [{ id: 'one', values: { title: 'old', hidden: true, optional: 'remove' } }, { id: 'two', values: { title: 'untouched' } }]
  const before = structuredClone(rows)
  const next = updateRows(rows, 'one', { title: 'new', number: 0, enabled: false, optional: '' })
  assert.deepEqual(rows, before)
  assert.deepEqual(next, [{ id: 'one', values: { title: 'new', hidden: true, number: 0, enabled: false } }, rows[1]])
  assert.equal(next[1], rows[1]); assert.equal(next.length, 2)
  for (const id of ['', 'missing', '__proto__']) assert.deepEqual(updateRows(rows, id, { title: 'bad' }), before)
  assert.deepEqual(updateRows([], 'missing', {}), [])
  const special = updateRows([{ id: 'special', values: {} }], 'special', JSON.parse('{"__proto__":"safe","hasOwnProperty":"value"}'))
  assert.equal(Object.getPrototypeOf(special[0].values), Object.prototype)
  assert.equal(Object.hasOwn(special[0].values, '__proto__'), true)
})
