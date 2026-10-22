import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiConversation } from '../../src/integrations/mochi-ai/client.mjs'
import { createWorkshopMochiConversation } from '../../src/integrations/mochi-ai/workshop.mjs'
import { binding } from '../../src/integrations/mochi-ai/protocol.mjs'
import { context, advice } from '../mochi-ai/fixtures.mjs'

const wire = input => ({ version: 1, source: 'deepseek', capabilities: { modifications: false }, binding: binding(input.context),
  ...advice(), suggestions: advice().suggestions.map(s => ({ ...s, id: `ai-${'9'.repeat(32)}` })) })
async function fixture(options = {}) {
  let current = { ...context(), selectedBlockId: null }, time = 1000, guard, plans = 0, ignored = 0
  const api = { status: async () => ({ enabled: true, proactiveEnabled: true, modificationsEnabled: false }),
    consent: async enabled => ({ proactiveEnabled: enabled }), analyze: async input => wire(input), ignore: async () => { ignored++ } }
  const client = createMochiConversation({ api, now: () => time, readContext: () => current,
    focusBlock(blockId) { current = { ...current, selectedBlockId: blockId }; client.syncContext() },
    requestPlan: async (_item, next) => { plans++; guard = next; next.validate(); return 'preview-only' }, ...options })
  await client.refreshStatus(); await client.onEvent({ type: 'project-opened' })
  const id = client.getSnapshot().suggestions[0].id
  return { client, id, api, guard: () => guard, plans: () => plans, ignored: () => ignored,
    tick(ms) { time += ms }, change(next) { current = next; client.syncContext() } }
}

test('suggestions have local lifetime, can be deferred/resumed, and wake only before expiry', async t => {
  const f = await fixture(); t.after(() => f.client.dispose())
  const first = f.client.getSnapshot().suggestions[0]
  assert.equal(first.createdAt, 1000); assert.equal(first.expiresAt, 601000)
  f.client.snooze(f.id)
  assert.equal(f.client.getSnapshot().suggestions.length, 0)
  assert.equal(f.client.getSnapshot().deferredSuggestions.length, 1)
  assert.throws(() => f.client.requestModification(f.id), { code: 'SUGGESTION_EXPIRED' })
  f.client.resume(f.id); assert.equal(f.client.getSnapshot().suggestions.length, 1)
  f.client.snooze(f.id); f.tick(60_000); f.client.refreshSuggestions()
  assert.equal(f.client.getSnapshot().suggestions.length, 1)
  f.client.snooze(f.id, 600_000); f.tick(540_000); f.client.refreshSuggestions()
  assert.equal(f.client.getSnapshot().suggestions.length, 0)
  assert.equal(f.client.getSnapshot().deferredSuggestions.length, 0)
  assert.throws(() => f.client.resume(f.id), { code: 'SUGGESTION_EXPIRED' })
})

test('reject accepts deferred suggestions and suppresses duplicate advice', async t => {
  const f = await fixture(); t.after(() => f.client.dispose())
  f.client.snooze(f.id); await f.client.reject(f.id)
  assert.equal(f.ignored(), 1); assert.deepEqual(f.client.getSnapshot().deferredSuggestions, [])
  await f.client.chat('重新分析')
  assert.deepEqual(f.client.getSnapshot().suggestions, [])
})

test('accepting generates a preview only and own target focus preserves the trusted guard', async t => {
  const f = await fixture(); t.after(() => f.client.dispose())
  assert.equal(f.client.getSnapshot().modificationsEnabled, false)
  assert.equal(f.client.getSnapshot().planningEnabled, true)
  assert.equal(await f.client.requestModification(f.id), 'preview-only')
  assert.equal(f.plans(), 1)
  f.guard().validate()
  f.tick(600_000)
  assert.throws(() => f.guard().validate(), { code: 'SUGGESTION_EXPIRED' })
})

for (const transition of ['revision', 'project', 'mode', 'consent', 'capability', 'cancel', 'dispose']) {
  test(`preview guard rejects after ${transition}`, async t => {
    const f = await fixture(); t.after(() => f.client.dispose())
    await f.client.requestModification(f.id)
    if (transition === 'revision') f.change({ ...context(), revision: 1 })
    if (transition === 'project') f.change({ ...context(), instanceId: 'replacement' })
    if (transition === 'mode') f.change({ ...context(), mode: 'run' })
    if (transition === 'consent') { await f.client.setProactive(false); await f.client.setProactive(true) }
    if (transition === 'capability') {
      f.api.status = async () => ({ enabled: false, proactiveEnabled: false, modificationsEnabled: false })
      await f.client.refreshStatus()
      f.api.status = async () => ({ enabled: true, proactiveEnabled: true, modificationsEnabled: false })
      await f.client.refreshStatus()
    }
    if (transition === 'cancel') f.client.cancel()
    if (transition === 'dispose') f.client.dispose()
    assert.throws(() => f.guard().validate())
  })
}

test('inert explanation cannot request a change plan', async t => {
  const f = await fixture(); t.after(() => f.client.dispose())
  f.tick(600_001)
  f.api.analyze = async input => { const reply = wire(input); reply.suggestions[0].kind = 'explain'; return reply }
  await f.client.chat('请解释')
  await assert.rejects(f.client.requestModification(f.id), { code: 'SUGGESTION_NOT_EXECUTABLE' })
  assert.equal(f.plans(), 0)
})

test('workshop uses trusted plan callback and never invokes confirmation', async t => {
  let current = { context: { ...context(), selectedBlockId: null }, mode: 'blocks' }, listener, plans = 0, confirms = 0, guard
  const host = { getSnapshot: () => current, subscribe(fn) { listener = fn; return () => {} },
    setSelection(blockId) { current = { ...current, context: { ...current.context, selectedBlockId: blockId } }; listener() },
    callbacks: { onRequestPlan(prompt, _ui, next) { assert.equal(prompt, advice().suggestions[0].text); plans++; guard = next }, onConfirm() { confirms++ } } }
  const bridge = createWorkshopMochiConversation(host, { settleMs: 100000, api: {
    status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }), analyze: async input => wire(input) } })
  t.after(() => bridge.dispose())
  await bridge.conversation.refreshStatus(); await bridge.conversation.chat('分析项目')
  await bridge.conversation.requestModification(bridge.conversation.getSnapshot().suggestions[0].id)
  assert.equal(plans, 1); assert.equal(confirms, 0); guard.validate()
})

test('disabled preview capability never focuses or dispatches', async t => {
  let focused = false
  const f = await fixture({ planningEnabled: false, focusBlock() { focused = true } }); t.after(() => f.client.dispose())
  assert.equal(f.client.getSnapshot().planningEnabled, false)
  assert.throws(() => f.client.requestModification(f.id), { code: 'AI_MODIFICATION_DISABLED' })
  assert.equal(focused, false); assert.equal(f.plans(), 0)
})

test('a project replacement during plan focus is rejected before dispatch', async t => {
  let f
  f = await fixture({ focusBlock() { f.change({ ...context(), appId: 'replacement' }) } }); t.after(() => f.client.dispose())
  await assert.rejects(f.client.requestModification(f.id), { code: 'CONTEXT_CHANGED' })
  assert.equal(f.plans(), 0)
})

test('workshop rejects unsupported targets before invoking the Host planner', async t => {
  let plans = 0
  const unsupported = { ...context(), selectedBlockId: 'form', blocks: [{ id: 'form', name: '计时器', type: 'pomodoro', fieldIds: [] }], entities: [], relations: [] }
  const host = { getSnapshot: () => ({ context: unsupported, mode: 'blocks' }), subscribe() { return () => {} }, setSelection() {},
    callbacks: { onRequestPlan() { plans++ } } }
  const bridge = createWorkshopMochiConversation(host, { api: { status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }), analyze: async input => wire(input) } })
  t.after(() => bridge.dispose())
  await bridge.conversation.refreshStatus(); await bridge.conversation.chat('分析')
  await assert.rejects(bridge.conversation.requestModification(bridge.conversation.getSnapshot().suggestions[0].id), { code: 'SUGGESTION_NOT_EXECUTABLE' })
  assert.equal(plans, 0)
})

test('project updates immediately clear active and deferred advice', async t => {
  const f = await fixture(); t.after(() => f.client.dispose())
  f.client.snooze(f.id); f.change({ ...context(), revision: 1 })
  assert.deepEqual(f.client.getSnapshot().suggestions, [])
  assert.deepEqual(f.client.getSnapshot().deferredSuggestions, [])
  assert.throws(() => f.client.resume(f.id), { code: 'SUGGESTION_EXPIRED' })
})

test('first-consent analysis is opt-in and cannot revive after revocation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const host = { getSnapshot: () => ({ context: context(), mode: 'blocks' }), subscribe() { return () => {} }, setSelection() {} }
  const api = { status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }),
    consent: async enabled => ({ proactiveEnabled: enabled }), analyze: async input => { calls++; return wire(input) } }
  const first = createWorkshopMochiConversation(host, { api, analyzeOnConsent: true, settleMs: 750 })
  t.after(() => first.dispose())
  await first.conversation.refreshStatus(); await first.conversation.setProactive(true)
  await first.conversation.setProactive(false); await first.conversation.setProactive(true)
  t.mock.timers.tick(751); await Promise.resolve(); await Promise.resolve()
  assert.equal(calls, 0)
  const second = createWorkshopMochiConversation(host, { api, analyzeOnConsent: true, settleMs: 750 })
  t.after(() => second.dispose())
  await second.conversation.refreshStatus(); await second.conversation.setProactive(true)
  t.mock.timers.tick(751); await Promise.resolve(); await Promise.resolve()
  assert.equal(calls, 1)
})
