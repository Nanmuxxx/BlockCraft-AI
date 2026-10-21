const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { createAppRuntime } = require('../../src/model/appRuntime.ts')
const { createClubRegistrationExample } = require('../../src/model/appSpecExamples.ts')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { createHttpPlanProvider } = require('../../src/integrations/mochi/httpPlanProvider.ts')

test('HTTP provider -> host preview -> confirm supports add/hide/restore, preserving records and layout', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample()), original = runtime.getSnapshot()
  const inputs = []
  const provider = createHttpPlanProvider(async (url, init) => {
    assert.equal(url, '/api/mochi-plan'); assert.equal(init.redirect, 'error'); assert.ok(init.signal)
    const i = JSON.parse(init.body); inputs.push(i)
    assert.ok(!init.body.includes('小林')); assert.ok(!init.body.includes('技术部')); assert.ok(!Object.hasOwn(i, 'records'))
    const fieldIds = i.prompt === 'hide' ? i.block.fieldIds.filter(id => id !== 'note') : [...new Set([...i.block.fieldIds, 'note'])]
    const commands = [...(i.prompt === 'add' ? [{ type: 'addField', entityId: i.entity.id, field: { id: 'note', name: '备注', type: 'text', required: false } }] : []),
      { type: 'configureBlockFields', blockId: i.block.id, fieldIds }]
    return Response.json({ source: 'offline-fixture', model: 'offline', candidate: { request: { requestId: i.requestId, baseRevision: i.baseRevision, commands }, capabilityIds: [] } })
  })
  const host = createMochiHost(runtime, provider); host.setSelection('registration-form')
  for (const [index, action] of ['add', 'hide', 'restore'].entries()) {
    const before = runtime.getSnapshot()
    await host.callbacks.onRequestPlan(action)
    assert.strictEqual(runtime.getSnapshot(), before, 'no writes before confirmation')
    const preview = host.getSnapshot().preview; assert.ok(preview)
    await host.callbacks.onConfirm(preview.planId)
    const after = runtime.getSnapshot()
    assert.equal(after.revision, index + 1)
    assert.equal(after.spec.entities[0].fields.filter(f => f.id === 'note').length, 1)
    assert.equal(after.spec.blocks[0].fieldIds.includes('note'), action !== 'hide')
    assert.deepEqual(after.records, original.records); assert.deepEqual(after.blockPositions, original.blockPositions)
  }
  assert.equal(inputs.length, 3); assert.equal(inputs[2].entity.fields.find(f => f.id === 'note').required, false)
  host.dispose()
})
test('HTTP failures, unverified provenance, cancelled/stale plans make no writes', async () => {
  for (const response of [Response.json({ error: 'offline' }, { status: 503 }), Response.json({ source: 'invented', model: 'x', candidate: {} })]) {
    const runtime = createAppRuntime(createClubRegistrationExample()), before = runtime.getSnapshot()
    const host = createMochiHost(runtime, createHttpPlanProvider(async () => response))
    host.setSelection('registration-form')
    await assert.rejects(host.callbacks.onRequestPlan('add'))
    assert.strictEqual(runtime.getSnapshot(), before); assert.equal(host.getSnapshot().preview, null)
    host.dispose()
  }
})
