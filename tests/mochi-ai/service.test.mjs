import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiService, POLICY } from '../../server/mochi-ai/service.mjs'
import { request, advice, access, grant } from './fixtures.mjs'
function fixture(options = {}) {
  let time = 1000, count = 0
  const provider = { configured: true, analyze: async () => { count++; return advice() } }
  const service = createMochiService({ provider, reserveBudget: () => true, enabled: true, approval: grant(time), now: () => time, ...options })
  return { service, tick(ms = 31_000) { time += ms }, count: () => count }
}

test('default disabled, missing/expired/unverified grants make zero upstream calls', async () => {
  let count = 0; const provider = { configured: true, analyze: async () => { count++ } }
  for (const options of [{}, { enabled: true }, { enabled: true, approval: grant(0) }, { enabled: true, approval: { ...grant(Date.now()), permissionsVerified: false } }, { enabled: true, approval: { ...grant(Date.now()), providerVerified: false } }]) {
    const service = createMochiService({ provider, ...options }); await assert.rejects(service.analyze(access, request()), { code: 'AI_DISABLED' })
    assert.equal(service.status(access).modificationsEnabled, false)
  }
  assert.equal(count, 0)
})

test('proactive requires explicit consent; events and suggestions deduplicate until cooldown', async () => {
  const f = fixture()
  await assert.rejects(f.service.analyze(access, request('proactive')), { code: 'PROACTIVE_DISABLED' })
  f.service.consent(access, { enabled: true })
  const first = await f.service.analyze(access, request('proactive'))
  assert.equal(first.suggestions.length, 1); assert.equal(first.capabilities.modifications, false)
  f.tick()
  await assert.rejects(f.service.analyze(access, request('proactive')), { code: 'DUPLICATE_EVENT' })
  const second = await f.service.analyze(access, request()); assert.equal(second.suggestions.length, 0)
  f.service.ignore(access, { id: first.suggestions[0].id }); f.tick(POLICY.cooldownMs + 1)
  assert.equal((await f.service.analyze(access, request('proactive'))).suggestions.length, 1)
  f.service.consent(access, { enabled: false }); f.tick()
  await assert.rejects(f.service.analyze(access, request('proactive')), { code: 'PROACTIVE_DISABLED' })
  assert.equal(f.count(), 3)
})

test('chat and proactive throttle on the server and enforce trusted application binding', async () => {
  const f = fixture(); await f.service.analyze(access, request())
  await assert.rejects(f.service.analyze(access, request()), { code: 'THROTTLED' })
  await assert.rejects(f.service.analyze({ ...access, appId: 'other' }, request()), { code: 'CONTEXT_MISMATCH' })
  await assert.rejects(f.service.analyze(null, request()), { code: 'UNAUTHORIZED' })
  assert.equal(f.count(), 1)
})

test('global call/token budgets reserve before requests and failures are charged without retries', async () => {
  for (const approval of [{ ...grant(1000), maxCalls: 1 }, { ...grant(1000), maxTotalTokens: 1 }]) {
    const f = fixture({ approval })
    if (approval.maxCalls === 1) { await f.service.analyze(access, request()); f.tick() }
    await assert.rejects(f.service.analyze(access, request()), { code: 'BUDGET_EXHAUSTED' })
    assert.equal(f.count(), approval.maxCalls === 1 ? 1 : 0)
  }
  const f = fixture({ provider: { configured: true, analyze: async () => { throw new Error('offline') } }, approval: { ...grant(1000), maxCalls: 1 } })
  await assert.rejects(f.service.analyze(access, request())); f.tick()
  await assert.rejects(f.service.analyze({ ...access, sessionId: 'new' }, request()), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(f.service.usage().calls, 1); assert.equal(f.service.usage().inFlight, 0)
})

test('session budget shared across projects; per-session/global concurrency bounded', async () => {
  const f = fixture()
  for (let i = 0; i < POLICY.sessionCalls; i++) { await f.service.analyze(access, request()); f.tick() }
  await assert.rejects(f.service.analyze(access, request()), { code: 'BUDGET_EXHAUSTED' })
  const releases = []
  const concurrent = fixture({ provider: { configured: true, analyze: () => new Promise(resolve => releases.push(() => resolve(advice()))) } })
  const a = concurrent.service.analyze(access, request())
  await assert.rejects(concurrent.service.analyze(access, request()), { code: 'AI_BUSY' })
  const b = concurrent.service.analyze({ ...access, sessionId: 'two' }, request())
  await assert.rejects(concurrent.service.analyze({ ...access, sessionId: 'three' }, request()), { code: 'AI_BUSY' })
  releases.forEach(release => release()); await Promise.all([a,b]); assert.equal(concurrent.service.usage().inFlight, 0)
})

test('revoking proactive consent aborts and discards an outstanding response', async () => {
  let release, signal
  const f = fixture({ provider: { configured: true, analyze: (_input, options) => { signal = options.signal; return new Promise(resolve => { release = resolve }) } } })
  f.service.consent(access, { enabled: true }); const pending = f.service.analyze(access, request('proactive'))
  await new Promise(resolve => setImmediate(resolve))
  f.service.consent(access, { enabled: false }); assert(signal.aborted); release(advice())
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(f.service.usage().inFlight, 0)
})

test('approval is snapshotted so caller mutation cannot increase the grant', async () => {
  const approval = { ...grant(1000), maxCalls: 1 }, f = fixture({ approval })
  approval.maxCalls = 100
  await f.service.analyze(access, request()); f.tick()
  await assert.rejects(f.service.analyze(access, request()), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(f.count(), 1)
})

test('trusted access is captured before budget await so later mutation cannot change dedup scope', async () => {
  let finish, calls = 0
  const trusted = { ...access }
  const f = fixture({ reserveBudget: () => ++calls === 1 ? new Promise(resolve => { finish = resolve }) : true })
  const first = f.service.analyze(trusted, request())
  trusted.appId = 'foreign-app'; trusted.sessionId = 'foreign-session'
  finish(true)
  const reply = await first
  assert.equal(reply.binding.appId, access.appId)
  assert.equal(reply.suggestions.length, 1)
  f.tick()
  const next = await f.service.analyze(access, request())
  assert.equal(next.suggestions.length, 0)
  assert.equal(f.count(), 2)
})


test('durable monetary adapter required, deny/error/abort never reach provider', async () => {
  for (const [reserveBudget, code] of [[undefined, 'BUDGET_UNAVAILABLE'], [() => false, 'BUDGET_EXHAUSTED'], [() => { throw new Error('ledger down') }, 'BUDGET_UNAVAILABLE']]) {
    const f = fixture({ reserveBudget })
    await assert.rejects(f.service.analyze(access, request()), { code })
    assert.equal(f.count(), 0); assert.equal(f.service.usage().inFlight, 0)
  }
  let reservation, finish
  const f = fixture({ reserveBudget: input => { reservation = input; return new Promise(resolve => { finish = resolve }) } })
  f.service.consent(access, { enabled: true })
  const pending = f.service.analyze(access, request('proactive'))
  const rejected = assert.rejects(pending, { code: 'CANCELLED' })
  assert.equal(Object.isFrozen(reservation), true)
  assert.deepEqual(Object.keys(reservation).sort(), ['requestId','sessionId','appId','approvalReference','model','maxTokens','signal'].sort())
  assert(reservation.maxTokens > 0); assert.match(reservation.requestId, /^[a-f0-9-]{36}$/)
  f.service.consent(access, { enabled: false }); await rejected
  finish(true); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.count(), 0); assert.equal(f.service.usage().inFlight, 0)
})

test('C-mode requests are rejected before budget reservation or provider', async () => {
  let reserved = 0
  const f = fixture({ reserveBudget: () => { reserved++; return true } }), input = request()
  input.context.mode = 'run'
  await assert.rejects(f.service.analyze(access, input), { code: 'MODE_UNAVAILABLE' })
  assert.equal(reserved, 0); assert.equal(f.count(), 0)
})

test('durable ledger timeout is unavailable and releases concurrency without provider egress', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture({ reserveBudget: () => new Promise(() => {}) })
  const pending = f.service.analyze(access, request())
  const rejected = assert.rejects(pending, { code: 'BUDGET_UNAVAILABLE' })
  t.mock.timers.tick(5000); await rejected
  assert.equal(f.count(), 0); assert.equal(f.service.usage().inFlight, 0)
})

for (const proactive of [false, true]) test(`${proactive ? 'consent revocation' : 'caller cancellation'} releases service despite provider ignoring abort`, { timeout: 1000 }, async () => {
  let rejectOld, started
  const began = new Promise(resolve => { started = resolve })
  const f = fixture({ provider: { configured: true, analyze: () => { started(); return new Promise((_, reject) => { rejectOld = reject }) } } })
  const controller = new AbortController()
  if (proactive) f.service.consent(access, { enabled: true })
  const pending = f.service.analyze(access, request(proactive ? 'proactive' : 'chat'), { signal: controller.signal })
  const rejected = assert.rejects(pending, { code: 'CANCELLED' })
  await began
  if (proactive) f.service.consent(access, { enabled: false })
  else controller.abort()
  await rejected
  assert.equal(f.service.usage().inFlight, 0)
  assert.equal(f.service.usage().calls, 1) // Cancelled calls remain charged.
  rejectOld(new Error('late transport failure'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.service.usage().inFlight, 0)
})
