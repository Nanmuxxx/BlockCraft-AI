import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createWorkshopMochiConversation } from '../../src/integrations/mochi-ai/workshop.mjs'
import { createMochiConversation } from '../../src/integrations/mochi-ai/client.mjs'
import { binding } from '../../src/integrations/mochi-ai/protocol.mjs'
import { createMochiService } from '../../server/mochi-ai/service.mjs'
import { context, request, advice, access, grant } from './fixtures.mjs'
const require = createRequire(import.meta.url)
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { unavailablePlanProvider } = require('../../src/integrations/mochi/planning.ts')
const { createAppRuntime } = require('../../src/model/appRuntime.ts')
const { createClubRegistrationExample } = require('../../src/model/appSpecExamples.ts')
const { api: customApi, artifact } = require('../custom-block/fixtures.cjs')
const { makeGalleryRuntime, makeGalleryState, pngBytes } = require('../project-package/fixtures.cjs')
const { createMochiContextProjection } = await import('../../src/integrations/mochi-ai/context.mjs')
const { validateContext } = await import('../../src/integrations/mochi-ai/protocol.mjs')

for (const galleryOnly of [false, true]) test(`real ${galleryOnly ? 'gallery-only' : 'mixed gallery'} host admits structure without image or asset egress`, t => {
  let runtime
  if (galleryOnly) {
    const state = makeGalleryState()
    state.spec.blocks = state.spec.blocks.filter(block => block.type === 'gallery')
    state.spec.entities = []; state.spec.relations = []; state.records = {}; state.timers = {}; state.blockPositions = {}
    runtime = createAppRuntime(state)
  } else runtime = makeGalleryRuntime()
  const before = runtime.customProject.getSnapshot()
  const host = createMochiHost(runtime, unavailablePlanProvider)
  const projection = createMochiContextProjection(host, { readReferences: () => [], registry: runtime.customProject.registry })
  t.after(() => { projection.dispose(); host.dispose() })
  host.setSelection('package-gallery')
  const context = projection.read()
  assert.deepEqual(context.blocks.find(block => block.type === 'gallery'), { id: 'package-gallery', name: '项目图片', type: 'gallery', fieldIds: [] })
  assert.equal(context.relations.some(relation => relation.blockId === 'package-gallery'), false)
  const wire = JSON.stringify(context)
  for (const privateText of ['data:image', pngBytes.toString('base64'), 'fixture-png', '固定像素', '红绿蓝白', 'assets', 'imageIds', 'ZIP 保留记录']) assert.equal(wire.includes(privateText), false, privateText)
  assert.throws(() => validateContext({ ...context, blocks: context.blocks.map(block => block.type === 'gallery' ? { ...block, fieldIds: ['invented-field'] } : block) }), { code: 'INVALID_INPUT' })
  if (!galleryOnly) assert.throws(() => validateContext({ ...context, relations: [...context.relations, { blockId: 'package-gallery', entityId: context.entities[0].id }] }), { code: 'INVALID_INPUT' })
  assert.strictEqual(runtime.customProject.getSnapshot(), before)
})

test('explicit advice-only adapter supports advice without another host or any Runtime write', async t => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const before = runtime.getSnapshot()
  const owner = runtime.customProject, projectBefore = owner.getSnapshot()
  const host = createMochiHost(runtime, unavailablePlanProvider)
  let calls = 0, writes = 0, clock = 0
  const unsubscribe = runtime.subscribe(() => writes++)
  const api = {
    status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }),
    consent: async enabled => ({ proactiveEnabled: enabled }),
    analyze: async input => {
      calls++
      assert.equal(JSON.stringify(input).includes('小林'), false)
      return { version: 1, source: 'deepseek', capabilities: { modifications: false }, binding: binding(input.context), message: '可以再明确报名时间。', suggestions: [
        { id: `ai-${String(calls).padStart(32, '0')}`, text: '要不要明确报名截止时间？', reason: '便于安排。', blockId: before.spec.blocks[0].id, priority: 'medium', requiresUserAction: true, kind: 'design-change' },
      ] }
    },
  }
  const bridge = createWorkshopMochiConversation(host, { api, now: () => clock, settleMs: 5, planningEnabled: false })
  t.after(() => { bridge.dispose(); unsubscribe(); host.dispose() })
  await bridge.conversation.refreshStatus()
  await bridge.conversation.chat('下一步怎么完善？')
  const suggestion = bridge.conversation.getSnapshot().suggestions[0]
  assert.throws(() => bridge.conversation.requestModification(suggestion.id), { code: 'AI_MODIFICATION_DISABLED' })
  bridge.conversation.focusSuggestion(suggestion.id)
  assert.equal(host.getSnapshot().context.selectedBlockId, before.spec.blocks[0].id)
  await bridge.conversation.setProactive(true)
  clock += 31_000
  host.setSelection(before.spec.blocks[1].id)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(calls, 2)
  const view = host.getSnapshot()
  host.setAnchor({ ...view.context, epoch: view.epoch, rect: { x: 1, y: 2 } })
  host.setMode('run'); host.setMode('blocks')
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(calls, 2)
  assert.equal(bridge.conversation.getSnapshot().modificationsEnabled, false)
  bridge.dispose()
  host.setSelection(null)
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(calls, 2); assert.equal(writes, 0)
  assert.strictEqual(runtime.getSnapshot(), before)
  assert.strictEqual(runtime.customProject, owner)
  assert.strictEqual(owner.getSnapshot(), projectBefore)
})

test('mixed v2 context uses the existing owner registry without invented bindings or data egress', async t => {
  // The opaque host UUID may legitimately contain a parameter's numeric text.
  // Force that collision so privacy assertions cannot become probabilistic.
  t.mock.method(globalThis.crypto, 'randomUUID', () => '60000000-0000-4000-8000-000000000000')
  const runtime = createAppRuntime(createClubRegistrationExample())
  const owner = runtime.customProject
  const source = artifact(), versionDigest = await customApi.computeVersionDigest(source)
  assert.equal((await owner.install({ baseRevision: 0,
    instance: { id: 'custom-1', definitionId: source.manifest.definitionId, versionDigest, props: { durationSeconds: 600 } },
    artifact: { versionDigest, artifact: source }, expectedReference: null,
  })).ok, true)
  const host = createMochiHost(runtime, unavailablePlanProvider)
  const before = owner.getSnapshot(), authorization = owner.getAuthorization()
  let calls = 0
  const api = { status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }), analyze: async input => {
    calls++
    const custom = input.context.blocks.find(b => b.id === 'custom-1')
    assert.deepEqual(custom, { id: 'custom-1', name: source.manifest.name, type: 'custom', fieldIds: [], parameters: [{ name: 'durationSeconds', type: 'integer', required: true }] })
    assert.equal(input.context.relations.some(r => r.blockId === 'custom-1'), false)
    assert.equal(input.context.instanceId, host.getSnapshot().context.instanceId)
    const { instanceId: _opaqueIdentity, ...structure } = input.context
    const wire = JSON.stringify({ ...input, context: structure })
    for (const secret of ['600', 'sources', 'remainingSeconds', 'fixture must never execute', 'dependencies', '小林']) assert.equal(wire.includes(secret), false, secret)
    return { version: 1, source: 'deepseek', capabilities: { modifications: false }, binding: binding(input.context), message: '可以说明倒计时结束后的提示。', suggestions: [] }
  } }
  const bridge = createWorkshopMochiConversation(host, { api, customContext: {
    readReferences: () => owner.getSnapshot().custom.instances, registry: owner.registry,
  } })
  t.after(() => { bridge.dispose(); host.dispose() })
  await new Promise(resolve => setImmediate(resolve))
  await bridge.conversation.refreshStatus()
  for (const selected of ['registration-form', 'custom-1']) {
    host.setSelection(selected)
    await bridge.conversation.chat('这块积木如何完善？')
  }
  assert.equal(calls, 2)
  assert.strictEqual(runtime.customProject, owner)
  assert.strictEqual(owner.getSnapshot(), before)
  assert.strictEqual(owner.getAuthorization(), authorization)
})

test('default service keeps legacy host app binding even when consent names another project', async () => {
  const input = request('proactive')
  input.context.appId = 'another-project'
  input.context.instanceId = 'another-project-instance'
  const options = { provider: { configured: true, analyze: async () => advice() }, enabled: true,
    approval: grant(Date.now()), reserveBudget: () => true }
  const legacyHost = createMochiService(options)
  legacyHost.consent(access, { enabled: true, appId: input.context.appId, instanceId: input.context.instanceId })
  await assert.rejects(legacyHost.analyze(access, input), { code: 'CONTEXT_MISMATCH' })

  const localStudioHost = createMochiService({ ...options, authorizeContext: () => true })
  localStudioHost.consent(access, { enabled: true, appId: input.context.appId, instanceId: input.context.instanceId })
  const result = await localStudioHost.analyze(access, input)
  assert.equal(result.binding.appId, input.context.appId)
})

test('legacy and delayed status or consent responses cannot restore another project consent', async () => {
  let current = context(), statusImpl, serverConsent = null, finishConsent, consentStarted
  const consentHasStarted = new Promise(resolve => { consentStarted = resolve })
  const api = {
    status: async () => statusImpl(),
    consent: async (enabled, options) => {
      if (enabled) return new Promise(resolve => { finishConsent = () => { serverConsent = options; resolve({ proactiveEnabled: true }) }; consentStarted() })
      serverConsent = null
      return { proactiveEnabled: false }
    },
    analyze: async () => { throw new Error('analysis is not part of this test') },
  }
  const client = createMochiConversation({ api, readContext: () => current })
  const projectA = { ...current }
  const projectB = { ...current, appId: 'another-project', instanceId: 'another-project-instance' }
  client.syncContext()
  statusImpl = async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false })
  await client.refreshStatus()

  const delayedConsent = client.setProactive(true)
  await consentHasStarted
  assert.equal(typeof finishConsent, 'function')
  current = projectB; client.syncContext()
  finishConsent(); await delayedConsent
  statusImpl = async () => ({ enabled: true, proactiveEnabled: true, proactiveAppId: serverConsent.appId, proactiveInstanceId: serverConsent.instanceId, modificationsEnabled: false })
  await client.refreshStatus()
  assert.equal(client.getSnapshot().proactiveEnabled, false)

  // A pre-transition status reply is retired even when it names project A.
  let finishStatus, statusStarted
  const statusHasStarted = new Promise(resolve => { statusStarted = resolve })
  statusImpl = () => new Promise(resolve => { finishStatus = resolve; statusStarted() })
  const delayedStatus = client.refreshStatus()
  await statusHasStarted
  current = projectA; client.syncContext()
  current = projectB; client.syncContext()
  finishStatus({ enabled: true, proactiveEnabled: true, proactiveAppId: projectA.appId, modificationsEnabled: false })
  await delayedStatus
  assert.equal(client.getSnapshot().proactiveEnabled, false)

  // Legacy adapters remain usable on their initial project but cannot carry a
  // global-looking status across a project transition.
  current = projectA; client.syncContext()
  statusImpl = async () => ({ enabled: true, proactiveEnabled: true, modificationsEnabled: false })
  await client.refreshStatus()
  assert.equal(client.getSnapshot().proactiveEnabled, false)
  client.dispose()
})
