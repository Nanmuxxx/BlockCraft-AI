const test = require('node:test')
const assert = require('node:assert/strict')
const { createClubRegistrationExample, createAppRuntime } = require('../custom-block/fixtures.cjs')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { mockAddOptionalField } = require('../../src/integrations/mochi/mockPlanner.ts')

for (const transition of ['cancel', 'selection', 'dispose', 'supersede']) {
  test(`Host ${transition} retires an abort-ignoring provider without waiting for it`, { timeout: 500 }, async () => {
    let rejectOld, calls = 0
    const runtime = createAppRuntime(createClubRegistrationExample())
    const host = createMochiHost(runtime, request => {
      if (++calls === 1) return new Promise((_, reject) => { rejectOld = reject })
      return mockAddOptionalField(request)
    })
    host.setSelection('registration-form')
    const before = runtime.getSnapshot()
    const old = host.callbacks.onRequestPlan('旧请求')
    const rejected = assert.rejects(old, { code: 'CONTEXT_CHANGED' })
    if (transition === 'cancel') host.cancelRequest(host.getSnapshot().requestId)
    else if (transition === 'selection') host.setSelection('applicant-list')
    else if (transition === 'dispose') host.dispose()
    else await host.callbacks.onRequestPlan('新请求')
    await rejected
    const current = host.getSnapshot()
    assert.equal(current.busy, false)
    assert.equal(runtime.getSnapshot(), before)
    if (transition === 'supersede') assert.equal(current.phase, 'PREVIEW')
    rejectOld(new Error('late ignored transport rejection'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(host.getSnapshot(), current)
    if (transition === 'supersede') {
      await host.callbacks.onConfirm(current.preview.planId)
      assert.equal(runtime.getSnapshot().revision, before.revision + 1)
      assert.equal(host.getSnapshot().phase, 'APPLIED')
      assert.equal(host.getSnapshot().lastApplied.requestId, current.requestId)
    }
    host.dispose()
  })
}

test('synchronous provider cancellation and throw leave no unhandled retirement', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  let host
  host = createMochiHost(runtime, request => {
    host.cancelRequest(request.requestId)
    throw new Error('synchronous provider failure after cancellation')
  })
  host.setSelection('registration-form')
  await assert.rejects(host.callbacks.onRequestPlan('取消'), { code: 'CONTEXT_CHANGED' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(host.getSnapshot().phase, 'CANCELLED')
  assert.equal(runtime.getSnapshot().revision, 0)
  host.dispose()
})
