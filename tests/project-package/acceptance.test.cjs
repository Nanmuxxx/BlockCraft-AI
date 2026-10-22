const test = require('node:test')
const assert = require('node:assert/strict')
const { makeGalleryRuntime, makeGalleryProject, createLegacyFixture } = require('./fixtures.cjs')
const { createAppRuntime } = require('../custom-block/fixtures.cjs')
const { createProjectJson, serializeProjectJson } = require('../../src/integrations/project-json/format.ts')
const { createProjectPackage } = require('../../src/integrations/project-package/format.ts')
const { parseProjectFile } = require('../../src/integrations/project-package/file.ts')
const { PACKAGE_LIMITS } = require('../../src/integrations/project-package/zip.ts')
function file(bytes) {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes)
  return { size: data.length, async arrayBuffer() { return data.slice().buffer } }
}

test('file ingress detects content and restores the same exact runtime from ZIP and JSON', async () => {
  const runtime = makeGalleryRuntime()
  const snapshot = runtime.customProject.getSnapshot()
  const zip = await createProjectPackage(snapshot, runtime.customProject.registry)
  const json = serializeProjectJson(await createProjectJson(snapshot, runtime.customProject.registry))
  for (const input of [file(zip), file(json)]) {
    const restored = await parseProjectFile(input)
    assert.deepEqual(restored.project, snapshot)
    const reopened = createAppRuntime(restored.base, restored.artifacts, restored.project)
    assert.deepEqual(reopened.customProject.getSnapshot(), snapshot)
    assert.equal(reopened.timerAction('package-timer', 'start').ok, true)
    assert.equal(reopened.timerAction('package-timer', 'pause').ok, true)
    reopened.dispatch({ type: 'create', entityId: 'applicants', record: { id: 'restored-record', values: { 'applicant-name': '恢复后的写入', department: '技术部' } } })
    assert.equal(reopened.getSnapshot().records.applicants.length, 2)
    assert.deepEqual(reopened.getSnapshot().assets, runtime.getSnapshot().assets)
  }
  assert.deepEqual(runtime.customProject.getSnapshot(), snapshot)
})

test('bare legacy v1, bare CustomProject v2 and prior JSON envelope migrate without data loss', async () => {
  const legacy = createLegacyFixture()
  const restored = await parseProjectFile(file(JSON.stringify(legacy)))
  assert.equal(restored.project.formatVersion, 2)
  assert.equal(restored.project.base.spec.version, 1)
  assert.deepEqual(restored.base, legacy)
  const project = makeGalleryProject()
  assert.deepEqual((await parseProjectFile(file(JSON.stringify(project)))).project, project)
  const envelope = { format: 'blockcraft-project', formatVersion: 1, project, artifacts: [] }
  assert.deepEqual((await parseProjectFile(file(JSON.stringify(envelope)))).project, project)
})

test('file ingress rejects bad bytes, future versions, declared size lies and oversized input before reading', async () => {
  for (const bytes of ['{invalid', '', new Uint8Array([0xff, 0xfe]), new Uint8Array([80, 75, 0, 0])]) await assert.rejects(parseProjectFile(file(bytes)))
  await assert.rejects(parseProjectFile(file(JSON.stringify({ formatVersion: 99 }))), { code: 'PACKAGE_VERSION' })
  const mismatched = file('{}'); mismatched.size++
  await assert.rejects(parseProjectFile(mismatched), { code: 'PACKAGE_INVALID' })
  let reads = 0
  for (const size of [-1, NaN, Infinity, 0, 1.5, PACKAGE_LIMITS.maxZipBytes + 1]) {
    await assert.rejects(parseProjectFile({ size, async arrayBuffer() { reads++; return new ArrayBuffer(0) } }), { code: 'PACKAGE_LIMIT' })
  }
  assert.equal(reads, 0)
})
