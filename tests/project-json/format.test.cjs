const test = require('node:test')
const assert = require('node:assert/strict')
const { setup, copy, createReadingLogExample, createAppRuntime, api } = require('../custom-block/fixtures.cjs')
const { createProjectJson, parseProjectJson, parseProjectJsonText, serializeProjectJson } = require('../../src/integrations/project-json/format.ts')
const { initializeGeneratedProject } = require('../../src/components/ai-create/generateApp.ts')

test('v1 project data exports and restores without losing records or layout', async () => {
  const initial = createReadingLogExample()
  initial.revision = 9
  initial.records[initial.spec.entities[0].id][0].values[initial.spec.entities[0].fields[0].id] = '保留的数据'
  initial.blockPositions[initial.spec.blocks[0].id] = { x: .13, y: .87 }
  const runtime = createAppRuntime(initial)
  const file = await createProjectJson(runtime.customProject.getSnapshot(), runtime.customProject.registry)
  const restored = await parseProjectJsonText(serializeProjectJson(file))
  assert.deepEqual(restored.base, runtime.getSnapshot())
  assert.equal(restored.project.revision, 9)
  const reopened = createAppRuntime(restored.base, restored.artifacts, restored.project)
  assert.deepEqual(reopened.getSnapshot(), runtime.getSnapshot())
})

test('custom artifact references roundtrip into an editable runtime', async () => {
  const { project, registry, entry } = await setup()
  const runtime = createAppRuntime({ revision: project.revision, ...project.base }, [entry], project)
  const document = await createProjectJson(runtime.customProject.getSnapshot(), runtime.customProject.registry)
  const restored = await parseProjectJson(document)
  assert.deepEqual(restored.project, runtime.customProject.getSnapshot())
  assert.deepEqual(restored.artifacts, [entry])
  const reopened = createAppRuntime(restored.base, restored.artifacts, restored.project)
  assert.deepEqual(reopened.customProject.getSnapshot(), runtime.customProject.getSnapshot())
  assert.equal(reopened.customProject.registry.resolve !== undefined, true)
  assert.equal(reopened.moveBlock(project.base.spec.blocks[0].id, { x: .6, y: .3 }).ok, true)
  assert.deepEqual(reopened.getSnapshot().records, runtime.getSnapshot().records)
})

test('v2 timer state is retained across export and import', async () => {
  const state = initializeGeneratedProject({ version: 2, id: 'timer-app', name: '计时器', entities: [],
    blocks: [{ id: 'timer', name: '专注', type: 'pomodoro', protocolVersion: 1, durationSeconds: 1500 }], relations: [] })
  state.timers = { timer: { remainingMs: 1200, startedAt: null } }
  const runtime = createAppRuntime(state)
  const document = await createProjectJson(runtime.customProject.getSnapshot(), runtime.customProject.registry)
  const restored = await parseProjectJson(document)
  assert.deepEqual(restored.base.timers, state.timers)
})

test('bad format, missing or mismatched artifacts and oversized text reject before replacement', async () => {
  const { project, registry } = await setup()
  const valid = await createProjectJson(project, registry)
  const original = JSON.stringify(project)
  const wrongFormat = copy(valid); wrongFormat.formatVersion = 99
  await assert.rejects(parseProjectJson(wrongFormat), { code: 'UNSUPPORTED_FORMAT' })
  const missing = copy(valid); missing.artifacts = []
  await assert.rejects(parseProjectJson(missing))
  const badDigest = copy(valid); badDigest.artifacts[0].versionDigest = `sha256:${'f'.repeat(64)}`
  await assert.rejects(parseProjectJson(badDigest))
  await assert.rejects(parseProjectJsonText('not json'))
  await assert.rejects(parseProjectJsonText(' '.repeat(4_000_001)), { code: 'LIMIT' })
  assert.equal(JSON.stringify(project), original)
})

test('serialization keeps all JSON state and rejects over-limit projects', async () => {
  const state = initializeGeneratedProject({
    version: 2, id: 'timer-app', name: '计时器', entities: [],
    blocks: [{ id: 'timer', name: '专注', type: 'pomodoro', protocolVersion: 1, durationSeconds: 1500 }], relations: [],
  })
  state.timers = { timer: { remainingMs: 1200, startedAt: null } }
  const runtime = createAppRuntime(state)
  const document = await createProjectJson(runtime.customProject.getSnapshot(), runtime.customProject.registry)
  const text = serializeProjectJson(document)
  assert.match(text, /"remainingMs": 1200/)
  const copyBack = await parseProjectJsonText(text)
  assert.deepEqual(copyBack.base.timers, state.timers)
  document.project.base.spec.name = 'x'.repeat(262_145)
  assert.throws(() => serializeProjectJson(document), { code: 'LIMIT' })
})

test('512 KiB raster asset commits through owner CAS and roundtrips through project JSON', async () => {
  const bytes = Buffer.alloc(512 * 1024)
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes)
  const asset = { id: 'large-photo', name: '图片', mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
  const runtime = createAppRuntime(createReadingLogExample())
  const result = runtime.executeCommand({ requestId: 'large-image', baseRevision: 0, commands: [
    { type: 'addProjectAsset', asset },
    { type: 'addBlock', block: { id: 'photos', type: 'gallery', name: '相册', protocolVersion: 1, imageIds: ['large-photo'], layout: 'grid', interaction: 'preview' } },
  ] })
  assert.equal(result.ok, true, JSON.stringify(result))
  const file = await createProjectJson(runtime.customProject.getSnapshot(), runtime.customProject.registry)
  const restored = await parseProjectJsonText(serializeProjectJson(file))
  assert.deepEqual(restored.base, runtime.getSnapshot())
  const reopened = createAppRuntime(restored.base, restored.artifacts, restored.project)
  assert.equal(reopened.getSnapshot().assets['large-photo'].dataUrl, asset.dataUrl)
  const forged = copy(file)
  forged.project.base.assets['large-photo'].dataUrl = `data:image/png;base64,${Buffer.alloc(512 * 1024).toString('base64')}`
  await assert.rejects(parseProjectJson(forged), { code: 'INVALID_FILE' })
  const oversizedText = copy(file)
  oversizedText.project.base.spec.name = 'x'.repeat(262_145)
  assert.throws(() => serializeProjectJson(oversizedText), { code: 'LIMIT' })
})
