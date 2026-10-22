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

test('egress allowlist includes occupied structural IDs but excludes records, unrelated block details and injected properties', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  let input
  const host = createMochiHost(runtime, request => {
    input = toMinimalPlanInput({ ...request, secret: 'never-send', context: { ...request.context, secret: 'never-send' } })
    throw new Error('stop after projection')
  })
  host.setSelection('registration-form')
  await assert.rejects(host.callbacks.onRequestPlan('新增备注', { selectedBlockId: 'applicant-list' }))
  assert.deepEqual(Object.keys(input).sort(), ['requestId', 'baseRevision', 'prompt', 'block', 'entity', 'reservedIds'].sort())
  assert.equal(input.block.id, 'registration-form')
  assert.ok(input.reservedIds.includes('applicant-list'))
  assert.equal(new Set(input.reservedIds).size, input.reservedIds.length)
  const json = JSON.stringify(input)
  for (const value of ['records', '小林', '技术部', 'never-send', '报名名单', 'instanceId']) assert.ok(!json.includes(value), value)
  host.dispose()
})

test('gallery projection exposes only existing asset metadata and no image bytes', () => {
  const request = {
    requestId: 'gallery-request',
    prompt: '把第二张图加入画廊',
    context: {
      revision: 4,
      selectedBlockId: 'gallery-1',
      blocks: [{ id: 'gallery-1', name: '作品画廊', type: 'gallery', imageIds: ['img-1'], layout: 'grid', interaction: 'preview' }],
      relations: [], entities: [],
      assets: [
        { id: 'img-1', name: '第一张', altText: '封面', mimeType: 'image/png' },
        { id: 'img-2', name: '第二张', mimeType: 'image/jpeg' },
      ],
    },
  }
  const { toMinimalPlanInput } = require('./planning.ts')
  const input = toMinimalPlanInput(request)
  assert.deepEqual(input.block, { id: 'gallery-1', name: '作品画廊', type: 'gallery', imageIds: ['img-1'], layout: 'grid', interaction: 'preview' })
  assert.deepEqual(input.assets, [
    { id: 'img-1', name: '第一张', altText: '封面', mimeType: 'image/png' },
    { id: 'img-2', name: '第二张', mimeType: 'image/jpeg' },
  ])
  assert.equal(JSON.stringify(input).includes('dataUrl'), false)
})
