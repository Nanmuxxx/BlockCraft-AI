const test = require('node:test'), assert = require('node:assert/strict')
const { once } = require('node:events')
const { api, createAppRuntime } = require('../custom-block/fixtures.cjs')
const { interactiveFixture } = require('./fixture.ts')
const { initializeGeneratedProject } = require('../../src/components/ai-create/generateApp.ts')
const { captureExport } = require('../../src/integrations/project-export/capture.ts')
const { createAppChangePlanner } = require('../../src/model/appChangePlan.ts')
function generatedSpec() {
  const spec = interactiveFixture().spec
  spec.blocks.find(b => b.type === 'gallery').imageIds = []
  spec.blocks.find(b => b.type === 'list').fieldIds = spec.entities[0].fields.map(f => f.id)
  return spec
}

test('generation prompt and review inventory accurately expose all three new primitives', async () => {
  const { checkGeneratedApplication, buildGenerationReviewMessages } = await import('../../server/aiGenerationQuality.mjs')
  const { buildGenerationMessages } = await import('../../server/aiGenerationPrompt.mjs')
  const spec = generatedSpec(), before = structuredClone(spec)
  const report = checkGeneratedApplication(spec)
  assert.equal(report.structure.valid, true); assert.equal(report.completeness.valid, true)
  const operation = id => report.inventory.find(i => i.blockId === id).operations
  assert.deepEqual(operation('search'), { search: spec.entities[0].fields.map(f => f.id), filter: spec.entities[0].fields.map(f => f.id) })
  assert.deepEqual(operation('groups'), { group: ['department'], count: [], selectGroup: ['department'] })
  assert.deepEqual(operation('details'), { readSelected: ['applicant-name', 'department', 'quantity'] })
  const prompt = buildGenerationMessages('搜索报名并按部门画图，点击查看详情')[0].content
  for (const type of ['filter', 'chart', 'details']) assert.ok(prompt.includes("type: '" + type + "'"))
  const review = buildGenerationReviewMessages('按部门画图', spec, [{ id: 'goal', goal: '画图', quote: '按部门画图', primary: true }])
  assert.deepEqual(JSON.parse(review[1].content).inventory, report.inventory)
  assert.deepEqual(spec, before)
  assert.deepEqual(initializeGeneratedProject(spec).records, { applicants: [] })
  for (const mutate of [s => s.blocks.find(b => b.id === 'search').targetBlockIds = ['registration-form'], s => s.blocks.find(b => b.id === 'groups').script = 'run()', s => s.blocks.find(b => b.id === 'details').sourceBlockId = 'missing']) {
    const invalid = structuredClone(spec); mutate(invalid)
    assert.equal(checkGeneratedApplication(invalid).structure.valid, false)
    assert.throws(() => initializeGeneratedProject(invalid))
  }
})

test('real local generation route accepts offline new-block JSON and rejects malformed/truncated/invalid plans', async t => {
  const { createAppServer } = await import('../../server/index.mjs')
  const { buildGenerationMessages } = await import('../../server/aiGenerationPrompt.mjs')
  let mode = 'valid', calls = 0
  const idea = '录入报名，搜索、按部门图表统计，点击名单查看详情'
  const server = createAppServer({ generationAccess: () => true, apiKey: 'offline-test-key', model: 'offline-fixture', fetchImpl: async (_url, options) => {
    calls++; assert.deepEqual(JSON.parse(options.body).messages, buildGenerationMessages(idea))
    const spec = generatedSpec()
    if (mode === 'illegal') spec.blocks.find(b => b.id === 'groups').targetBlockIds = ['registration-form']
    return Response.json({ choices: [{ finish_reason: mode === 'truncated' ? 'length' : 'stop', message: { content: mode === 'malformed' ? '{bad JSON' : mode === 'truncated' ? '{"version":1' : JSON.stringify(spec) } }] })
  } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  for (mode of ['valid', 'malformed', 'truncated', 'illegal']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea }) })
    const body = await response.json()
    if (mode === 'valid') { assert.equal(response.status, 200); assert.deepEqual(body, generatedSpec()); assert.doesNotThrow(() => createAppRuntime(initializeGeneratedProject(body))) }
    else { assert.ok(response.status >= 400); assert.ok(body.error.code) }
  }
  assert.equal(calls, 4, 'one injected offline response per request, no automatic retry')
})

test('standalone React exporter refuses new views explicitly, while project ZIP is tested separately', async () => {
  const runtime = createAppRuntime(interactiveFixture()), before = runtime.customProject.getSnapshot()
  await assert.rejects(captureExport(runtime.customProject), { code: 'UNSUPPORTED_INTERACTIVE_EXPORT' })
  const { exportProjectZip } = await import('../../tools/project-zip-export/export.mjs')
  await assert.rejects(exportProjectZip({ project: api.migrateProjectState(interactiveFixture()), artifacts: [] }), { code: 'UNSUPPORTED_INTERACTIVE_EXPORT' })
  assert.equal(runtime.customProject.getSnapshot(), before)
})

test('new view-specific AI modification is rejected until its full preview contract is supported', () => {
  const runtime = createAppRuntime(interactiveFixture()), before = runtime.getSnapshot()
  const planner = createAppChangePlanner(runtime)
  const result = planner.preview({ request: { requestId: 'mochi-new', baseRevision: before.revision, commands: [{ type: 'configureView', blockId: 'groups', block: { ...before.spec.blocks.find(b => b.id === 'groups'), chartType: 'line' } }] }, capabilityIds: ['chart'] }, { selectedBlockId: 'groups', allowedBlockIds: ['groups'], allowedEntityIds: ['applicants'] })
  assert.equal(result.ok, false)
  assert.equal(runtime.getSnapshot(), before)
})
