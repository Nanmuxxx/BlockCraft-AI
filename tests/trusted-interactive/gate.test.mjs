import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createInteractiveGate } from '../../server/trusted-interactive.mjs'
const access = { sessionId: 'fixture-session', appId: 'fixture-app', readOnly: false }
function setup(overrides = {}) {
  const req = Object.assign(new EventEmitter(), { headers: {}, aborted: false })
  let reserves = 0
  const gate = createInteractiveGate({ enabled: true, approval: { providerVerified: true, permissionsVerified: true,
    reference: 'OFFLINE-TEST-ONLY', maxCalls: 2, expiresAt: Date.now() + 60000 }, allowedOrigin: 'http://offline.test',
    resolveAccess: async () => access, reserveBudget: async () => { reserves++; return true }, ...overrides })
  return { req, run: signal => gate(req, { model: 'fixture-model', requestId: 'fixture-request', maxTokens: 100, signal }), reserves: () => reserves }
}
for (const stage of ['access', 'budget']) test(`${stage} adapter ignoring abort cannot retain a cancelled gate`, { timeout: 1000 }, async () => {
  let rejectLate, began
  const started = new Promise(resolve => { began = resolve })
  const never = () => { began(); return new Promise((_, reject) => { rejectLate = reject }) }
  const f = setup(stage === 'access' ? { resolveAccess: never } : { reserveBudget: never })
  const controller = new AbortController(), pending = f.run(controller.signal)
  const rejected = assert.rejects(pending, { code: 'CANCELLED' })
  await started; controller.abort(); await rejected
  rejectLate(new Error('late adapter failure')); await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.req.listenerCount('aborted'), 0)
  assert.equal(f.reserves(), 0)
})
for (const stage of ['access', 'budget']) test(`${stage} adapter is bounded by admission deadline`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = setup(stage === 'access' ? { resolveAccess: () => new Promise(() => {}) } : { reserveBudget: () => new Promise(() => {}) })
  const pending = f.run(), rejected = assert.rejects(pending, { code: 'BUDGET_UNAVAILABLE' })
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(5000); await rejected
  assert.equal(f.req.listenerCount('aborted'), 0)
})
test('already disconnected requests do not invoke access or budget adapters', async () => {
  let calls = 0
  const f = setup({ resolveAccess: async () => { calls++; return access } })
  f.req.aborted = true
  await assert.rejects(f.run(), { code: 'CANCELLED' })
  assert.equal(calls, 0); assert.equal(f.reserves(), 0)
})

for (const stage of ['access', 'budget']) for (const thrown of [null, undefined, Object.assign(Error('adapter-private-data'), { code: 'ADAPTER_PRIVATE_SECRET', status: 9999 })]) {
  test(`${stage} adapter failures are normalized without exposing arbitrary codes/status`, async () => {
    const broken = async () => { throw thrown }
    const f = setup(stage === 'access' ? { resolveAccess: broken } : { reserveBudget: broken })
    await assert.rejects(f.run(), { code: 'BUDGET_UNAVAILABLE', status: 503, message: 'BUDGET_UNAVAILABLE' })
    assert.equal(f.req.listenerCount('aborted'), 0)
  })
}
