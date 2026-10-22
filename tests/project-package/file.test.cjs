const test = require('node:test')
const assert = require('node:assert/strict')
const { createReadingLogExample, createAppRuntime, setup, api } = require('../custom-block/fixtures.cjs')
const { createProjectJson, serializeProjectJson } = require('../../src/integrations/project-json/format.ts')
const { parseProjectFile } = require('../../src/integrations/project-package/file.ts')
const { createProjectPackage } = require('../../src/integrations/project-package/format.ts')
const { projectFileErrorMessage } = require('../../src/integrations/project-package/messages.ts')
const { PACKAGE_LIMITS } = require('../../src/integrations/project-package/zip.ts')

function file(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
  return { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

test('content detection accepts ZIP and original JSON regardless of filename/type', async () => {
  const runtime = createAppRuntime(createReadingLogExample())
  const zip = await createProjectPackage(runtime.customProject.getSnapshot(), runtime.customProject.registry)
  const json = serializeProjectJson(await createProjectJson(runtime.customProject.getSnapshot(), runtime.customProject.registry))
  assert.deepEqual((await parseProjectFile(file(zip))).base, runtime.getSnapshot())
  assert.deepEqual((await parseProjectFile(file(json))).base, runtime.getSnapshot())
})

test('legacy bare AppSpec v1/v2 ProjectState and CustomProject v2 restore without rewriting business data', async () => {
  const state = createReadingLogExample()
  state.revision = 19
  const migrated = await parseProjectFile(file(state))
  assert.deepEqual(migrated.base, state)
  assert.equal(migrated.project.formatVersion, 2)
  assert.deepEqual(migrated.artifacts, [])
  assert.deepEqual(await parseProjectFile(file(migrated.project)), migrated)
  const timer = { revision: 5, spec: { version: 2, id: 'timer-app', name: '离线计时器', entities: [],
    blocks: [{ id: 'timer', name: '专注', type: 'pomodoro', protocolVersion: 1, durationSeconds: 60 }], relations: [] },
    records: {}, blockPositions: { timer: { x: .1, y: .7 } }, timers: { timer: { remainingMs: 5000, startedAt: null } } }
  assert.deepEqual((await parseProjectFile(file(timer))).base, timer)
})

test('bare custom project with unresolved components rejects instead of losing custom data', async () => {
  const { project } = await setup()
  await assert.rejects(parseProjectFile(file(project)))
  const before = structuredClone(project)
  await assert.rejects(parseProjectFile(file({ ...project, formatVersion: 99 })), { code: 'PACKAGE_VERSION' })
  assert.deepEqual(project, before)
})

test('oversized and inconsistent files reject before parsing, empty/binary/unsafe JSON rejects', async () => {
  let reads = 0
  await assert.rejects(parseProjectFile({ size: PACKAGE_LIMITS.maxZipBytes + 1, async arrayBuffer() { reads++; return new ArrayBuffer(0) } }), { code: 'PACKAGE_LIMIT' })
  assert.equal(reads, 0)
  await assert.rejects(parseProjectFile({ size: 1, async arrayBuffer() { return new ArrayBuffer(2) } }), { code: 'PACKAGE_INVALID' })
  for (const value of ['', 'not json', new Uint8Array([255, 254, 1]), '{"__proto__":{"polluted":true}}']) await assert.rejects(parseProjectFile(file(value)))
  assert.equal({}.polluted, undefined)
  const state = createReadingLogExample()
  const future = { format: 'blockcraft-project', formatVersion: 99, project: api.migrateProjectState(state), artifacts: [] }
  await assert.rejects(parseProjectFile(file(future)), { code: 'UNSUPPORTED_FORMAT' })
  state.spec.version = 99
  await assert.rejects(parseProjectFile(file(state)), { code: 'PACKAGE_VERSION' })
})

test('legacy import refuses credential fields and UI errors never echo arbitrary input', async () => {
  const state = createReadingLogExample()
  state.spec.name = 'https://example.invalid/?api_key=fixture-placeholder'
  await assert.rejects(parseProjectFile(file(state)), { code: 'PACKAGE_SECRET' })
  const sensitive = 'fixture-private-value-do-not-reflect'
  assert.equal(projectFileErrorMessage(new Error(sensitive)).includes(sensitive), false)
  assert.equal(projectFileErrorMessage({ code: sensitive }).includes(sensitive), false)
  assert.match(projectFileErrorMessage({ code: 'PACKAGE_PATH' }), /非法路径/)
  assert.match(projectFileErrorMessage({ code: 'RESOURCE_MISSING' }), /缺少/)
})

test('legacy JSON rejects shadowed fields and escaped duplicate keys before recovery', async () => {
  const state = JSON.stringify(createReadingLogExample())
  for (const text of [state.replace('"revision":', '"revision":0,"revision":'), state.replace('"revision":', '"revis\\u0069on":0,"revision":'), '{"secret":"fixture-only","secret":""}']) {
    await assert.rejects(parseProjectFile(file(text)), { code: 'PACKAGE_INVALID' })
  }
})
