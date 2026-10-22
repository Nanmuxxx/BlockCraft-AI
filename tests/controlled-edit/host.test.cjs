const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppRuntime } = require('../custom-block/fixtures.cjs')
const { createClubRegistrationExample } = require('../../src/model/appSpecExamples.ts')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')

test('removing selection clears its authority; undo and another request remain usable', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  let remove = true
  const host = createMochiHost(runtime, input => ({
    request: { requestId: input.requestId, baseRevision: input.context.revision, commands: remove
      ? [{ type: 'removeBlock', blockId: input.context.selectedBlockId }]
      : [{ type: 'configureBlockPresentation', blockId: input.context.selectedBlockId, presentation: { backgroundColor: '#E9F3EF' } }] },
    capabilityIds: [],
  }))
  try {
    host.setSelection('registration-form')
    const before = runtime.customProject.getSnapshot()
    await host.callbacks.onRequestPlan('删除选中的表单')
    assert.strictEqual(runtime.customProject.getSnapshot(), before)
    await host.callbacks.onConfirm(host.getSnapshot().preview.planId)
    assert.equal(host.getSnapshot().phase, 'APPLIED')
    assert.equal(host.getSnapshot().context.selectedBlockId, null)
    assert.equal(host.getSnapshot().anchor, null)
    assert.equal(runtime.executeCommand({ requestId: 'undo-removal', baseRevision: runtime.getSnapshot().revision, commands: [{ type: 'undo' }] }).ok, true)
    assert.equal(host.getSnapshot().context.selectedBlockId, null)
    assert.deepEqual(runtime.getSnapshot().spec.blocks, before.base.spec.blocks)
    remove = false
    host.setSelection('applicant-list')
    await host.callbacks.onRequestPlan('为选中列表设置背景')
    await host.callbacks.onConfirm(host.getSnapshot().preview.planId)
    assert.equal(host.getSnapshot().phase, 'APPLIED')
    assert.equal(runtime.getSnapshot().spec.blocks.find(block => block.id === 'applicant-list').presentation.backgroundColor, '#E9F3EF')
  } finally { host.dispose() }
})
