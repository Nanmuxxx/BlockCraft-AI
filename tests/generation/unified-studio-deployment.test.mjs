import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareUnifiedStudioState, deriveUnifiedTestCredentials, UNIFIED_ORIGIN, UNIFIED_EPOCH } from '../../server/unified-studio-deployment.mjs'
import { openUnifiedLedger, initializeUnifiedLedger } from '../../server/paid-gateway/unified-ledger.mjs'
const digest = s => createHash('sha256').update(s).digest('hex')
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bc-unified-migrate-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const legacy = join(root, 'mvp-5cny-20261022-scope'); mkdirSync(legacy, { mode: 0o700 })
  const access = Buffer.alloc(32, 0x42).toString('base64url'), binding = Buffer.alloc(32, 0x4b)
  const approval = { version: 1, publicOrigin: UNIFIED_ORIGIN, policyId: 'old-policy',
    approval: { providerVerified: true, permissionsVerified: true, reference: 'old-policy', maxCalls: 100, expiresAt: Number.MAX_SAFE_INTEGER },
    sessions: [{ sessionHash: digest(access), principal: 'owner-session', appId: 'pomodoro', expiresAt: Number.MAX_SAFE_INTEGER, revoked: false }] }
  const put = (name, data) => writeFileSync(join(legacy, name), data, { mode: 0o600 })
  put('binding.key', binding); put('approval.json', JSON.stringify(approval)); put('studio-ledger.json', '{"oldCalls":97,"oldNano":1373300000}')
  put('business-records.json', '{"business":"do not touch"}')
  mkdirSync(join(legacy, '.mochi-budget-v1'), { mode: 0o700 })
  writeFileSync(join(legacy, '.mochi-budget-v1/manifest.json'), '{"oldMaxCalls":100}', { mode: 0o600 })
  writeFileSync(join(root, 'mvp-5cny-attempt-1.json'), '{"oldAttempt":1}', { mode: 0o600 })
  return { root, legacy, access, binding, approval, prepare: extra => prepareUnifiedStudioState({ directory: root, access, ...extra }) }
}

test('explicit new epoch starts both shared accounts at zero, preserves credentials, archives old statistics, and reuses epoch on restart', t => {
  const f = fixture(t), originalApproval = readFileSync(join(f.legacy, 'approval.json')), originalLedger = readFileSync(join(f.legacy, 'studio-ledger.json'))
  const first = f.prepare()
  assert.equal(first.created, true)
  assert.equal(first.approval.approval.maxCalls, null)
  assert.deepEqual(first.approval.sessions, f.approval.sessions)
  assert.deepEqual(readFileSync(join(first.directory, 'binding.key')), f.binding)
  assert.deepEqual(readFileSync(join(f.legacy, 'approval.json')), originalApproval)
  assert.deepEqual(readFileSync(join(f.legacy, 'studio-ledger.json')), originalLedger)
  assert.equal(readFileSync(join(f.legacy, 'business-records.json'), 'utf8'), '{"business":"do not touch"}')
  const manifest = JSON.parse(readFileSync(join(first.directory, 'archive-manifest.json')))
  assert.ok(manifest.entries.some(e => e.file.endsWith('studio-ledger.json')))
  assert.ok(manifest.entries.some(e => e.file.endsWith('.mochi-budget-v1/manifest.json')))
  assert.ok(!manifest.entries.some(e => /business|binding|approval/.test(e.file)))
  const ledger = openUnifiedLedger(first.ledgerPath)
  assert.equal(ledger.forAccount('customer').snapshot().entries?.length ?? ledger.forAccount('customer').snapshot().calls, 0)
  assert.equal(ledger.forAccount('agent-test').snapshot().entries?.length ?? ledger.forAccount('agent-test').snapshot().calls, 0)
  ledger.close()
  const ledgerBytes = readFileSync(first.ledgerPath)
  const second = f.prepare()
  assert.equal(second.created, false)
  assert.equal(second.directory, first.directory)
  assert.deepEqual(readFileSync(second.ledgerPath), ledgerBytes)
  assert.equal(manifest.epochId, UNIFIED_EPOCH)
})

test('test credentials are a separate deterministic server identity and never appear in persisted approval or receipts', t => {
  const f = fixture(t), state = f.prepare(), credentials = deriveUnifiedTestCredentials(f.binding)
  assert.notEqual(credentials.access, f.access); assert.notEqual(credentials.session, f.access)
  assert.notEqual(credentials.session, credentials.access)
  assert.equal(credentials.sessionHash, digest(credentials.session))
  assert.deepEqual(state.testCredentials, credentials)
  for (const name of ['approval.json', 'archive-manifest.json']) {
    const value = readFileSync(join(state.directory, name), 'utf8')
    assert.ok(!value.includes(credentials.access)); assert.ok(!value.includes(credentials.session))
  }
})

test('missing ledger or epoch never reinitializes the allowance', t => {
  const f = fixture(t), first = f.prepare()
  unlinkSync(first.ledgerPath)
  assert.throws(() => f.prepare())
  assert.ok(!readdirSync(first.directory).includes('unified-ledger.json'))
})

test('interruption after migration intent or install fails closed, without mutating old credentials/statistics', t => {
  for (const stage of ['after-marker', 'before-install', 'after-install']) {
    const f = fixture(t), original = readFileSync(join(f.legacy, 'studio-ledger.json'))
    assert.throws(() => f.prepare({ fault: current => { if (current === stage) throw new Error('synthetic interrupted migration') } }))
    assert.throws(() => f.prepare(), /UNIFIED_MIGRATION_REFUSED/)
    assert.deepEqual(readFileSync(join(f.legacy, 'studio-ledger.json')), original)
  }
})

test('tampered migration receipt and mismatched original access are rejected', t => {
  const f = fixture(t); f.prepare()
  assert.throws(() => prepareUnifiedStudioState({ directory: f.root, access: Buffer.alloc(32, 0x7a).toString('base64url') }), /UNIFIED_MIGRATION_REFUSED/)
  const marker = readdirSync(f.root).find(n => n.endsWith('.migration.json'))
  const receipt = JSON.parse(readFileSync(join(f.root, marker))); receipt.payload.customer.maxNano = 99_000_000_000
  writeFileSync(join(f.root, marker), JSON.stringify(receipt))
  assert.throws(() => f.prepare(), /UNIFIED_MIGRATION_REFUSED/)
})

test('deployment endpoints enforce dedicated test authentication, same origin, unified routing, and restart continuity', async t => {
  const { startUnifiedStudioDeployment } = await import('../../server/unified-studio-deployment.mjs')
  const { request: analysis, advice } = await import('../mochi-ai/fixtures.mjs')
  const f = fixture(t), credentials = deriveUnifiedTestCredentials(f.binding)
  const verifyPricing = Object.assign(async () => {}, { assertCurrent() {} })
  let egress = 0, server
  const options = { directory: f.root, host: '127.0.0.1', port: 0, allowMountedDirectory: false, signalHandlers: false,
    env: { BLOCKCRAFT_TEST_ACCESS: f.access, DEEPSEEK_API_KEY: 'synthetic-offline-key-only' }, verifyPricing,
    fetchImpl: async () => { egress++; return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(advice()) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) } }
  const call = (path, body, cookie, origin = UNIFIED_ORIGIN) => fetch(`http://127.0.0.1:${server.server.address().port}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  try {
    server = await startUnifiedStudioDeployment(options)
    assert.equal((await (await call('/api/studio/status')).json()).authenticated, false)
    assert.equal((await call('/api/studio/test-session', { credential: f.access })).status, 401, 'customer credential cannot select test account')
    assert.equal((await call('/api/studio/session', { credential: credentials.access })).status, 401, 'test credential cannot select customer account')
    assert.equal((await call('/api/studio/test-session', { credential: credentials.access }, '', 'https://other.example')).status, 403)
    const customerLogin = await call('/api/studio/session', { credential: f.access })
    assert.equal(customerLogin.status, 200)
    const customerCookie = customerLogin.headers.get('set-cookie').split(';')[0]
    const testLogin = await call('/api/studio/test-session', { credential: credentials.access })
    assert.equal(testLogin.status, 200)
    const testCookie = testLogin.headers.get('set-cookie').split(';')[0]
    const customer = await (await call('/api/studio/status', undefined, customerCookie)).json()
    assert.equal(customer.budget.account, 'customer'); assert.equal(customer.budget.maxCalls, null); assert.equal(customer.budget.capCny, 20); assert.equal(customer.budget.calls, 0)
    const testAccount = await (await call('/api/studio/status', undefined, testCookie)).json()
    assert.equal(testAccount.budget.account, 'agent-test'); assert.equal(testAccount.budget.maxCalls, 200); assert.equal(testAccount.budget.capCny, 5)
    assert.equal((await call('/api/mochi-ai/analyze', analysis(), testCookie)).status, 200)
    assert.equal(egress, 1)
    assert.equal((await (await call('/api/studio/status', undefined, customerCookie)).json()).budget.calls, 0)
    assert.equal((await (await call('/api/studio/status', undefined, testCookie)).json()).budget.calls, 1)
    await server.shutdown(); server = await startUnifiedStudioDeployment(options)
    const after = await (await call('/api/studio/status', undefined, testCookie)).json()
    assert.equal(after.budget.calls, 1); assert.ok(after.budget.reservedCny > 0)
    assert.equal((await (await call('/api/studio/status', undefined, customerCookie)).json()).budget.calls, 0)
  } finally { await server?.shutdown() }
})

test('missing persistent ledger disables paid routes after restart rather than issuing a fresh allowance', async t => {
  const { startUnifiedStudioDeployment } = await import('../../server/unified-studio-deployment.mjs')
  const f = fixture(t), state = f.prepare()
  unlinkSync(state.ledgerPath)
  const verifyPricing = Object.assign(async () => {}, { assertCurrent() {} })
  let egress = 0
  const server = await startUnifiedStudioDeployment({ directory: f.root, host: '127.0.0.1', port: 0, signalHandlers: false,
    allowMountedDirectory: false, env: { BLOCKCRAFT_TEST_ACCESS: f.access, DEEPSEEK_API_KEY: 'synthetic-offline-key-only' },
    verifyPricing, fetchImpl: async () => { egress++; throw new Error('unexpected egress') } })
  try {
    const result = await (await fetch(`http://127.0.0.1:${server.server.address().port}/api/studio/status`, { headers: { Cookie: `__Host-bc_session=${f.access}` } })).json()
    assert.equal(result.configured, false); assert.equal(result.unavailable, 'AI_AUTHORIZATION_LOCKED'); assert.equal(egress, 0)
    assert.ok(!readdirSync(state.directory).includes('unified-ledger.json'))
  } finally { await server.shutdown() }
})


test('a valid ledger from a different epoch is rejected without issuing another allowance', t => {
  const f = fixture(t), state = f.prepare()
  unlinkSync(state.ledgerPath)
  initializeUnifiedLedger(state.ledgerPath, { epochId: 'different-owner-epoch-v1' })
  const before = readFileSync(state.ledgerPath)
  assert.throws(() => f.prepare(), error => error.code === 'UNIFIED_MIGRATION_REFUSED' && error.stage === 'ledger-epoch-mismatch')
  const ledger = openUnifiedLedger(state.ledgerPath)
  try { assert.equal(ledger.snapshot().epochId, 'different-owner-epoch-v1') } finally { ledger.close() }
  assert.deepEqual(readFileSync(state.ledgerPath), before)
})


test('status follows the paid resolver for live session revocation and expiry', async t => {
  const { startUnifiedStudioDeployment } = await import('../../server/unified-studio-deployment.mjs')
  const f = fixture(t), verifyPricing = Object.assign(async () => {}, { assertCurrent() {} })
  let egress = 0
  const server = await startUnifiedStudioDeployment({ directory: f.root, host: '127.0.0.1', port: 0, signalHandlers: false,
    allowMountedDirectory: false, env: { BLOCKCRAFT_TEST_ACCESS: f.access, DEEPSEEK_API_KEY: 'synthetic-offline-key-only' },
    verifyPricing, fetchImpl: async () => { egress++; throw new Error('unexpected egress') } })
  const state = join(f.root, 'unified-ai-budget-20261023-v1'), path = join(state, 'approval.json')
  const approval = JSON.parse(readFileSync(path)), url = `http://127.0.0.1:${server.server.address().port}`
  const headers = { Cookie: `__Host-bc_session=${f.access}`, Origin: UNIFIED_ORIGIN, 'Content-Type': 'application/json' }
  const status = async () => (await fetch(url + '/api/studio/status', { headers })).json()
  try {
    assert.equal((await status()).authenticated, true)
    approval.sessions[0].revoked = true; writeFileSync(path, JSON.stringify(approval))
    const revoked = await status()
    assert.equal(revoked.authenticated, false); assert.equal(revoked.budget, undefined)
    assert.equal((await fetch(url + '/api/mochi-ai/status', { headers })).status, 401)
    approval.sessions[0].revoked = false; approval.sessions[0].expiresAt = Date.now() - 1
    writeFileSync(path, JSON.stringify(approval))
    const expired = await status()
    assert.equal(expired.authenticated, false); assert.equal(expired.budget, undefined)
    assert.equal((await fetch(url + '/api/mochi-ai/status', { headers })).status, 401)
    assert.equal(egress, 0)
  } finally { await server.shutdown() }
})
