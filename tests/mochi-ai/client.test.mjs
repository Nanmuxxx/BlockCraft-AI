import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiConversation, createMochiApi } from '../../src/integrations/mochi-ai/client.mjs'
import { binding, projectContext } from '../../src/integrations/mochi-ai/protocol.mjs'
import { context, advice, request } from './fixtures.mjs'
const wire = (ctx, data = advice()) => ({ version: 1, source: 'deepseek', binding: binding(ctx), capabilities: { modifications: false }, ...data,
  suggestions: data.suggestions.map((s, i) => ({ ...s, id: `ai-${String(i+1).padStart(32,'0')}` })) })
function fixture(analyze) {
  let c = context(), time = 1000, count = 0, focused = null
  const calls = []
  const api = { status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }), consent: async enabled => ({ proactiveEnabled: enabled }), ignore: async () => ({}),
    analyze: async (input, options) => { count++; calls.push(input); return analyze ? analyze(input, options) : wire(input.context) } }
  const client = createMochiConversation({ api, readContext: () => c, now: () => time, focusBlock: id => { focused = id; c = { ...c, selectedBlockId: id } } })
  return { client, api, calls, count: () => count, focused: () => focused, tick: ms => { time += ms }, change: next => { c = next } }
}

test('manual chat, suggestion navigation, continued conversation and modification disabled', async () => {
  const f = fixture(); await f.client.refreshStatus(); await f.client.chat('这个应用下一步怎么优化？')
  const id = f.client.getSnapshot().suggestions[0].id
  assert.equal(f.client.getSnapshot().messages.length, 2)
  f.client.focusSuggestion(id); assert.equal(f.focused(), 'form')
  assert.throws(() => f.client.requestModification(id), { code: 'AI_MODIFICATION_DISABLED' })
  await f.client.continueSuggestion(id, '截止时间应该放在哪里？')
  assert.deepEqual(f.calls[1].history, ['这个应用下一步怎么优化？'])
  assert.equal(f.client.getSnapshot().messages.length, 4); assert.equal(f.client.getSnapshot().modificationsEnabled, false)
  assert(Object.isFrozen(f.client.getSnapshot().messages)); assert.equal(f.count(), 2)
})

test('no polling, proactive opt-in, event throttle and duplicate event suppression', async () => {
  const f = fixture(); await f.client.refreshStatus()
  await assert.rejects(f.client.onEvent({ type: 'project-opened' }), { code: 'PROACTIVE_DISABLED' })
  assert.equal(f.count(), 0); await f.client.setProactive(true)
  await f.client.onEvent({ type: 'structure-changed' }); assert.equal(f.count(), 1)
  f.tick(31_000); assert.equal(await f.client.onEvent({ type: 'structure-changed' }), null)
  await f.client.onEvent({ type: 'selection-settled' }); assert.equal(f.count(), 2)
  assert.equal(await f.client.onEvent({ type: 'project-opened' }), null)
  await f.client.setProactive(false)
  await assert.rejects(f.client.onEvent({ type: 'project-opened' }), { code: 'PROACTIVE_DISABLED' })
  assert.equal(f.count(), 2)
})

test('dedup and ignored suggestion cooldown, including normalized punctuation', async () => {
  const f = fixture(); await f.client.refreshStatus(); await f.client.chat('建议')
  const id = f.client.getSnapshot().suggestions[0].id; await f.client.ignore(id)
  assert.equal(f.client.getSnapshot().suggestions.length, 0)
  await f.client.chat('再看看'); assert.equal(f.client.getSnapshot().suggestions.length, 0)
  f.tick(600_001); await f.client.chat('再看看'); assert.equal(f.client.getSnapshot().suggestions.length, 1)
})

test('trusted host validates unknown/removed target IDs and refuses forged suggestion handles', async () => {
  const bad = fixture(input => wire(input.context, { ...advice(), suggestions: [{ ...advice().suggestions[0], blockId: 'foreign' }] }))
  await bad.client.refreshStatus(); await assert.rejects(bad.client.chat('hello')); assert.equal(bad.client.getSnapshot().suggestions.length, 0)
  const f = fixture(); await f.client.refreshStatus(); await f.client.chat('hello')
  assert.throws(() => f.client.focusSuggestion('foreign'), { code: 'SUGGESTION_EXPIRED' })
  const id = f.client.getSnapshot().suggestions[0].id
  f.change({ ...context(), selectedBlockId: null, revision: 1, blocks: [], entities: [], relations: [] })
  assert.throws(() => f.client.focusSuggestion(id), { code: 'CONTEXT_CHANGED' }); assert.equal(f.focused(), null)
})

test('context change aborts pending analysis and discards delayed replies without leaking chat across apps', async () => {
  let release, signal
  const f = fixture((input, options) => { signal = options.signal; return new Promise(resolve => { release = () => resolve(wire(input.context)) }) })
  await f.client.refreshStatus(); const pending = f.client.chat('private question')
  f.change({ ...context(), appId: 'different', instanceId: 'other' }); f.client.syncContext(); assert(signal.aborted)
  release(); await assert.rejects(pending, { code: 'CONTEXT_CHANGED' }); assert.deepEqual(f.client.getSnapshot().messages, [])
  assert.equal(f.client.getSnapshot().busy, false); assert.equal(f.client.getSnapshot().suggestions.length, 0)
})

test('cancel and dispose suppress late output; disabled status never falls back', async () => {
  let release
  const f = fixture(input => new Promise(resolve => { release = () => resolve(wire(input.context)) }))
  await assert.rejects(f.client.chat('hello'), { code: 'AI_DISABLED' }); assert.equal(f.count(), 0)
  await f.client.refreshStatus(); const pending = f.client.chat('hello'); f.client.dispose(); release()
  await assert.rejects(pending, { code: 'CONTEXT_CHANGED' }); assert.equal(f.client.getSnapshot().messages.length, 1)
})

test('rapid consent on/off is serialized and ends off at the server', async () => {
  const f = fixture(), writes = []; let server = false
  f.api.consent = async enabled => { writes.push(enabled); server = enabled; return { proactiveEnabled: enabled } }
  await f.client.refreshStatus(); await Promise.all([f.client.setProactive(true), f.client.setProactive(false)])
  assert.deepEqual(writes, [true,false]); assert.equal(server, false); assert.equal(f.client.getSnapshot().proactiveEnabled, false)
})

test('independent API uses same-origin credentials, limits output, sanitizes errors, times out and cancels', async () => {
  const api = createMochiApi({ fetchImpl: async (path, init) => {
    assert.equal(path, '/api/mochi-ai/analyze'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error')
    assert(!init.body.includes('apiKey')); return new Response(JSON.stringify({ error: { code: 'BAD', message: 'SECRET' } }), { status: 502 })
  } })
  await assert.rejects(api.analyze(request()), e => !e.message.includes('SECRET'))
  await assert.rejects(createMochiApi({ fetchImpl: async () => new Response('x'.repeat(33_000)) }).status(), { code: 'AI_INVALID_RESPONSE' })
  const fetchImpl = (_path, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort'))))
  await assert.rejects(createMochiApi({ fetchImpl, timeoutMs: 10 }).status(), { code: 'AI_TIMEOUT' })
  const c = new AbortController(); c.abort(); await assert.rejects(createMochiApi({ fetchImpl }).status({ signal: c.signal }), { code: 'CANCELLED' })
})


test('standalone API client rejects Runtime/records before any HTTP request', async () => {
  let calls = 0
  const api = createMochiApi({ fetchImpl: async () => { calls++ } })
  await assert.rejects(api.analyze({ ...request(), snapshot: { records: ['private'] } }))
  assert.equal(calls, 0)
})

test('late status cannot re-enable consent after explicit off', async () => {
  const f = fixture(); await f.client.refreshStatus(); await f.client.setProactive(true)
  let release
  f.api.status = () => new Promise(resolve => { release = resolve })
  const pending = f.client.refreshStatus(); await Promise.resolve(); await Promise.resolve()
  await f.client.setProactive(false)
  release({ enabled: true, proactiveEnabled: true, modificationsEnabled: false }); await pending
  assert.equal(f.client.getSnapshot().proactiveEnabled, false)
})
