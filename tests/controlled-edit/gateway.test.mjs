import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { validatePlanInput, validateFieldCandidate } from '../../server/mochi-plan.mjs'
import { createAppServer } from '../../server/index.mjs'

const require = createRequire(import.meta.url), ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { createAppRuntime } = require('../../src/model/appRuntime.ts')
const { createReadingLogExample } = require('../../src/model/appSpecExamples.ts')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { toMinimalPlanInput } = require('../../src/integrations/mochi/planning.ts')
const { createHttpPlanProvider } = require('../../src/integrations/mochi/httpPlanProvider.ts')
const { createModelPlanProvider, APP_SPEC_EDIT_INSTRUCTION } = require('../../src/integrations/mochi/modelPlanProvider.ts')
const candidate = (i, commands, capabilityIds = []) => ({ request: { requestId: i.requestId, baseRevision: i.baseRevision, commands }, capabilityIds })
const input = type => ({ appId: 'project', requestId: 'controlled-edit', baseRevision: 7, prompt: '调整选中积木',
  blockOrder: ['before', 'selected', 'after'], reservedIds: ['project', 'entity', 'name', 'amount', 'before', 'selected', 'after', 'custom-instance'],
  block: type === 'gallery' ? { id: 'selected', name: '图库', type, imageIds: ['image'], layout: 'grid', interaction: 'preview' }
    : type === 'metric' ? { id: 'selected', name: '统计', type, aggregation: 'count' }
      : { id: 'selected', name: '表单', type, fieldIds: ['name', 'amount'] },
  ...(type === 'gallery' ? { assets: [{ id: 'image', name: '图片', mimeType: 'image/png' }] } : {
    entity: { id: 'entity', name: '记录', fields: [{ id: 'name', name: '名称', type: 'text', required: true }, { id: 'amount', name: '金额', type: 'number', required: false }] },
  }),
})
const add = (type, id = 'new-block') => type === 'gallery'
  ? { type: 'addBlock', block: { id, name: '新图库', type, protocolVersion: 1, imageIds: [], layout: 'grid', interaction: 'preview' } }
  : { type: 'addBlock', block: { id, name: '新积木', type, ...(type === 'metric' ? { aggregation: 'sum', fieldId: 'amount' } : { fieldIds: ['name'] }) },
    binding: { id: `${id}-binding`, type: 'dataBinding', blockId: id, entityId: 'entity' } }
const capability = type => type === 'metric' ? 'metric-sum' : type
const reject = (i, commands, capabilities = []) => assert.throws(() => validateFieldCandidate(candidate(i, commands, capabilities), i), { code: 'AI_INVALID_RESPONSE' })

test('offline gateway accepts configuration, add, selected deletion and reorder for form/gallery/metric', () => {
  for (const type of ['form', 'gallery', 'metric']) {
    const i = validatePlanInput(input(type))
    const configure = type === 'form' ? { type: 'configureBlockPresentation', blockId: 'selected', presentation: { buttonText: '提交修改', borderRadius: 12 } }
      : type === 'gallery' ? { type: 'configureGallery', blockId: 'selected', imageIds: [] }
        : { type: 'configureMetric', blockId: 'selected', aggregation: 'average', fieldId: 'amount' }
    const configurations = candidate(i, [configure])
    assert.equal(validateFieldCandidate(configurations, i), configurations)
    const additions = candidate(i, [add(type), { type: 'reorderBlocks', blockIds: ['new-block', 'before', 'after', 'selected'] }], [capability(type)])
    assert.equal(validateFieldCandidate(additions, i), additions)
    assert.doesNotThrow(() => validateFieldCandidate(candidate(i, [{ type: 'removeBlock', blockId: 'selected' }, { type: 'reorderBlocks', blockIds: ['before', 'after'] }]), i))
    assert.doesNotThrow(() => validateFieldCandidate(candidate(i, [{ type: 'reorderBlocks', blockIds: ['selected', 'before', 'after'] }]), i))
  }
  assert.doesNotThrow(() => validateFieldCandidate(candidate(input('list'), [{ type: 'removeBlock', blockId: 'selected' }]), input('list')))
  assert.doesNotThrow(() => validateFieldCandidate(candidate(input('form'), [add('metric')], ['metric-sum']), input('form')))
  assert.doesNotThrow(() => validateFieldCandidate(candidate(input('form'), [add('gallery')], ['gallery']), input('form')))
})

test('metric count removes fieldId and numeric aggregations reject invalid fields and shape', () => {
  const i = input('metric'); i.block.aggregation = 'sum'; i.block.fieldId = 'amount'
  assert.doesNotThrow(() => validateFieldCandidate(candidate(i, [{ type: 'configureMetric', blockId: 'selected', aggregation: 'count' }]), i))
  for (const config of [{ aggregation: 'count', fieldId: 'amount' }, { aggregation: 'sum' }, { aggregation: 'sum', fieldId: 'name' }, { aggregation: 'average', fieldId: 'missing' }, { aggregation: 'execute', fieldId: 'amount' }]) {
    reject(i, [{ type: 'configureMetric', blockId: 'selected', ...config }])
  }
  reject(i, [add('metric')], [])
  const invalidAddition = add('metric'); invalidAddition.block.fieldId = 'name'; reject(i, [invalidAddition], ['metric-sum'])
  reject(i, [add('metric')], ['metric'])
  reject(i, [add('metric')], ['metric-count'])
})

test('reorder rejects omitted/duplicate/foreign/custom IDs, unauthorized relative swaps and no-ops', () => {
  const i = input('form')
  for (const blockIds of [['selected', 'before'], ['selected', 'before', 'before'], ['selected', 'before', 'missing'], ['selected', 'before', 'custom-instance'], ['after', 'selected', 'before'], i.blockOrder]) reject(i, [{ type: 'reorderBlocks', blockIds }])
  reject(i, [{ type: 'reorderBlocks', blockIds: ['new-block', ...i.blockOrder] }, add('form')], ['form'])
  reject(i, [add('form'), { type: 'reorderBlocks', blockIds: ['selected', 'before', 'after'] }], ['form'])
  const oldInput = input('form'); delete oldInput.blockOrder; reject(oldInput, [{ type: 'reorderBlocks', blockIds: ['selected'] }])
})

test('stale bindings, foreign targets, removed targets, occupied IDs and unknown data fail closed', () => {
  for (const type of ['form', 'gallery', 'metric']) {
    const i = input(type), stale = candidate(i, [{ type: 'removeBlock', blockId: 'selected' }]); stale.request.baseRevision--
    assert.throws(() => validateFieldCandidate(stale, i), { code: 'AI_INVALID_RESPONSE' })
    reject(i, [{ type: 'removeBlock', blockId: 'before' }])
    reject(i, [{ type: 'removeBlock', blockId: 'selected' }, { type: 'removeBlock', blockId: 'selected' }])
    reject(i, [add(type, 'custom-instance')], [capability(type)])
    assert.throws(() => validatePlanInput({ ...i, records: { private: 'never-send' } }), { code: 'INVALID_INPUT' })
    assert.throws(() => validatePlanInput({ ...i, blockOrder: ['selected', 'selected'] }), { code: 'INVALID_INPUT' })
  }
  const i = input('metric')
  reject(i, [{ type: 'removeBlock', blockId: 'selected' }, { type: 'configureMetric', blockId: 'selected', aggregation: 'sum', fieldId: 'amount' }])
  const g = input('gallery'); reject(g, [{ type: 'configureGallery', blockId: 'selected', imageIds: ['unknown'] }])
})

test('minimal metric input keeps app/revision/current order/config/occupied IDs and excludes private data', async () => {
  const runtime = createAppRuntime(createReadingLogExample())
  let projected
  const host = createMochiHost(runtime, request => {
    projected = toMinimalPlanInput({ ...request, context: { ...request.context, reservedIds: [...request.context.reservedIds, 'custom-secret-id'] } })
    throw new Error('offline fixture ends after projection')
  })
  host.setSelection('reading-total'); await assert.rejects(host.callbacks.onRequestPlan('改为平均阅读时间'))
  assert.equal(projected.appId, runtime.getSnapshot().spec.id)
  assert.equal(projected.baseRevision, runtime.getSnapshot().revision)
  assert.deepEqual(projected.block, { id: 'reading-total', name: '累计分钟', type: 'metric', aggregation: 'sum', fieldId: 'minutes' })
  assert.deepEqual(projected.blockOrder, runtime.customProject.getSnapshot().renderOrder.filter(item => item.kind === 'builtin').map(item => item.id))
  assert.ok(projected.reservedIds.includes('custom-secret-id'))
  for (const secret of ['records', '阅读第一章', '乡土中国', 'dataUrl', 'sourceCode', 'props', 'apiKey']) assert.equal(JSON.stringify(projected).includes(secret), false, secret)
  assert.doesNotThrow(() => validatePlanInput(projected)); host.dispose()
})

test('HTTP offline fixture reaches unchanged project preview, confirms metric change and reverses it', async () => {
  const runtime = createAppRuntime(createReadingLogExample()), before = runtime.getSnapshot()
  const host = createMochiHost(runtime, createHttpPlanProvider(async (_url, init) => {
    const i = validatePlanInput(JSON.parse(init.body))
    return Response.json({ candidate: validateFieldCandidate(candidate(i, [{ type: 'configureMetric', blockId: i.block.id, aggregation: 'average', fieldId: 'minutes' }]), i), source: 'offline-fixture', model: 'offline-fixture' })
  }))
  host.setSelection('reading-total'); await host.callbacks.onRequestPlan('改为平均阅读分钟')
  assert.equal(runtime.getSnapshot(), before)
  const preview = host.getSnapshot().preview; assert.ok(preview.changes.some(change => change.operation === 'configureMetric'))
  await host.callbacks.onConfirm(preview.planId)
  assert.equal(runtime.getSnapshot().spec.blocks.find(block => block.id === 'reading-total').aggregation, 'average')
  assert.deepEqual(runtime.getSnapshot().records, before.records)
  assert.equal(runtime.executeCommand({ requestId: 'undo-http-metric', baseRevision: runtime.getSnapshot().revision, commands: [{ type: 'undo' }] }).ok, true)
  assert.deepEqual(runtime.getSnapshot().spec, before.spec); host.dispose()
})

test('metric count/sum/average additions use existing capability IDs through HTTP provider and real Host confirmation', async () => {
  for (const aggregation of ['count', 'sum', 'average']) {
    const runtime = createAppRuntime(createReadingLogExample()), before = runtime.getSnapshot()
    const id = `new-metric-${aggregation}`
    const block = { id, name: `新增${aggregation}`, type: 'metric', aggregation, ...(aggregation === 'count' ? {} : { fieldId: 'minutes' }) }
    const host = createMochiHost(runtime, createHttpPlanProvider(async (_url, init) => {
      const i = validatePlanInput(JSON.parse(init.body))
      const c = candidate(i, [{ type: 'addBlock', block, binding: { id: `${id}-binding`, type: 'dataBinding', blockId: id, entityId: i.entity.id } }], [`metric-${aggregation}`])
      return Response.json({ candidate: validateFieldCandidate(c, i), source: 'offline-fixture', model: 'offline-fixture' })
    }))
    try {
      host.setSelection('reading-total'); await host.callbacks.onRequestPlan(`增加${aggregation}统计`)
      assert.equal(runtime.getSnapshot(), before, aggregation)
      const preview = host.getSnapshot().preview
      assert.ok(preview?.changes.some(change => change.operation === 'addBlock' && change.target === id), aggregation)
      await host.callbacks.onConfirm(preview.planId)
      assert.deepEqual(runtime.getSnapshot().spec.blocks.find(item => item.id === id), block, aggregation)
      assert.deepEqual(runtime.getSnapshot().records, before.records)
      assert.equal(runtime.executeCommand({ requestId: `undo-${id}`, baseRevision: runtime.getSnapshot().revision, commands: [{ type: 'undo' }] }).ok, true)
      assert.deepEqual(runtime.getSnapshot().spec, before.spec, aggregation)
    } finally { host.dispose() }
  }
})

test('model adapter keeps JSON-only instruction and lets host reject malformed or expired responses without writes', async () => {
  assert.match(APP_SPEC_EDIT_INSTRUCTION, /configureMetric/); assert.match(APP_SPEC_EDIT_INSTRUCTION, /reorderBlocks/)
  for (const malformed of [false, true]) {
    const runtime = createAppRuntime(createReadingLogExample()), before = runtime.getSnapshot()
    const host = createMochiHost(runtime, createModelPlanProvider(async ({ request }) => {
      if (malformed) return '```js; execute()```'
      const stale = candidate(request, [{ type: 'removeBlock', blockId: request.block.id }]); stale.request.baseRevision++
      return JSON.stringify(stale)
    }))
    host.setSelection('reading-total'); await assert.rejects(host.callbacks.onRequestPlan('移除统计'))
    assert.equal(runtime.getSnapshot(), before); assert.equal(host.getSnapshot().preview, null); host.dispose()
  }
})

test('real HTTP server accepts all four operations for form/gallery/metric through injected offline completion', async t => {
  let calls = 0, captured
  const server = createAppServer({ apiKey: 'offline-fixture-key', fieldPlanning: { enabled: true, resolveAccess: () => true }, fetchImpl: async (_url, init) => {
    calls++; captured = JSON.parse(init.body); const i = JSON.parse(captured.messages[1].content)
    const operation = i.prompt
    const commands = operation === 'add' ? [add(i.block.type)]
      : operation === 'remove' ? [{ type: 'removeBlock', blockId: i.block.id }]
        : operation === 'reorder' ? [{ type: 'reorderBlocks', blockIds: ['selected', 'before', 'after'] }]
          : i.block.type === 'metric' ? [{ type: 'configureMetric', blockId: i.block.id, aggregation: 'sum', fieldId: 'amount' }]
            : i.block.type === 'gallery' ? [{ type: 'configureGallery', blockId: i.block.id, imageIds: [] }]
              : [{ type: 'configureBlockPresentation', blockId: i.block.id, presentation: { borderRadius: 10 } }]
    const c = candidate(i, commands, operation === 'add' ? [capability(i.block.type)] : [])
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(c) } }] })
  } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  for (const type of ['form', 'gallery', 'metric']) for (const operation of ['configure', 'add', 'remove', 'reorder']) {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/api/mochi-plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input(type), prompt: operation }) })
    assert.equal(result.status, 200, `${type}/${operation}`)
    const body = await result.json(); assert.equal(body.source, 'offline-fixture')
    assert.equal(body.candidate.request.commands[0].type, operation === 'configure' ? { form: 'configureBlockPresentation', gallery: 'configureGallery', metric: 'configureMetric' }[type] : { add: 'addBlock', remove: 'removeBlock', reorder: 'reorderBlocks' }[operation])
  }
  assert.equal(calls, 12)
  assert.match(captured.messages[0].content, /reorderBlocks/); assert.equal(captured.messages[1].content.includes('records'), false)
})
