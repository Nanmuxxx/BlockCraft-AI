import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createMochiService, POLICY } from '../../server/mochi-ai/service.mjs'
import { createInteractiveGate } from '../../server/trusted-interactive.mjs'
import { MochiError } from '../../src/integrations/mochi-ai/protocol.mjs'
import { request, advice, access, grant } from './fixtures.mjs'

function fixture(options = {}) {
  let time = 1000, count = 0, reservations = 0
  const service = createMochiService({ enabled: true, unifiedManagedBudget: true,
    approval: { ...grant(time), maxCalls: 100, maxTotalTokens: 1 }, now: () => time,
    reserveBudget: () => { reservations++; return true },
    provider: { configured: true, analyze: async () => { count++; return advice() } }, ...options })
  return { service, tick(ms = 2001) { time += ms }, count: () => count, reservations: () => reservations }
}

test('trusted unified mode removes session 8, lifetime 100 and memory token budgets while consulting durable budget each time', async () => {
  const f = fixture()
  for (let i = 0; i < 101; i++) {
    await f.service.analyze(access, request())
    f.tick()
  }
  assert.equal(f.count(), 101)
  assert.equal(f.reservations(), 101)
  assert.equal(f.service.usage().calls, 101)
})

test('non-unified hosts retain their independent approved call/token and session protections', async () => {
  const f = fixture({ unifiedManagedBudget: false, approval: grant(1000) })
  for (let i = 0; i < POLICY.sessionCalls; i++) { await f.service.analyze(access, request()); f.tick() }
  await assert.rejects(f.service.analyze(access, request()), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(f.count(), POLICY.sessionCalls)
  const limited = fixture({ unifiedManagedBudget: false, approval: { ...grant(1000), maxCalls: 1 } })
  await limited.service.analyze(access, request()); limited.tick()
  await assert.rejects(limited.service.analyze({ ...access, sessionId: 'another-trusted-session' }, request()), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(limited.count(), 1)
})

test('unified mode still requires explicit project consent, throttles and deduplicates proactive events', async () => {
  const f = fixture()
  await assert.rejects(f.service.analyze(access, request('proactive')), { code: 'PROACTIVE_DISABLED' })
  assert.equal(f.reservations(), 0)
  f.service.consent(access, { enabled: true })
  await f.service.analyze(access, request('proactive'))
  await assert.rejects(f.service.analyze(access, request('proactive')), { code: 'THROTTLED' })
  f.tick(POLICY.proactiveIntervalMs + 1)
  await assert.rejects(f.service.analyze(access, request('proactive')), { code: 'DUPLICATE_EVENT' })
  f.service.consent(access, { enabled: false })
  await assert.rejects(f.service.analyze(access, request('proactive')), { code: 'PROACTIVE_DISABLED' })
  assert.equal(f.reservations(), 1)
  assert.equal(f.count(), 1)
})

test('unified mode keeps chat throttling and shared provider concurrency protections', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const f = fixture({ provider: { configured: true, analyze: () => pending } })
  const first = f.service.analyze(access, request())
  await assert.rejects(f.service.analyze(access, request()), { code: 'AI_BUSY' })
  const second = f.service.analyze({ ...access, sessionId: 'second-trusted-session' }, request())
  await assert.rejects(f.service.analyze({ ...access, sessionId: 'third-trusted-session' }, request()), { code: 'AI_BUSY' })
  release(advice()); await Promise.all([first, second])
  await assert.rejects(f.service.analyze(access, request()), { code: 'THROTTLED' })
  assert.equal(f.service.usage().inFlight, 0)
})

test('durable budget rejection or cancellation never starts provider; no automatic retry', async () => {
  const denied = fixture({ reserveBudget: () => false })
  await assert.rejects(denied.service.analyze(access, request()), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(denied.count(), 0)
  const f = fixture(), controller = new AbortController(); controller.abort()
  await assert.rejects(f.service.analyze(access, request(), { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(f.count(), 0)
  assert.equal(f.reservations(), 0)
  assert.equal(f.service.usage().calls, 0)
})

test('halted budget has a fixed safe classification; arbitrary adapter errors remain private and never call the model', async () => {
  for (const error of [
    new MochiError('BUDGET_HALTED', 'PRIVATE ADAPTER DETAIL', 999),
    Object.assign(new Error('PRIVATE ADAPTER DETAIL'), { code: 'BUDGET_HALTED', status: 999 }),
    new MochiError('PRIVATE_ADAPTER_CODE', 'PRIVATE ADAPTER DETAIL', 999),
  ]) {
    const f = fixture({ reserveBudget: () => { throw error } })
    const trusted = error instanceof MochiError && error.code === 'BUDGET_HALTED'
    await assert.rejects(f.service.analyze(access, request()), actual => {
      assert.equal(actual.code, trusted ? 'BUDGET_HALTED' : 'BUDGET_UNAVAILABLE')
      assert.equal(actual.status, 503)
      assert.equal(actual.message.includes('PRIVATE'), false)
      return true
    })
    assert.equal(f.count(), 0)
    assert.equal(f.service.usage().inFlight, 0)
  }
})

test('revoking proactive consent while durable admission awaits cancels before model egress', async () => {
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const f = fixture({ reserveBudget: () => { entered(); return new Promise(() => {}) } })
  f.service.consent(access, { enabled: true })
  const pending = f.service.analyze(access, request('proactive'))
  await started
  f.service.consent(access, { enabled: false })
  await assert.rejects(pending, { code: 'CANCELLED' })
  assert.equal(f.count(), 0)
  assert.equal(f.service.usage().inFlight, 0)
})

test('interactive unified mode accepts unlimited-call grant only with a trusted principal budget', async () => {
  const options = { enabled: true, unifiedManagedBudget: true, principalManagedBudget: true,
    approval: { ...grant(Date.now()), maxCalls: null }, allowedOrigin: 'https://offline.test',
    resolveAccess: async () => ({ sessionId: 'server-session', appId: 'form', readOnly: false }) }
  const req = Object.assign(new EventEmitter(), { headers: { origin: 'https://offline.test' }, aborted: false })
  const context = { principal: 'server-principal', requestId: 'offline-request', model: 'offline-model', maxTokens: 100 }
  const admit = createInteractiveGate(options)
  for (let i = 0; i < 101; i++) await admit(req, context)
  assert.equal(req.listenerCount('aborted'), 0)
  await assert.rejects(createInteractiveGate({ ...options, principalManagedBudget: false, reserveBudget: () => true })(req, context), { code: 'AI_DISABLED' })
  await assert.rejects(createInteractiveGate({ ...options, unifiedManagedBudget: false })(req, context), { code: 'AI_DISABLED' })
  await assert.rejects(createInteractiveGate({ ...options, resolveAccess: async () => null })(req, context), { code: 'UNAUTHORIZED' })
  req.headers.origin = 'https://other.test'
  await assert.rejects(admit(req, context), { code: 'ORIGIN_REJECTED' })
})
