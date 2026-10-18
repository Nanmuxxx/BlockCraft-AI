const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { captureExport } = require('../../src/integrations/project-export/capture.ts')

test('export capture reads the actual sole owner without CAS, authorization change or publication', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const owner = runtime.customProject
  owner.setReadOnly(true)
  const before = owner.getSnapshot(), base = runtime.getSnapshot(), auth = owner.getAuthorization()
  let calls = 0
  const off = owner.subscribe(() => calls++)
  const captured = await captureExport(owner)
  captured.assertCurrent()
  assert.equal(captured.input.project, before)
  assert.deepEqual(captured.input.artifacts, [])
  assert.equal(owner.getSnapshot(), before)
  assert.equal(runtime.getSnapshot(), base)
  assert.equal(owner.getAuthorization(), auth)
  assert.equal(calls, 0)
  off()
})

test('exact references only, deduplicated; missing registry is rejected', async () => {
  const { mixed } = await import('../project-zip-export/fixtures.mjs')
  const input = await mixed()
  input.project.custom.instances.push({ ...input.project.custom.instances[0], id: 'another-counter' })
  const seen = []
  const owner = { getSnapshot: () => input.project, registry: { async resolve(ref) {
    seen.push(ref)
    return input.artifacts.find(a => a.versionDigest === ref.versionDigest && a.artifact.manifest.definitionId === ref.definitionId)
  } } }
  const result = await captureExport(owner)
  assert.equal(result.input.artifacts.length, 2)
  assert.equal(seen.length, 2)
  assert(seen.every(ref => Object.keys(ref).sort().join() === 'definitionId,versionDigest'))
  await assert.rejects(captureExport({ ...owner, registry: { async resolve() { return undefined } } }), { code: 'VERSION_MISSING' })
})

test('owner replacement during async resolution or while download is in flight rejects stale data', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const before = runtime.customProject.getSnapshot()
  let current = before
  const owner = { getSnapshot: () => current, registry: runtime.customProject.registry }
  const captured = await captureExport(owner)
  current = structuredClone(before) // same revision, different session identity
  assert.throws(captured.assertCurrent, { code: 'STALE_SNAPSHOT' })
  const { mixed } = await import('../project-zip-export/fixtures.mjs')
  const input = await mixed(); current = input.project
  owner.registry = { async resolve(ref) {
    current = structuredClone(current)
    return input.artifacts.find(a => a.versionDigest === ref.versionDigest)
  } }
  await assert.rejects(captureExport(owner), { code: 'STALE_SNAPSHOT' })
})
