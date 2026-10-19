const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { createClubRegistrationExample, createAppRuntime } = require('../custom-block/fixtures.cjs')
const { generateProject } = require('../../src/components/ai-create/generateApp.ts')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { createModelPlanProvider } = require('../../src/integrations/mochi/modelPlanProvider.ts')

test('offline HTTP service -> strict client -> selected Mochi plan -> confirmation -> shared B/C runtime', async t => {
  const { createAppServer } = await import('../../server/index.mjs')
  const original = global.fetch
  let modelCalls = 0
  const fixture = createClubRegistrationExample().spec
  const server = createAppServer({ generationAccess: () => true, apiKey: 'FIXTURE-NOT-A-KEY', model: 'offline-fixture', fetchImpl: async (url, options) => {
    modelCalls++
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    const input = JSON.parse(options.body)
    assert.equal(input.messages[1].content, '制作一个社团报名工具，保存姓名和部门')
    assert.equal(input.model, 'offline-fixture')
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixture) } }] })
  } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { global.fetch = original; server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  // Only relative client API calls are sent to the actual loopback HTTP server.
  global.fetch = (url, options) => {
    assert.equal(url, '/api/ai/generate')
    return original(`http://127.0.0.1:${server.address().port}${url}`, options)
  }
  const state = await generateProject('制作一个社团报名工具，保存姓名和部门')
  assert.deepEqual(state.spec, fixture); assert.equal(modelCalls, 1)
  assert.ok(Object.values(state.records).every(rows => rows.length === 0))
  const runtime = createAppRuntime(state), session = runtime.customProject
  const host = createMochiHost(runtime, createModelPlanProvider(async input => {
    const wire = JSON.stringify(input.request)
    assert.ok(!wire.includes('records')); assert.ok(!wire.includes('authorization'))
    assert.equal(input.request.block.id, 'registration-form')
    assert.equal(input.request.prompt, '在选中报名表单新增可选备注字段')
    return JSON.stringify({ request: { requestId: input.request.requestId, baseRevision: input.request.baseRevision, commands: [
      { type: 'addField', entityId: input.request.entity.id, field: { id: 'night-note', name: '备注', type: 'text', required: false } },
      { type: 'configureBlockFields', blockId: input.request.block.id, fieldIds: [...input.request.block.fieldIds, 'night-note'] },
    ] }, capabilityIds: [] })
  }))
  t.after(() => host.dispose())
  host.setSelection('registration-form')
  const before = runtime.getSnapshot()
  await host.callbacks.onRequestPlan('在选中报名表单新增可选备注字段')
  assert.equal(runtime.getSnapshot(), before, 'preview is read-only')
  const preview = host.getSnapshot().preview
  assert.ok(preview.changes.some(change => change.operation === 'addField'))
  await host.callbacks.onConfirm(preview.planId)
  assert.equal(runtime.getSnapshot().revision, 1)
  assert.equal(session.getSnapshot().revision, 1)
  assert.ok(runtime.getSnapshot().spec.blocks.find(b => b.id === 'registration-form').fieldIds.includes('night-note'))
  const edited = runtime.getSnapshot()
  host.setMode('run'); host.setMode('blocks')
  assert.equal(runtime.getSnapshot(), edited)
  assert.equal(runtime.customProject, session)
  assert.equal(host.getSnapshot().lastApplied.receipt.committedRevision, 1)
  assert.equal(modelCalls, 1, 'no repair, independent review or second generation call')
})
