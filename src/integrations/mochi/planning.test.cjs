require('./host.test.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppRuntime } = require('../../model/appRuntime.ts')
const { createClubRegistrationExample } = require('../../model/appSpecExamples.ts')
const { createMochiHost } = require('./host.ts')
const { unavailablePlanProvider, toMinimalPlanInput } = require('./planning.ts')

test('production provider fails closed and preserves the original runtime', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const host = createMochiHost(runtime, unavailablePlanProvider)
  const before = runtime.getSnapshot()
  host.setSelection('registration-form')
  await assert.rejects(host.callbacks.onRequestPlan('加字段'), { code: 'AI_MODIFICATION_DISABLED' })
  assert.equal(runtime.getSnapshot(), before)
  assert.equal(host.getSnapshot().preview, null)
  host.dispose()
})

test('egress allowlist excludes records, unrelated blocks and arbitrary injected properties', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  let input
  const host = createMochiHost(runtime, request => {
    input = toMinimalPlanInput({ ...request, secret: 'never-send', context: { ...request.context, secret: 'never-send' } })
    throw new Error('stop after projection')
  })
  host.setSelection('registration-form')
  await assert.rejects(host.callbacks.onRequestPlan('新增备注', { selectedBlockId: 'applicant-list' }))
  assert.deepEqual(Object.keys(input).sort(), ['requestId', 'baseRevision', 'prompt', 'block', 'entity'].sort())
  assert.equal(input.block.id, 'registration-form')
  const json = JSON.stringify(input)
  for (const value of ['records', '小林', '技术部', 'never-send', 'applicant-list', 'instanceId']) assert.ok(!json.includes(value), value)
  host.dispose()
})
