import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiConversation } from '../../src/integrations/mochi-ai/client.mjs'
import { binding } from '../../src/integrations/mochi-ai/protocol.mjs'
import { context, advice } from './fixtures.mjs'

async function fixture() {
  let current = context(), focused = 0, ignored = 0, analyzed = 0
  const client = createMochiConversation({ readContext: () => current, focusBlock() { focused++ }, api: {
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
