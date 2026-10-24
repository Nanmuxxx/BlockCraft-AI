const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { createHttpPlanProvider } = require('../../src/integrations/mochi/httpPlanProvider.ts')
const { assertPlanIntent, resolvePlanIntent } = require('../../src/integrations/mochi/intent.mjs')
const { modificationErrors } = require('../../src/integrations/mochi-ai/errors.mjs')
const prompt = '只给表单增加一个可选文本字段备注'
const candidate = i => ({ request: { requestId: i.requestId, baseRevision: i.baseRevision, commands: [
  { type: 'addField', entityId: i.entity.id, field: { id: 'note', name: '备注', type: 'text', required: false } },
  { type: 'configureBlockFields', blockId: i.block.id, fieldIds: [...i.block.fieldIds, 'note'] },
] }, capabilityIds: [] })
const response = i => Response.json({ source: 'offline-fixture', model: 'offline', candidate: candidate(i) })
function setup(t, transport) {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const host = createMochiHost(runtime, createHttpPlanProvider(transport))
  host.setSelection('registration-form'); t.after(() => host.dispose())
  return { host, runtime }
}
test('same-tick duplicate and preview retry reuse one call; confirm once, exact shared impact and undo', async t => {
  let release, calls = 0
  const { host, runtime } = setup(t, (_url, init) => {
    assert.match(new Headers(init.headers).get('Idempotency-Key') ?? '', /^[A-Za-z0-9_-]{32,128}$/, 'production gateway requires a request identity')
    calls++; return new Promise(resolve => { release = () => resolve(response(JSON.parse(init.body))) })
  })
  const before = runtime.getSnapshot()
  const pending = host.callbacks.onRequestPlan(prompt)
  await assert.rejects(host.callbacks.onRequestPlan(prompt), { code: 'AI_BUSY' })
  assert.equal(calls, 1); assert.equal(runtime.getSnapshot(), before)
  release(); await pending
  const preview = host.getSnapshot().preview
  assert.match(preview.changes.find(c => c.operation === 'sharedEntityImpact').description, /必要的数据联动.*其他积木配置不变/)
  assert.equal(preview.changes.filter(c => c.operation === 'configureBlockFields').length, 1)
  await host.callbacks.onRequestPlan(prompt)
  assert.equal(host.getSnapshot().preview, preview); assert.equal(calls, 1)
  await Promise.all([host.callbacks.onConfirm(preview.planId), host.callbacks.onConfirm(preview.planId)])
  const after = runtime.getSnapshot()
  assert.equal(after.revision, before.revision + 1)
  assert.deepEqual(after.spec.blocks.find(b => b.id === 'applicant-list'), before.spec.blocks.find(b => b.id === 'applicant-list'))
  assert.deepEqual(after.spec.blocks.find(b => b.id === 'registration-form').fieldIds, [...before.spec.blocks[0].fieldIds, 'note'])
  assert.deepEqual(after.records, before.records)
  assert.equal(runtime.executeCommand({ requestId: 'undo-stability', baseRevision: after.revision, commands: [{ type: 'undo' }] }).ok, true)
  assert.deepEqual(runtime.getSnapshot().spec, before.spec); assert.deepEqual(runtime.getSnapshot().records, before.records)
})
test('failed manual retry gets one fresh attempt; cancellation and late response cannot mutate', async t => {
  let calls = 0, release
  const keys = []
  const { host, runtime } = setup(t, (_url, init) => {
    keys.push(new Headers(init.headers).get('Idempotency-Key'))
    calls++
    if (calls === 1) return Promise.resolve(Response.json({ error: { code: 'AI_INVALID_RESPONSE', message: 'PRIVATE' } }, { status: 502 }))
    return new Promise(resolve => { release = () => resolve(response(JSON.parse(init.body))) })
  })
  const before = runtime.getSnapshot()
  await assert.rejects(host.callbacks.onRequestPlan(prompt), { code: 'AI_INVALID_RESPONSE' })
  assert.equal(host.getSnapshot().error.message, modificationErrors.AI_INVALID_RESPONSE)
  assert.equal(calls, 1); assert.equal(runtime.getSnapshot(), before)
  const retry = host.callbacks.onRequestPlan(prompt); const rejected = assert.rejects(retry)
  await assert.rejects(host.callbacks.onRequestPlan(prompt), { code: 'AI_BUSY' })
  assert.equal(calls, 2)
  assert.notEqual(keys[0], keys[1], 'explicit retry has a fresh attempt identity')
  host.cancelRequest(host.getSnapshot().requestId); await rejected; release()
  await new Promise(r => setImmediate(r))
  assert.equal(runtime.getSnapshot(), before); assert.equal(host.getSnapshot().preview, null)
})
test('format, stale, config, permission and budget failures keep distinct fixed feedback and zero writes', async t => {
  for (const code of ['AI_INVALID_RESPONSE', 'STALE_REVISION', 'INVALID_CONFIG', 'PERMISSION_DENIED', 'BUDGET_EXHAUSTED', 'IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_REPLAY', 'IDEMPOTENCY_CONFLICT']) {
    let calls = 0
    const { host, runtime } = setup(t, async () => { calls++; return Response.json({ error: { code, message: 'PRIVATE' } }, { status: 422 }) })
    const before = runtime.getSnapshot()
    await assert.rejects(host.callbacks.onRequestPlan(prompt), { code })
    assert.deepEqual(host.getSnapshot().error, { code, message: modificationErrors[code] })
    assert.equal(calls, 1); assert.equal(runtime.getSnapshot(), before)
  }
})
test('field-only scope rejects extra category, wrong type, hidden field, implicit reorder and presentation expansion', () => {
  const i = { prompt, block: { id: 'form', type: 'form', fieldIds: ['name', 'email'] }, entity: { id: 'people' } }
  assert.doesNotThrow(() => assertPlanIntent(candidate(i), i))
  for (const mutate of [
    c => c.request.commands.push({ type: 'removeBlock', blockId: 'form' }),
    c => c.request.commands.push({ type: 'addBlock', block: { type: 'list' } }),
    c => c.request.commands.push({ type: 'configureBlockPresentation', presentation: { borderRadius: 12 } }),
    c => { c.request.commands[1].fieldIds = ['name', 'note'] },
    c => { c.request.commands[1].fieldIds = ['email', 'name', 'note'] },
    c => { c.request.commands[0].field.type = 'number' },
    c => { c.request.commands[0].field.name = '未经请求的字段' },
  ]) { const c = candidate(i); mutate(c); assert.throws(() => assertPlanIntent(c, i), { code: 'INTENT_SCOPE_VIOLATION' }) }
  assert.throws(() => resolvePlanIntent({ ...i, block: { ...i.block, type: 'list' } }), { code: 'INTENT_CLARIFICATION_REQUIRED' })
  for (const text of ['完善一下', '新增字段或者删除表单', '不要修改表单', '删除表单字段', '删除列表中的第一条记录', '增加表单验证', '新增图库上传功能']) assert.throws(() => resolvePlanIntent({ ...i, prompt: text }), { code: 'INTENT_CLARIFICATION_REQUIRED' })
  assert.doesNotThrow(() => resolvePlanIntent({ ...i, prompt: '恢复显示备注字段，不要新增字段' }))
})

test('display-only intent cannot hide unnamed fields, reveal extra fields or move a block instead of a field', () => {
  const i = { prompt: '隐藏邮箱字段', block: { id: 'form', type: 'form', fieldIds: ['name', 'email'] }, entity: { fields: [
    { id: 'name', name: '姓名' }, { id: 'email', name: '邮箱' }, { id: 'note', name: '备注' },
  ] } }
  const c = fieldIds => ({ request: { commands: [{ type: 'configureBlockFields', fieldIds }] } })
  assert.doesNotThrow(() => assertPlanIntent(c(['name']), i))
  for (const ids of [['email'], ['name', 'note'], ['email', 'name']]) assert.throws(() => assertPlanIntent(c(ids), i), { code: 'INTENT_SCOPE_VIOLATION' })
  assert.throws(() => assertPlanIntent(c(['name']), { ...i, prompt: '恢复显示邮箱字段' }), { code: 'INTENT_SCOPE_VIOLATION' })
  assert.throws(() => resolvePlanIntent({ ...i, prompt: '把姓名字段移到最前面' }), { code: 'INTENT_CLARIFICATION_REQUIRED' })
})

test('selected type, gallery direction and metric aggregation cannot contradict explicit intent', () => {
  assert.throws(() => resolvePlanIntent({ prompt: '删除列表积木', block: { type: 'form' } }), { code: 'INTENT_CLARIFICATION_REQUIRED' })
  assert.doesNotThrow(() => resolvePlanIntent({ prompt: '删除列表积木', block: { type: 'list' } }))
  const c = command => ({ request: { commands: [command] } })
  const gallery = { prompt: '隐藏当前画廊图片', block: { type: 'gallery', imageIds: ['cover'] } }
  assert.throws(() => assertPlanIntent(c({ type: 'configureGallery', imageIds: ['cover'] }), gallery), { code: 'INTENT_SCOPE_VIOLATION' })
  assert.throws(() => assertPlanIntent(c({ type: 'configureGallery', imageIds: [] }), { ...gallery, prompt: '恢复当前画廊图片' }), { code: 'INTENT_SCOPE_VIOLATION' })
  const metric = { prompt: '改为平均阅读时间', block: { type: 'metric', fieldId: 'minutes' }, entity: { fields: [{ id: 'pages', name: '页数' }] } }
  assert.doesNotThrow(() => assertPlanIntent(c({ type: 'configureMetric', aggregation: 'average', fieldId: 'minutes' }), metric))
  for (const command of [{ type: 'configureMetric', aggregation: 'sum', fieldId: 'minutes' }, { type: 'configureMetric', aggregation: 'average', fieldId: 'pages' }]) assert.throws(() => assertPlanIntent(c(command), metric), { code: 'INTENT_SCOPE_VIOLATION' })
})

test('metric target excludes the old title but rejects contradictory or repeated target instructions', () => {
  const i = { prompt: '把报名人数改成数量合计，使用数量字段', block: { type: 'metric', fieldId: 'minutes' }, entity: { fields: [{ id: 'quantity', name: '数量' }] } }
  const c = aggregation => ({ request: { commands: [{ type: 'configureMetric', aggregation, fieldId: 'quantity' }] } })
  assert.doesNotThrow(() => assertPlanIntent(c('sum'), i))
  for (const aggregation of ['average', 'count']) assert.throws(() => assertPlanIntent(c(aggregation), i), { code: 'INTENT_SCOPE_VIOLATION' })
  assert.doesNotThrow(() => assertPlanIntent(c('average'), { ...i, prompt: '把数量合计改为平均数量，使用数量字段' }))
  assert.throws(() => assertPlanIntent(c('sum'), { ...i, prompt: '把数量合计改为平均数量，使用数量字段' }), { code: 'INTENT_SCOPE_VIOLATION' })
  for (const prompt of ['把报名人数改成数量合计和平均数量', '把报名人数改成数量合计，再改为平均数量']) {
    assert.throws(() => assertPlanIntent(c('sum'), { ...i, prompt }), { code: 'INTENT_SCOPE_VIOLATION' })
  }
  assert.doesNotThrow(() => resolvePlanIntent({ prompt: '删除指标积木', block: { type: 'metric' } }))
  assert.throws(() => resolvePlanIntent({ prompt: '删除指标积木', block: { type: 'form' } }), { code: 'INTENT_CLARIFICATION_REQUIRED' })
})
