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

test('current main host supports advice without another host or any Runtime write', async t => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const before = runtime.getSnapshot()
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
  const bridge = createWorkshopMochiConversation(host, { api, now: () => clock, settleMs: 5 })
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
})
