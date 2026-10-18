import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkshopMochiConversation } from '../../src/integrations/mochi-ai/workshop.mjs'
import { binding } from '../../src/integrations/mochi-ai/protocol.mjs'
import { context } from './fixtures.mjs'
const settle = () => new Promise(resolve => setTimeout(resolve, 15))
test('host bridge listens to settled structural events, ignores records/anchors/mode, and cleans up', async () => {
  let view = { context: context(), mode: 'blocks' }, listener, calls = 0
  const host = { getSnapshot: () => view, subscribe(fn) { listener = fn; return () => { listener = null } }, setSelection() {} }
  const api = { status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }), consent: async enabled => ({ proactiveEnabled: enabled }), analyze: async input => {
    calls++; return { version: 1, source: 'deepseek', capabilities: { modifications: false }, binding: binding(input.context), message: '结构不错。', suggestions: [] }
  } }
  const bridge = createWorkshopMochiConversation(host, { api, settleMs: 5 })
  await bridge.conversation.refreshStatus()
  view = { ...view, context: { ...view.context, revision: 1 } }; listener(); await settle(); assert.equal(calls, 0)
  await bridge.conversation.setProactive(true)
  // Measurements and record-only revision notifications are deliberately irrelevant.
  listener(); view = { ...view, context: { ...view.context, revision: 2 } }; listener()
  view = { ...view, mode: 'run' }; listener(); await settle(); assert.equal(calls, 0)
  view = structuredClone(view); view.context.entities[0].fields[0].name = '参与者姓名'; listener(); listener() // anchor notifications must not erase the scheduled event
  await settle(); assert.equal(calls, 1)
  bridge.dispose(); assert.equal(listener, null)
})
