import test from 'node:test'
import assert from 'node:assert/strict'
import { createMochiService, POLICY } from '../../server/mochi-ai/service.mjs'
import { createMochiApi, createMochiConversation } from '../../src/integrations/mochi-ai/client.mjs'
import { context, request, advice, access, grant } from './fixtures.mjs'

const scope = c => ({ appId: c.appId, instanceId: c.instanceId })
const status = c => ({ enabled: true, proactiveEnabled: true, modificationsEnabled: false,
  proactiveAppId: c.appId, proactiveInstanceId: c.instanceId })
function serviceFixture(options = {}) {
  let calls = 0
  const service = createMochiService({ enabled: true, approval: grant(Date.now()), reserveBudget: () => true,
    provider: { configured: true, analyze: async () => { calls++; return advice() } }, authorizeContext: () => true, ...options })
  return { service, calls: () => calls }
}

for (const change of [{ appId: 'another-app' }, { instanceId: 'another-instance' }]) {
  test(`proactive consent does not cross project scope ${Object.keys(change)[0]}`, async () => {
    const f = serviceFixture(), input = request('proactive')
    f.service.consent(access, { enabled: true, ...scope(input.context) })
    Object.assign(input.context, change)
    await assert.rejects(f.service.analyze(access, input), { code: 'PROACTIVE_DISABLED' })
    assert.equal(f.calls(), 0)
    assert.equal(f.service.usage().calls, 0)
  })
}

test('a delayed scoped revocation does not revoke a new instance of the same app', async () => {
  const f = serviceFixture(), first = context(), next = { ...first, instanceId: 'new-instance' }
  f.service.consent(access, { enabled: true, ...scope(first) })
  f.service.consent(access, { enabled: true, ...scope(next) })
  f.service.consent(access, { enabled: false, ...scope(first) })
  assert.deepEqual(f.service.status(access), status(next))
  const input = request('proactive'); input.context = next
  assert.equal((await f.service.analyze(access, input)).binding.instanceId, next.instanceId)
  f.service.consent(access, { enabled: false, ...scope(next) })
  assert.equal(f.service.status(access).proactiveEnabled, false)
})

test('switching granted instances aborts the previous proactive analysis before publishing', async () => {
  let signal, began, finish
  const started = new Promise(resolve => { began = resolve })
  const f = serviceFixture({ provider: { configured: true, analyze: (_input, options) => {
    signal = options.signal; began(); return new Promise(resolve => { finish = resolve })
  } } })
  const input = request('proactive')
  f.service.consent(access, { enabled: true, ...scope(input.context) })
  const pending = f.service.analyze(access, input)
  const cancelled = assert.rejects(pending, { code: 'CANCELLED' })
  await started
  f.service.consent(access, { enabled: true, ...scope({ ...input.context, instanceId: 'new-instance' }) })
  assert.equal(signal.aborted, true)
  finish(advice()); await cancelled
  assert.equal(f.service.usage().inFlight, 0)
})

test('unscoped legacy consent only authorizes the default single-project host', async () => {
  const legacy = serviceFixture({ authorizeContext: undefined })
  legacy.service.consent(access, { enabled: true })
  assert.equal((await legacy.service.analyze(access, request('proactive'))).binding.appId, access.appId)
  const studio = serviceFixture()
  studio.service.consent(access, { enabled: true })
  await assert.rejects(studio.service.analyze(access, request('proactive')), { code: 'PROACTIVE_DISABLED' })
  assert.equal(studio.calls(), 0)
})

test('changing project instance cannot reset shared session call allowance', async () => {
  let time = Date.now()
  const f = serviceFixture({ now: () => time })
  for (let index = 0; index < POLICY.sessionCalls; index++) {
    const input = request('proactive'); input.context.instanceId = `instance-${index}`
    f.service.consent(access, { enabled: true, ...scope(input.context) })
    await f.service.analyze(access, input)
    time += POLICY.proactiveIntervalMs + 1
  }
  const input = request('proactive'); input.context.instanceId = 'instance-after-limit'
  f.service.consent(access, { enabled: true, ...scope(input.context) })
  await assert.rejects(f.service.analyze(access, input), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(f.calls(), POLICY.sessionCalls)
})

for (const invalid of [
  { appId: 'signup' }, { instanceId: 'mochi-fixture' },
  { appId: 'signup', instanceId: null }, { appId: null, instanceId: 'mochi-fixture' },
  { appId: 'signup', instanceId: '' }, { appId: 'signup', instanceId: '__proto__' },
]) test(`consent rejects invalid or partial scope ${JSON.stringify(invalid)}`, () => {
  const f = serviceFixture()
  assert.throws(() => f.service.consent(access, { enabled: true, ...invalid }), { code: 'INVALID_INPUT' })
  assert.equal(f.service.status(access).proactiveEnabled, false)
})

test('API serializes both project identity fields on explicit consent', async () => {
  let body
  const api = createMochiApi({ fetchImpl: async (_path, init) => {
    body = JSON.parse(init.body); return Response.json({ proactiveEnabled: true, modificationsEnabled: false })
  } })
  await api.consent(true, scope(context()))
  assert.deepEqual(body, { enabled: true, ...scope(context()) })
})

for (const legacyStatus of [true, false]) test(`same-app host replacement requires matching instance status (legacy=${legacyStatus})`, async () => {
  let current = context(), result = status(current)
  if (legacyStatus) delete result.proactiveInstanceId
  const client = createMochiConversation({ api: { status: async () => result }, readContext: () => current })
  client.syncContext(); await client.refreshStatus()
  assert.equal(client.getSnapshot().proactiveEnabled, true)
  current = { ...current, instanceId: 'replacement-instance' }; client.syncContext()
  assert.equal(client.getSnapshot().proactiveEnabled, false)
  await client.refreshStatus()
  assert.equal(client.getSnapshot().proactiveEnabled, false)
  result = status(current); await client.refreshStatus()
  assert.equal(client.getSnapshot().proactiveEnabled, true)
  client.dispose()
})

test('late consent for the old instance cannot opt in a replacement of the same app', async () => {
  let current = context(), began, finish, sentScope
  const started = new Promise(resolve => { began = resolve })
  const client = createMochiConversation({ readContext: () => current, api: {
    status: async () => ({ enabled: true, proactiveEnabled: false, modificationsEnabled: false }),
    consent: (_enabled, target) => new Promise(resolve => {
      sentScope = target; finish = resolve; began()
    }),
  } })
  await client.refreshStatus()
  const pending = client.setProactive(true)
  await started
  assert.deepEqual(sentScope, scope(current))
  current = { ...current, instanceId: 'replacement-instance' }; client.syncContext()
  finish({ proactiveEnabled: true }); await pending
  assert.equal(client.getSnapshot().proactiveEnabled, false)
  client.dispose()
})

test('same-app project replacement cancels proactive analysis and retires suggestions', async () => {
  let current = context(), began, signal
  const started = new Promise(resolve => { began = resolve })
  const api = { status: async () => status(current), analyze: (_input, options) => {
    signal = options.signal; began(); return new Promise(() => {})
  } }
  const client = createMochiConversation({ api, readContext: () => current })
  client.syncContext(); await client.refreshStatus()
  const pending = client.onEvent({ type: 'project-opened' })
  const cancelled = assert.rejects(pending, { code: 'CONTEXT_CHANGED' })
  await started
  current = { ...current, instanceId: 'replacement-instance' }; client.syncContext()
  assert.equal(signal.aborted, true)
  await cancelled
  assert.equal(client.getSnapshot().busy, false)
  assert.equal(client.getSnapshot().proactiveEnabled, false)
  assert.deepEqual(client.getSnapshot().suggestions, [])
  client.dispose()
})

for (const invalid of [{ proactiveInstanceId: 'orphan' }, { proactiveAppId: 'signup', proactiveInstanceId: null },
  { proactiveAppId: '__proto__', proactiveInstanceId: 'instance' }]) {
  test(`client rejects malformed scoped status ${JSON.stringify(invalid)}`, async () => {
    const client = createMochiConversation({ readContext: context, api: { status: async () => ({
      enabled: true, proactiveEnabled: true, modificationsEnabled: false, ...invalid,
    }) } })
    await assert.rejects(client.refreshStatus(), { code: 'AI_INVALID_RESPONSE' })
    assert.equal(client.getSnapshot().enabled, false)
    client.dispose()
  })
}
