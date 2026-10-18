const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { api, copy, artifact, setup, integrity } = require('./fixtures.cjs')

test('digest uses documented domain + canonical JSON SHA-256, independent of insertion order', async () => {
  const source = artifact()
  const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  const expected = `sha256:${createHash('sha256').update(`blockcraft:source-artifact:v1\n${canonical(source)}`, 'utf8').digest('hex')}`
  assert.equal(await api.computeVersionDigest(source), expected)
  const reordered = Object.fromEntries(Object.entries(source).reverse())
  reordered.manifest = Object.fromEntries(Object.entries(source.manifest).reverse())
  assert.equal(await api.computeVersionDigest(reordered), expected)
})
test('digest covers source, manifest, dependency locks/integrity and build constraints', async () => {
  const baseline = await api.computeVersionDigest(artifact())
  const mutations = [
    a => { a.sources['src/Counter.tsx'] += '\n// next' },
    a => { a.sources['src/Extra.ts'] = 'export const x = 1' },
    a => { a.manifest.name = '新版本' },
    a => { a.manifest.propsSchema.properties.durationSeconds.maximum = 3600 },
    a => { a.dependencies['react-dom'] = { version: '19.3.1', integrity } },
    a => { a.dependencies.react.integrity = `sha512-${'B'.repeat(85)}A==` },
    a => { a.build.toolchain.integrity = `sha512-${'B'.repeat(85)}A==` },
    a => { a.build.maxBundleBytes = 100000 },
  ]
  const hashes = new Set([baseline])
  for (const mutate of mutations) { const a = artifact(); mutate(a); const hash = await api.computeVersionDigest(a); assert.ok(!hashes.has(hash)); hashes.add(hash) }
})
test('exact immutable refs resolve to frozen copies; forged/tampered/missing versions reject', async () => {
  const { reference, entry, registry } = await setup()
  const resolved = await api.resolveArtifact(registry, reference)
  assert.deepEqual(resolved, entry); assert.notStrictEqual(resolved, entry)
  assert.ok(Object.isFrozen(resolved)); assert.ok(Object.isFrozen(resolved.artifact.sources))
  entry.artifact.sources['src/Counter.tsx'] = 'tampered'
  assert.notEqual(resolved.artifact.sources['src/Counter.tsx'], 'tampered')
  await assert.rejects(api.resolveArtifact(registry, reference), { code: 'DIGEST_MISMATCH' })
  await assert.rejects(api.resolveArtifact({ resolve: async () => undefined }, reference), { code: 'VERSION_MISSING' })
  await assert.rejects(api.resolveArtifact({ resolve: async () => ({ ...entry, versionDigest: `sha256:${'f'.repeat(64)}` }) }, reference), { code: 'DIGEST_MISMATCH' })
  const wrong = copy(entry); wrong.artifact.manifest.definitionId = 'wrong'
  await assert.rejects(api.resolveArtifact({ resolve: async () => wrong }, reference), { code: 'DIGEST_MISMATCH' })
  for (const ref of [{ ...reference, versionDigest: 'latest' }, { ...reference, source: 'execute' }, { ...reference, versionDigest: 'sha256:abcd' }]) await assert.rejects(api.resolveArtifact(registry, ref))
})
test('new and old versions coexist and cannot overwrite an old digest', async () => {
  const old = artifact(), next = copy(old); next.sources['src/Counter.tsx'] += '\n// v2'
  const entries = await Promise.all([old, next].map(async source => ({ versionDigest: await api.computeVersionDigest(source), artifact: source })))
  const byDigest = new Map(entries.map(e => [e.versionDigest, e]))
  const registry = { resolve: async ref => byDigest.get(ref.versionDigest) }
  for (const entry of entries) assert.equal((await api.resolveArtifact(registry, { definitionId: 'test-countdown', versionDigest: entry.versionDigest })).versionDigest, entry.versionDigest)
  byDigest.set(entries[0].versionDigest, { ...entries[0], artifact: next })
  await assert.rejects(api.resolveArtifact(registry, { definitionId: 'test-countdown', versionDigest: entries[0].versionDigest }), { code: 'DIGEST_MISMATCH' })
})
const invalidArtifacts = {
  'unknown version': a => { a.artifactVersion = 2 },
  'unknown manifest': a => { a.manifest.protocolVersion = 2 },
  'unknown SDK': a => { a.manifest.sdkVersion = 'latest' },
  'extra field': a => { a.trusted = true },
  'extra manifest field': a => { a.manifest.granted = true },
  'path traversal': a => { a.manifest.entry = '../index.js' },
  'absolute path': a => { a.manifest.entry = '/index.js' },
  'URL entry': a => { a.manifest.entry = 'https://evil/index.js' },
  'missing entry': a => { a.manifest.entry = 'Missing.tsx' },
  'case collision': a => { a.sources['src/counter.tsx'] = '' },
  'unsupported source extension': a => { a.sources['binary.wasm'] = '' },
  'bad root Schema': a => { a.manifest.propsSchema = { type: 'boolean' } },
  'unknown event Schema': a => { a.manifest.events.completed.unknown = true },
  'unknown capability': a => { a.manifest.requestedCapabilities = [{ kind: 'network' }] },
  'duplicate capability': a => { a.manifest.requestedCapabilities.push({ kind: 'state.write' }) },
  'unknown dependency': a => { a.dependencies.evil = { version: '1.0.0', integrity } },
  'floating dependency': a => { a.dependencies.react.version = '^19.3.1' },
  'other dependency version': a => { a.dependencies.react.version = '19.3.0' },
  'invalid integrity': a => { a.dependencies.react.integrity = 'sha512-invented' },
  'noncanonical integrity': a => { a.dependencies.react.integrity = `sha512-${'A'.repeat(85)}B==` },
  'oversized build': a => { a.build.maxBundleBytes = 524289 },
  'toolchain range': a => { a.build.toolchain.version = '^0.25.12' },
  'unsupported target': a => { a.build.target = 'esnext' },
  'build plugin': a => { a.build.plugins = ['npm:evil'] },
}
for (const [name, mutate] of Object.entries(invalidArtifacts)) test(`artifact rejects ${name}`, async () => {
  const a = artifact(); mutate(a); assert.throws(() => api.assertSourceArtifact(a)); await assert.rejects(api.computeVersionDigest(a))
})
test('artifact source count and UTF-8 total size budgets include exact boundaries', () => {
  const a = artifact(); a.sources['src/Counter.tsx'] = 'x'.repeat(262144)
  api.assertSourceArtifact(a)
  a.sources['src/Extra.ts'] = 'x'; assert.throws(() => api.assertSourceArtifact(a))
  a.sources = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`src/File${i}.ts`, '']))
  a.sources['src/Counter.tsx'] = ''; api.assertSourceArtifact(a)
  a.sources['src/Extra.ts'] = ''; assert.throws(() => api.assertSourceArtifact(a))
  a.sources = { 'src/Counter.tsx': '中'.repeat(87382) }; assert.throws(() => api.assertSourceArtifact(a), { code: 'LIMIT' })
})
