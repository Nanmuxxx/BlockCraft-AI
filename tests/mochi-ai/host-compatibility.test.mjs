import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createWorkshopMochiConversation } from '../../src/integrations/mochi-ai/workshop.mjs'
import { binding } from '../../src/integrations/mochi-ai/protocol.mjs'
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
    const wire = JSON.stringify(input)
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
