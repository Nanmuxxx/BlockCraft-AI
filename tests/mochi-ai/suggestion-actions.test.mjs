import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiConversation } from '../../src/integrations/mochi-ai/client.mjs'
import { binding } from '../../src/integrations/mochi-ai/protocol.mjs'
import { context, advice } from './fixtures.mjs'

async function fixture(onFocus = () => {}, initial = context()) {
  let current = initial, focused = 0, ignored = 0, analyzed = 0
  const client = createMochiConversation({ readContext: () => current, focusBlock() { focused++; onFocus({ client, current, setContext: next => { current = next } }) }, api: {
    status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }),
    analyze: async input => {
      analyzed++
      const data = advice()
      return { version: 1, source: 'deepseek', capabilities: { modifications: false }, binding: binding(input.context), ...data,
        suggestions: data.suggestions.map(s => ({ ...s, id: `ai-${'1'.repeat(32)}` })) }
    },
    ignore: async () => { ignored++; return { ignored: true } },
  } })
  await client.refreshStatus(); await client.chat('分析当前报名应用')
  return { client, id: client.getSnapshot().suggestions[0].id, counts: () => ({ focused, ignored, analyzed }),
    replace() { current = { ...context(), appId: 'replacement', instanceId: 'replacement-instance' }; client.syncContext() } }
}

test('queued suggestion actions from a disposed conversation cannot focus or send network requests', async () => {
  const f = await fixture()
  f.client.dispose()
  assert.throws(() => f.client.focusSuggestion(f.id), { code: 'DISPOSED' })
  await assert.rejects(f.client.continueSuggestion(f.id), { code: 'DISPOSED' })
  await assert.rejects(f.client.ignore(f.id), { code: 'DISPOSED' })
  assert.deepEqual(f.counts(), { focused: 0, ignored: 0, analyzed: 1 })
})

for (const transition of ['dispose', 'replace']) test(`ignore publication followed by ${transition} cannot dispatch a retired action`, async () => {
  const f = await fixture()
  let once = true
  const off = f.client.subscribe(() => {
    if (!once) return
    once = false
    if (transition === 'dispose') f.client.dispose()
    else f.replace()
  })
  await assert.rejects(f.client.ignore(f.id), { code: transition === 'dispose' ? 'DISPOSED' : 'CONTEXT_CHANGED' })
  assert.equal(f.counts().ignored, 0)
  if (transition === 'replace') assert.deepEqual(f.client.getSnapshot().messages, [])
  off(); f.client.dispose()
})

for (const synchronize of [false, true]) test(`continued suggestion cannot cross a project replacement during focus (sync=${synchronize})`, async () => {
  const f = await fixture(({ client, current, setContext }) => {
    setContext({ ...current, appId: 'replacement', instanceId: 'replacement-instance' })
    if (synchronize) client.syncContext()
  })
  await assert.rejects(f.client.continueSuggestion(f.id), { code: 'CONTEXT_CHANGED' })
  assert.equal(f.counts().analyzed, 1, 'old suggestion text is never analyzed in the replacement project')
  assert.equal(f.client.getSnapshot().messages.some(m => m.content.startsWith('请解释这条建议')), false)
  f.client.dispose()
})

test('continued suggestion cannot cross a structural edit during focus', async () => {
  const f = await fixture(({ current, setContext }) => setContext({ ...current, revision: current.revision + 1 }))
  await assert.rejects(f.client.continueSuggestion(f.id), { code: 'CONTEXT_CHANGED' })
  assert.equal(f.counts().analyzed, 1)
  f.client.dispose()
})

test('continued suggestion accepts its own target selection change', async () => {
  const f = await fixture(({ client, current, setContext }) => { setContext({ ...current, selectedBlockId: 'form' }); client.syncContext() }, { ...context(), selectedBlockId: null })
  await f.client.continueSuggestion(f.id)
  assert.equal(f.counts().analyzed, 2)
  f.client.dispose()
})
