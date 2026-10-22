const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { setup, copy, createReadingLogExample, createAppRuntime, api } = require('../custom-block/fixtures.cjs')
const { createProjectPackage, parseProjectPackage } = require('../../src/integrations/project-package/format.ts')
const { encodePackageZip, decodePackageZip } = require('../../src/integrations/project-package/zip.ts')
const { assertNoPackageSecrets } = require('../../src/integrations/project-package/security.ts')
const { parsePackageJsonText } = require('../../src/integrations/project-package/json.ts')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
const emptyRegistry = { async resolve() { return undefined } }
function gallery(project = api.migrateProjectState(createReadingLogExample())) {
  project.base.assets = { photo: { id: 'photo', name: '照片', altText: '测试图片', mimeType: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}` } }
  project.base.spec.blocks.push({ id: 'photos', name: '相册', type: 'gallery', protocolVersion: 1, imageIds: ['photo'], layout: 'grid', interaction: 'preview' })
  project.base.blockPositions.photos = { x: .3, y: .8 }
  project.renderOrder.push({ kind: 'builtin', id: 'photos' })
  return project
}
function json(files, path) { return JSON.parse(new TextDecoder().decode(files.get(path))) }
function bytes(value) { return new TextEncoder().encode(`${JSON.stringify(value)}\n`) }
function hash(value) { return createHash('sha256').update(value).digest('hex') }
function rezipped(files) { return encodePackageZip([...files].map(([path, data]) => ({ path, data }))) }
async function mutate(change) {
  const files = decodePackageZip(await createProjectPackage(gallery(), emptyRegistry))
  const manifest = json(files, 'manifest.json'), project = json(files, 'project.json')
  await change({ files, manifest, project })
  const body = bytes(project)
  files.set('project.json', body)
  manifest.project.byteLength = body.byteLength
  manifest.project.sha256 = hash(body)
  files.set('manifest.json', bytes(manifest))
  return rezipped(files)
}

test('v1 ZIP binary resources roundtrip exact project, references and exact custom artifact versions', async () => {
  const { project, registry, entry } = await setup()
  gallery(project)
  const original = copy(project)
  const data = await createProjectPackage(project, registry)
  assert.deepEqual(project, original)
  const files = decodePackageZip(data)
  assert.deepEqual([...files.keys()], ['manifest.json', 'project.json', 'assets/photo.png'])
  assert.deepEqual(files.get('assets/photo.png'), new Uint8Array(png))
  const document = json(files, 'project.json'), manifest = json(files, 'manifest.json')
  assert.equal(document.project.base.assets.photo.dataUrl, undefined)
  assert.equal(document.project.base.assets.photo.resourcePath, 'assets/photo.png')
  assert.equal(manifest.resources[0].sha256, hash(png))
  assert.equal(manifest.metadata.projectFormatVersion, 2)
  const restored = await parseProjectPackage(data)
  assert.deepEqual(restored.project, original)
  assert.deepEqual(restored.artifacts, [entry])
  const runtime = createAppRuntime(restored.base, restored.artifacts, restored.project)
  assert.deepEqual(runtime.customProject.getSnapshot(), original)
  assert.deepEqual(await createProjectPackage(restored.project, runtime.customProject.registry), data)
})

test('empty assets preserve omission and empty registries without invented state', async () => {
  for (const includeEmpty of [false, true]) {
    const project = api.migrateProjectState(createReadingLogExample())
    if (includeEmpty) project.base.assets = {}
    assert.deepEqual((await parseProjectPackage(await createProjectPackage(project, emptyRegistry))).project, project)
  }
})

test('missing resources, missing manifest entries and dangling gallery references reject', async () => {
  await assert.rejects(parseProjectPackage(await mutate(({ files }) => files.delete('assets/photo.png'))), { code: 'RESOURCE_MISSING' })
  await assert.rejects(parseProjectPackage(await mutate(({ manifest }) => { manifest.resources = [] })), { code: 'RESOURCE_MISSING' })
  await assert.rejects(parseProjectPackage(await mutate(({ project }) => { project.project.base.spec.blocks.at(-1).imageIds = ['missing'] })), { code: 'RESOURCE_MISSING' })
  const project = gallery(); project.base.spec.blocks.at(-1).imageIds = ['missing']
  await assert.rejects(createProjectPackage(project, emptyRegistry), { code: 'RESOURCE_MISSING' })
})

test('resource hash, declared length, MIME, signature, mapping and extra entries reject', async () => {
  for (const update of [
    ({ manifest }) => { manifest.resources[0].sha256 = '0'.repeat(64) },
    ({ manifest }) => { manifest.resources[0].byteLength++ },
    ({ files }) => { const data = files.get('assets/photo.png').slice(); data[20] ^= 1; files.set('assets/photo.png', data) },
  ]) await assert.rejects(parseProjectPackage(await mutate(update)), { code: 'PACKAGE_INTEGRITY' })
  for (const update of [
    ({ project }) => { project.project.base.assets.photo.mimeType = 'image/jpeg' },
    ({ project }) => { project.project.base.assets.photo.resourcePath = 'assets/other.png' },
    ({ manifest }) => { manifest.resources[0].mimeType = 'image/svg+xml' },
    ({ manifest }) => { manifest.resources.push(copy(manifest.resources[0])) },
    ({ files, manifest }) => { const data = new Uint8Array(png.length); files.set('assets/photo.png', data); manifest.resources[0].sha256 = hash(data) },
  ]) await assert.rejects(parseProjectPackage(await mutate(update)), { code: 'RESOURCE_INVALID' })
  await assert.rejects(parseProjectPackage(await mutate(({ files }) => files.set('assets/extra.png', new Uint8Array(png)))), { code: 'PACKAGE_PATH' })
})

test('metadata mismatches and all unsupported version levels reject', async () => {
  await assert.rejects(parseProjectPackage(await mutate(({ manifest }) => { manifest.metadata.revision++ })), { code: 'PACKAGE_INVALID' })
  for (const update of [
    ({ manifest }) => { manifest.formatVersion = 2 },
    ({ project }) => { project.formatVersion = '1' },
    ({ project }) => { project.project.formatVersion = 3 },
    ({ project }) => { project.project.base.spec.version = 99 },
  ]) await assert.rejects(parseProjectPackage(await mutate(update)), { code: 'PACKAGE_VERSION' })
  await assert.rejects(parseProjectPackage(await mutate(({ project }) => { project.constructor = {} })), { code: 'PACKAGE_INVALID' })
})

test('project hash and UTF8 admission reject corruption before JSON or restore', async () => {
  const files = decodePackageZip(await createProjectPackage(gallery(), emptyRegistry))
  files.get('project.json')[0] = 0
  await assert.rejects(parseProjectPackage(rezipped(files)), { code: 'PACKAGE_INTEGRITY' })
  files.set('manifest.json', new Uint8Array([0xff]))
  await assert.rejects(parseProjectPackage(rezipped(files)), { code: 'PACKAGE_INVALID' })
})

test('resource per-file, combined and count limits are explicit', async () => {
  const sized = (id, size) => { const data = Buffer.alloc(size); png.subarray(0, 8).copy(data); return { id, name: '图片', mimeType: 'image/png', dataUrl: `data:image/png;base64,${data.toString('base64')}` } }
  const project = gallery()
  project.base.assets.photo = sized('photo', 512 * 1024 + 1)
  await assert.rejects(createProjectPackage(project, emptyRegistry), { code: 'PACKAGE_LIMIT' })
  project.base.assets = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`image${i}`, { ...gallery().base.assets.photo, id: `image${i}` }]))
  project.base.spec.blocks.at(-1).imageIds = []
  await assert.rejects(createProjectPackage(project, emptyRegistry), { code: 'PACKAGE_LIMIT' })
  project.base.assets = { first: sized('first', 512 * 1024), second: sized('second', 512 * 1024), third: sized('third', 8) }
  await assert.rejects(createProjectPackage(project, emptyRegistry), { code: 'PACKAGE_LIMIT' })
  await assert.rejects(parseProjectPackage(await mutate(({ manifest }) => { manifest.resources[0].byteLength = 512 * 1024 + 1 })), { code: 'PACKAGE_LIMIT' })
})

test('resource invalid data URL and MIME fail with resource error', async () => {
  for (const patch of [{ dataUrl: 'https://example.org/a.png' }, { dataUrl: 'data:image/png;base64,SGVsbG8=' }, { mimeType: 'image/svg+xml' }]) {
    const project = gallery(); Object.assign(project.base.assets.photo, patch)
    await assert.rejects(createProjectPackage(project, emptyRegistry), { code: 'RESOURCE_INVALID' })
  }
})

test('secrets reject export and import without echoing input and safe documentation passes', async () => {
  const sensitive = ['sk-' + 'x'.repeat(30), 'https://person:fake-pass@example.org/a', 'https://example.org/?%61pi_key=fixture', 'const apiKey = "example-value"']
  for (const value of sensitive) {
    const project = gallery(); project.base.spec.name = value
    await assert.rejects(createProjectPackage(project, emptyRegistry), error => error.code === 'PACKAGE_SECRET' && !error.message.includes(value))
    await assert.rejects(parseProjectPackage(await mutate(({ project: doc }) => { doc.project.base.spec.name = value })), { code: 'PACKAGE_SECRET' })
  }
  for (const key of ['apiKey', 'access_token', 'password', 'clientSecret']) assert.throws(() => assertNoPackageSecrets({ [key]: 'fixture' }), { code: 'PACKAGE_SECRET' })
  assert.doesNotThrow(() => assertNoPackageSecrets({ text: 'token / secret are documentation words', source: 'type Props = { token: string }; const tokenCount = 2' }))
  const project = gallery(), raw = Buffer.concat([png, Buffer.from(sensitive[0])])
  project.base.assets.photo.dataUrl = `data:image/png;base64,${raw.toString('base64')}`
  await assert.rejects(createProjectPackage(project, emptyRegistry), { code: 'PACKAGE_SECRET' })
})

test('missing component versions and digest mismatch retain original validation semantics', async () => {
  const { project, registry } = await setup()
  await assert.rejects(createProjectPackage(project, emptyRegistry), { code: 'VERSION_MISSING' })
  const files = decodePackageZip(await createProjectPackage(project, registry))
  const document = json(files, 'project.json'), manifest = json(files, 'manifest.json')
  document.artifacts[0].artifact.sources['src/Counter.tsx'] += '\n// corruption'
  const body = bytes(document); files.set('project.json', body)
  manifest.project.byteLength = body.length; manifest.project.sha256 = hash(body)
  files.set('manifest.json', bytes(manifest))
  await assert.rejects(parseProjectPackage(rezipped(files)), { code: 'DIGEST_MISMATCH' })
})

test('strict JSON admission rejects duplicate and escaped duplicate keys at every nesting level', () => {
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"items":[{"secret":"hidden","secret":"safe"}]}', '{"__proto__":{}}', '{"\\u0063onstructor":{}}', '[1,]', '{"a":1,}', '{"a" 1}', '01', 'true false', '"\\x20"', '1e9999']) {
    assert.throws(() => parsePackageJsonText(text), { code: 'PACKAGE_INVALID' }, text)
  }
  assert.deepEqual(parsePackageJsonText('{"a":{"x":1},"b":{"x":2},"escaped":"\\\"{},[]"}'), { a: { x: 1 }, b: { x: 2 }, escaped: '"{},[]' })
  assert.throws(() => parsePackageJsonText('['.repeat(34) + '0' + ']'.repeat(34)), { code: 'PACKAGE_LIMIT' })
  assert.throws(() => parsePackageJsonText('{"large":"' + 'x'.repeat(262145) + '"}'), { code: 'PACKAGE_LIMIT' })
  assert.throws(() => parsePackageJsonText(' '.repeat(4_000_001)), { code: 'PACKAGE_LIMIT' })
})

test('duplicate package metadata is rejected even when JSON.parse would hide it', async () => {
  const files = decodePackageZip(await createProjectPackage(gallery(), emptyRegistry))
  const text = new TextDecoder().decode(files.get('manifest.json'))
  files.set('manifest.json', new TextEncoder().encode(text.replace('"formatVersion":1', '"formatVersion":99,"\\u0066ormatVersion":1')))
  await assert.rejects(parseProjectPackage(rezipped(files)), { code: 'PACKAGE_INVALID' })
})

test('legacy image data URLs and broader source/URL credentials are scanned without quadratic work', { timeout: 10000 }, () => {
  const started = performance.now()
  assert.doesNotThrow(() => assertNoPackageSecrets({ text: 'a'.repeat(2_000_000) }))
  const large = Buffer.alloc(512 * 1024); png.subarray(0, 8).copy(large)
  assert.doesNotThrow(() => assertNoPackageSecrets({ image: `data:image/png;base64,${large.toString('base64')}` }))
  assert.ok(performance.now() - started < 5000, 'bounded scanner must finish long text and maximum-size resources promptly')
  for (const value of ['ftp://person:fixture@example.org/image', '//person:fixture@example.org/image', 'https://example.org/a?X-Goog-Credential=fixture', 'config["authToken"] = "fixture"', 'const apiKey: string = "fixture"']) {
    assert.throws(() => assertNoPackageSecrets({ text: value }), { code: 'PACKAGE_SECRET' })
  }
  for (const encoding of ['utf8', 'utf16le']) {
    const raw = Buffer.concat([png, Buffer.from('const apiKey = "fixture"', encoding)])
    assert.throws(() => assertNoPackageSecrets({ assets: { photo: { dataUrl: `data:image/png;base64,${raw.toString('base64')}` } } }), { code: 'PACKAGE_SECRET' })
  }
})
