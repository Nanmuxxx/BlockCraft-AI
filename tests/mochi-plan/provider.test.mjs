import { registerHooks } from 'node:module'
import { existsSync, mkdtempSync, chmodSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
registerHooks({ resolve(s, c, next) {
  if (s.startsWith('.') && c.parentURL && !/\.[a-z]+$/i.test(s)) {
    for (const suffix of ['.ts', '/index.ts']) { const u = new URL(s + suffix, c.parentURL); if (existsSync(fileURLToPath(u))) return next(u.href, c) }
  }
  return next(s, c)
} })
const { createAppRuntime } = await import('../../src/model/appRuntime.ts')
const { createClubRegistrationExample } = await import('../../src/model/appSpecExamples.ts')
const { createMochiHost } = await import('../../src/integrations/mochi/host.ts')
const { createHttpPlanProvider } = await import('../../src/integrations/mochi/httpPlanProvider.ts')
const { createMochiPlanHandler } = await import('../../server/mochi-plan/index.mjs')
const { createPaidTransport } = await import('../../server/paid-gateway/provider.mjs')
const { openLedger } = await import('../../server/paid-gateway/ledger.mjs')
const { PRICING } = await import('../../server/paid-gateway/pricing.mjs')
let totalFakeCalls = 0
after(() => console.log(JSON.stringify({ REAL_MODEL_CALLS: 0, mockWireCalls: totalFakeCalls })))
const key = 'OFFLINE-ONLY-NOT-A-REAL-API-KEY'
const origin = 'http://offline.test'
const approval = () => ({ providerVerified: true, permissionsVerified: true, reference: 'MOCK-ONLY', expiresAt: Date.now() + 60000, maxCalls: 6 })
const candidate = request => ({ request: { requestId: request.requestId, baseRevision: request.baseRevision,
  commands: [{ type: 'configureBlockPresentation', blockId: request.block.id, presentation: { buttonText: '确认报名', backgroundColor: '#abcdef' } }] }, capabilityIds: [] })
async function setup(t, options = {}) {
  const runtime = createAppRuntime(createClubRegistrationExample()); let binding, calls = 0, authCalls = 0, projectCalls = 0, wire
  const dir = mkdtempSync(join(tmpdir(), 'mochi-plan-mock-')); chmodSync(dir, 0o700)
  const ledger = openLedger(join(dir, 'ledger.json'))
  const transport = createPaidTransport({ apiKey: key, ledger: options.onReserve ? { ...ledger, reserve(...args) { const id = ledger.reserve(...args); options.onReserve(); return id } } : ledger, fetchImpl: async (_url, init) => {
    calls++; totalFakeCalls++; wire = JSON.parse(init.body)
    const req = JSON.parse(wire.messages[1].content)
    if (options.onWire) await options.onWire(req)
    if (options.fail) throw new Error('private key should not escape')
    const output = options.answer ? options.answer(req) : candidate(req)
    return Response.json({ model: PRICING.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })
  } })
  const handler = createMochiPlanHandler({ enabled: true, approval: approval(), transport, allowedOrigin: origin,
    acquireAdmission: () => ({ assertCurrent: () => true, release() {} }),
    authenticate: async () => { authCalls++; return options.auth ? options.auth(authCalls) : { sessionId: 'session', subjectId: 'alice' } },
    resolveProject: async (_access, b) => {
      binding = b; projectCalls++
      const p = { ownerId: 'alice', appId: runtime.getSnapshot().spec.id, instanceId: b.instanceId, revision: runtime.getSnapshot().revision,
        selectedBlockId: b.selectedBlockId, readOnly: false, snapshot: runtime.getSnapshot() }
      return options.project ? options.project(p, projectCalls) : p
    }, ...options.config,
  })
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end() } })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/api/mochi-plan`
  const post = (body, headers = {}) => fetch(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const body = (requestId = 'req1') => ({ appId: runtime.getSnapshot().spec.id, instanceId: 'instance1', revision: runtime.getSnapshot().revision, selectedBlockId: 'registration-form', requestId, prompt: '修改按钮文字和颜色' })
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); ledger.close(); rmSync(dir, { recursive: true, force: true }) })
  return { runtime, transport, ledger, post, body, url, calls: () => calls, wire: () => wire, binding: () => binding }
}
test('HTTP -> existing branded gateway -> strict plan -> Host Preview zero writes -> Confirm/CAS once', async t => {
  const g = await setup(t)
  const provider = createHttpPlanProvider({ enabled: true, fetchImpl: (_url, init) => fetch(g.url, { ...init, headers: { ...init.headers, Origin: origin } }) })
  const host = createMochiHost(g.runtime, provider); t.after(() => host.dispose()); host.setSelection('registration-form')
  const before = g.runtime.getSnapshot(); const owner = g.runtime.customProject.getSnapshot()
  await host.callbacks.onRequestPlan('按钮改成确认报名，背景改成浅蓝色')
  assert.equal(host.getSnapshot().phase, 'PREVIEW'); assert.strictEqual(g.runtime.getSnapshot(), before); assert.strictEqual(g.runtime.customProject.getSnapshot(), owner)
  assert.deepEqual(Object.keys(JSON.parse(g.wire().messages[1].content)).sort(), ['baseRevision','block','entity','prompt','requestId'])
  assert.ok(!g.wire().messages[1].content.includes('records')); assert.equal(g.wire().model, PRICING.model)
  const planId = host.getSnapshot().preview.planId
  await host.callbacks.onConfirm(planId); assert.equal(g.runtime.getSnapshot().revision, before.revision + 1)
  assert.equal(g.runtime.getSnapshot().spec.blocks.find(b => b.id === 'registration-form').presentation.buttonText, '确认报名')
  await host.callbacks.onConfirm(planId); assert.equal(g.runtime.getSnapshot().revision, before.revision + 1)
  assert.equal(g.calls(), 1); assert.equal(g.ledger.snapshot().entries[0].status, 'settled')
})
for (const [label, options, status] of [
  ['default disabled', { config: { enabled: false } }, 503],
  ['unbranded bypass transport', { config: { transport: async () => { throw Error('never') } } }, 503],
  ['missing identity', { auth: () => null }, 401],
  ['wrong owner', { project: p => ({ ...p, ownerId: 'mallory' }) }, 403],
  ['unknown writable flag', { project: p => ({ ...p, readOnly: undefined }) }, 403],
  ['stale revision', { project: p => ({ ...p, revision: p.revision + 1 }) }, 409],
  ['wrong instance', { project: p => ({ ...p, instanceId: 'other' }) }, 409],
  ['expired approval', { config: { approval: { ...approval(), expiresAt: 1 } } }, 503],
  ['invalid snapshot', { project: p => ({ ...p, snapshot: { ...p.snapshot, spec: { ...p.snapshot.spec, entities: [] } } }) }, 400],
]) test(label + ' fails before reserve/egress', async t => {
  const g = await setup(t, options); const response = await g.post(g.body()); assert.equal(response.status, status, await response.clone().text())
  assert.equal(g.calls(), 0); assert.equal(g.ledger.snapshot().entries.length, 0)
})
for (const [label, mutate] of [
  ['extra authority', b => ({ ...b, ownerId: 'alice' })], ['unbounded prompt', b => ({ ...b, prompt: 'a'.repeat(2001) })],
  ['unknown block', b => ({ ...b, selectedBlockId: 'missing' })],
]) test(label + ' rejected before model', async t => { const g = await setup(t); assert.equal((await g.post(mutate(g.body()))).status, 400); assert.equal(g.calls(), 0) })
test('cross origin rejects before authentication and payment', async t => {
  const g = await setup(t, { auth: () => { throw Error('not called') } }); assert.equal((await g.post(g.body(), { Origin: 'http://evil.test' })).status, 403); assert.equal(g.calls(), 0)
})
for (const [name, answer] of [
  ['forbidden command', r => ({ ...candidate(r), request: { ...candidate(r).request, commands: [{ type: 'undo' }] } })],
  ['stale request id', r => ({ ...candidate(r), request: { ...candidate(r).request, requestId: 'forged' } })],
  ['foreign target', r => ({ ...candidate(r), request: { ...candidate(r).request, commands: [{ type: 'removeBlock', blockId: 'applicant-list' }] } })],
  ['unsafe color', r => ({ ...candidate(r), request: { ...candidate(r).request, commands: [{ type: 'configureBlockPresentation', blockId: r.block.id, presentation: { backgroundColor: 'url(javascript:evil)' } }] } })],
]) test(name + ' rejected after model without Runtime writes', async t => {
  const g = await setup(t, { answer }); const before = g.runtime.getSnapshot(); assert.equal((await g.post(g.body())).status, 502); assert.strictEqual(g.runtime.getSnapshot(), before); assert.equal(g.calls(), 1)
})
test('auth revocation and canonical project changes after model reject plans', async t => {
  for (const options of [{ auth: n => n <= 2 ? { sessionId: 'session', subjectId: 'alice' } : null }, { project: (p, n) => n === 1 ? p : { ...p, readOnly: true } }]) {
    const g = await setup(t, options); assert.notEqual((await g.post(g.body())).status, 200); assert.equal(g.calls(), 1)
  }
})
test('duplicate request and process/ledger cap do not reset with project requests', async t => {
  const g = await setup(t); assert.equal((await g.post(g.body())).status, 200)
  assert.equal((await g.post(g.body())).status, 409); assert.equal(g.calls(), 1)
  for (let i = 2; i <= 6; i++) assert.equal((await g.post(g.body('req' + i))).status, 200)
  assert.equal((await g.post(g.body('req7'))).status, 429); assert.equal(g.calls(), 6); assert.equal(g.ledger.snapshot().entries.length, 6)
})
test('upstream failure consumes durable reservation and halts later attempts, with safe error', async t => {
  const g = await setup(t, { fail: true }); const response = await g.post(g.body()); assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: { code: 'PLAN_UNAVAILABLE' } }); assert.equal((await g.post(g.body('req2'))).status, 503)
  assert.equal(g.calls(), 1); assert.equal(g.ledger.snapshot().halted, true)
})
test('total deadline bounds slow project resolver with no late egress', async t => {
  const g = await setup(t, { config: { timeoutMs: 30 }, project: async p => { await new Promise(r => setTimeout(r, 70)); return p } })
  assert.equal((await g.post(g.body())).status, 504); await new Promise(r => setTimeout(r, 100)); assert.equal(g.calls(), 0)
})
test('late model response is ignored; active concurrency remains bounded', async t => {
  let entered; const started = new Promise(r => { entered = r }); let release; const wait = new Promise(r => { release = r })
  const g = await setup(t, { config: { timeoutMs: 80 }, onWire: async () => { entered(); await wait } })
  const first = g.post(g.body()); await started
  assert.equal((await g.post(g.body('req2'))).status, 429); assert.equal((await first).status, 504)
  release(); await new Promise(r => setTimeout(r, 50)); assert.equal(g.calls(), 1); assert.equal(g.ledger.snapshot().halted, true)
})
test('client default disabled performs zero HTTP requests', async () => {
  let calls = 0; const provider = createHttpPlanProvider({ fetchImpl: async () => { calls++; throw Error() } })
  assert.throws(() => provider({}), e => e.code === 'AI_MODIFICATION_DISABLED'); assert.equal(calls, 0)
})
test('revocation while reading canonical context refuses before reservation', async t => {
  const g = await setup(t, { auth: n => n === 1 ? { sessionId: 'session', subjectId: 'alice' } : null })
  assert.equal((await g.post(g.body())).status, 401); assert.equal(g.calls(), 0); assert.equal(g.ledger.snapshot().entries.length, 0)
})
test('process approval cap is additional to the shared durable ledger', async t => {
  const g = await setup(t, { config: { approval: { ...approval(), maxCalls: 1 } } })
  assert.equal((await g.post(g.body())).status, 200); assert.equal((await g.post(g.body('req2'))).status, 429); assert.equal(g.calls(), 1)
})
test('shared ledger reservations from another caller exhaust this provider without egress', async t => {
  const g = await setup(t)
  for (let i = 0; i < 6; i++) {
    const id = g.ledger.reserve(100, 100, 'OTHER-SERVICE-MOCK'); g.ledger.settle(id, { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 })
  }
  assert.equal((await g.post(g.body())).status, 503); assert.equal(g.calls(), 0); assert.equal(g.ledger.snapshot().entries.length, 6)
})
test('slow auth deadline and input size limit do not consume payment', async t => {
  const g = await setup(t, { config: { timeoutMs: 30 }, auth: async () => { await new Promise(r => setTimeout(r, 80)); return { sessionId: 'session', subjectId: 'alice' } } })
  assert.equal((await g.post(g.body())).status, 504); await new Promise(r => setTimeout(r, 100)); assert.equal(g.calls(), 0)
  const h = await setup(t); assert.equal((await h.post({ ...h.body(), prompt: 'x'.repeat(17000) })).status, 413); assert.equal(h.calls(), 0)
})
test('client cancellation retires request even if canonical resolver completes late', async t => {
  let entered; const started = new Promise(r => { entered = r })
  const g = await setup(t, { project: async p => { entered(); await new Promise(r => setTimeout(r, 80)); return p } })
  const controller = new AbortController()
  const pending = fetch(g.url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(g.body()), signal: controller.signal })
  const rejected = assert.rejects(pending); await started; controller.abort(); await rejected
  await new Promise(r => setTimeout(r, 150)); assert.equal(g.calls(), 0); assert.equal(g.ledger.snapshot().entries.length, 0)
})

test('live lease denies revoked admission without using cached identity', async t => {
  for (const getResult of [() => false, () => Promise.resolve(true), () => Promise.reject(new Error('not synchronous'))]) {
    let released = 0
    const g = await setup(t, { config: { acquireAdmission: () => ({ assertCurrent: getResult, release: () => released++ }) } })
    assert.equal((await g.post(g.body())).status, 403)
    assert.equal(g.calls(), 0); assert.equal(g.ledger.snapshot().entries.length, 0); assert.equal(released, 1)
  }
})
test('missing trusted lease adapter keeps handler disabled', async t => {
  const g = await setup(t, { config: { acquireAdmission: undefined } })
  assert.equal((await g.post(g.body())).status, 503); assert.equal(g.calls(), 0)
})
test('final authentication is followed by canonical resolution, then synchronous live check', async t => {
  let revoked = false, checks = 0
  const g = await setup(t, { project: (p, n) => { if (n === 2) revoked = true; return p },
    config: { acquireAdmission: () => ({ assertCurrent: () => { checks++; return !revoked }, release() {} }) } })
  assert.equal((await g.post(g.body())).status, 403); assert.equal(g.calls(), 1)
  assert.ok(checks >= 2); assert.equal(g.ledger.snapshot().entries[0].status, 'settled')
})
test('authentication deadline is server AUTH_TIMEOUT, not client cancellation', async t => {
  const g = await setup(t, { config: { timeoutMs: 2800 }, auth: () => new Promise(() => {}) })
  const response = await g.post(g.body()); assert.equal(response.status, 504)
  assert.equal((await response.json()).error.code, 'AUTH_TIMEOUT'); assert.equal(g.calls(), 0)
})
test('unfinished upload timeout closes the real request and permits the next request', async t => {
  const { request } = await import('node:http')
  const g = await setup(t, { config: { timeoutMs: 50 } })
  const result = await new Promise((resolve, reject) => {
    const req = request(g.url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': 1000 } }, res => {
      let text = ''; res.on('data', c => { text += c }); res.on('end', () => resolve({ status: res.statusCode, text, req }))
    }); req.on('error', reject); req.write('{')
  })
  assert.equal(result.status, 504); assert.equal(JSON.parse(result.text).error.code, 'PLAN_TIMEOUT')
  await new Promise(r => setTimeout(r, 30)); assert.equal(result.req.destroyed, true)
  assert.equal(g.calls(), 0); assert.equal(g.ledger.snapshot().entries.length, 0)
  assert.equal((await g.post(g.body())).status, 200)
})

// These probes exercise the actual shared gateway, not a substitute transport.
for (const phase of ['before-reserve', 'after-reserve', 'before-fetch']) test(`revocation ${phase} prevents wire and releases only unsent money`, async t => {
  let current = true, checks = 0, released = 0
  const g = await setup(t, { onReserve: () => { if (phase === 'after-reserve') current = false },
    config: { acquireAdmission: () => ({ assertCurrent() {
      checks++
      if (phase === 'before-reserve' && checks === 2) current = false
      if (phase === 'before-fetch' && checks === 3) current = false
      return current
    }, release() { released++ } }) } })
  assert.notEqual((await g.post(g.body())).status, 200)
  assert.equal(g.calls(), 0); assert.equal(released, 1)
  const state = g.ledger.snapshot()
  assert.equal(state.halted, false)
  t.diagnostic(JSON.stringify({ phase, mockWireCalls: g.calls(), entries: state.entries.map(({ status, reserveNano, releasedNano }) => ({ status, reserveNano, releasedNano })), halted: state.halted }))
  if (phase === 'before-reserve') assert.equal(state.entries.length, 0)
  else {
    assert.equal(state.entries.length, 1); assert.equal(state.entries[0].status, 'not-sent')
    assert.equal(state.entries[0].releasedNano, state.entries[0].reserveNano)
  }
})
test('client abort after reservation but before fetch releases unsent reservation', async t => {
  const controller = new AbortController()
  const g = await setup(t, { onReserve: () => controller.abort(),
    config: { acquireAdmission: () => ({ assertCurrent: () => !controller.signal.aborted, release() {} }) } })
  assert.notEqual((await g.post(g.body())).status, 200)
  assert.equal(g.calls(), 0); const state = g.ledger.snapshot()
  assert.equal(state.halted, false); assert.equal(state.entries[0].status, 'not-sent')
})

test('delayed canonical resolution cannot reuse an initial session after revocation', async t => {
  let current = true, entered, release
  const started = new Promise(r => { entered = r }), held = new Promise(r => { release = r })
  const g = await setup(t, { auth: () => current ? { sessionId: 'session', subjectId: 'alice' } : null,
    project: async p => { entered(); await held; return p } })
  const pending = g.post(g.body()); await started; current = false; release()
  assert.equal((await pending).status, 401); assert.equal(g.calls(), 0)
  assert.equal(g.ledger.snapshot().entries.length, 0)
})
test('late admission acquisition is released after timeout and cannot reserve', async t => {
  let release, entered, retired = 0
  const started = new Promise(r => { entered = r }), held = new Promise(r => { release = r })
  const g = await setup(t, { config: { timeoutMs: 50, acquireAdmission: async () => {
    entered(); await held; return { assertCurrent: () => true, release: () => retired++ }
  } } })
  const pending = g.post(g.body()); await started; assert.equal((await pending).status, 504)
  release(); await new Promise(r => setTimeout(r, 30)); assert.equal(retired, 1)
  assert.equal(g.calls(), 0); assert.equal(g.ledger.snapshot().entries.length, 0)
})
