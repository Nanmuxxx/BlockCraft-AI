import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import { claimMvpBoot, classifyTestStartupError, prepareTestState, ORIGIN } from '../../server/studio-deployment.mjs'
import { LEGACY_STUDIO_MVP_POLICY, STUDIO_MVP_POLICY, STUDIO_PRICING as PRICING } from '../../server/paid-gateway/pricing.mjs'

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt - 60 * 60 * 1000 }))

test('startup diagnostics expose only bounded error code and stage', () => {
  assert.deepEqual(classifyTestStartupError({ code: 'LEDGER_LOCKED', stage: 'ledger' }),
    { code: 'LEDGER_LOCKED', stage: 'ledger' })
  assert.deepEqual(classifyTestStartupError({}, 'isolated-state'),
    { code: 'UNCLASSIFIED', stage: 'isolated-state' })
  assert.deepEqual(classifyTestStartupError({ code: 'contains secret', stage: 'bad stage' }),
    { code: 'UNCLASSIFIED', stage: 'storage-or-configuration' })
  assert.deepEqual(classifyTestStartupError(new Error('private details')),
    { code: 'UNCLASSIFIED', stage: 'storage-or-configuration' })
})

test('supplemental Studio grant preserves legacy receipts, caps calls, and carries usage across restart', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'bc-studio-mvp-budget-')))
  chmodSync(directory, 0o700)
  const legacy = join(directory, 'legacy-allowance.json')
  const legacyBytes = Buffer.from('{"calls":31,"capCny":25}')
  writeFileSync(legacy, legacyBytes)
  const access = 'a'.repeat(43)
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  const grant = claimMvpBoot({ directory, access })
  const responses = []
  const fetchImpl = grant.wrap(async () => { responses.push('provider'); return Response.json({ ok: true }) })
  for (let i = 0; i < 500; i++) assert.equal((await fetchImpl('https://api.deepseek.com/chat/completions')).status, 200)
  await assert.rejects(fetchImpl('https://api.deepseek.com/chat/completions'), /TEST_STATE_REFUSED/)
  assert.equal(responses.length, 500)
  assert.deepEqual(readFileSync(legacy), legacyBytes)
  assert.equal(readdirSync(directory).filter(name => /^mvp-5cny-attempt-\d+\.json$/.test(name)).length, 500)
  const restarted = claimMvpBoot({ directory, access })
  const resumed = restarted.wrap(async () => Response.json({ ok: true }))
  await assert.rejects(resumed('https://api.deepseek.com/chat/completions'), /TEST_STATE_REFUSED/)
  assert.equal(readdirSync(directory).filter(name => /^mvp-5cny-attempt-\d+\.json$/.test(name)).length, 500)
})

test('supplemental Studio grant creates a missing directory on first declaration', async t => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'bc-studio-mvp-first-')))
  const directory = join(parent, 'missing-grant-directory')
  const access = 'b'.repeat(43)
  t.after(() => rmSync(parent, { recursive: true, force: true }))

  const grant = claimMvpBoot({ directory, access })
  assert.equal(realpathSync(directory), directory)
  assert.equal((await grant.wrap(async () => Response.json({ ok: true }))('https://api.deepseek.com/chat/completions')).status, 200)
  assert.equal(readdirSync(directory).filter(name => /^mvp-5cny-20261022-allowance-spent\.json$/.test(name)).length, 1)

  const restarted = claimMvpBoot({ directory, access })
  assert.equal((await restarted.wrap(async () => Response.json({ ok: true }))('https://api.deepseek.com/chat/completions')).status, 200)
  assert.equal(readdirSync(directory).filter(name => /^mvp-5cny-attempt-\d+\.json$/.test(name)).length, 2)
})

test('MVP cap migration preserves the signed 5 CNY predecessor receipt and continues old call numbering', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'bc-studio-mvp-marker-migrate-')))
  const access = 'g'.repeat(43)
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const legacy = { version: 1, policy: LEGACY_STUDIO_MVP_POLICY.id, bootId: 'a'.repeat(32), spentAt: Date.now() - 1000,
    expiresAt: PRICING.expiresAt, maxCalls: LEGACY_STUDIO_MVP_POLICY.maxCalls,
    reservedCny: LEGACY_STUDIO_MVP_POLICY.conservativeNano / 1e9, restart: 'paid-disabled' }
  const signed = value => Buffer.from(JSON.stringify({ ...value,
    mac: createHmac('sha256', access).update(JSON.stringify(value)).digest('hex') }))
  const oldBytes = signed(legacy)
  writeFileSync(join(directory, 'mvp-5cny-20261022-allowance-spent.json'), oldBytes, { mode: 0o600 })
  for (let call = 1; call <= 3; call++) writeFileSync(join(directory, `mvp-5cny-attempt-${call}.json`), '{}', { mode: 0o600 })
  const grant = claimMvpBoot({ directory, access })
  const newMarker = JSON.parse(readFileSync(join(directory, 'mvp-5cny-20261022-allowance-spent.json')))
  assert.equal(newMarker.policy, STUDIO_MVP_POLICY.id)
  assert.equal(newMarker.maxCalls, 500)
  assert.deepEqual(readFileSync(join(directory, 'mvp-5cny-20261022-allowance-spent.predecessor.json')), oldBytes)
  assert.equal((await grant.wrap(async () => Response.json({ ok: true }))('https://api.deepseek.com/chat/completions')).status, 200)
  assert.ok(readdirSync(directory).includes('mvp-5cny-attempt-4.json'))
})

test('mounted directory compatibility is opt-in and keeps ordinary state strict', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'bc-studio-mvp-mounted-')))
  const access = 'c'.repeat(43)
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  chmodSync(directory, 0o755)
  assert.throws(() => prepareTestState({ directory, access }), /TEST_STATE_REFUSED/)
  assert.throws(() => prepareTestState({ directory, access, allowMountedDirectory: true }), /TEST_STATE_REFUSED/)
})

test('mounted first-init interruption can resume only from an empty receipt', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'bc-studio-mvp-repair-')))
  const access = 'd'.repeat(43)
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  chmodSync(directory, 0o777)
  writeFileSync(join(directory, 'deployment-receipt.json'), '')

  const state = prepareTestState({ directory, access, allowMountedDirectory: true })
  assert.equal(state.created, true)
  assert.ok(readFileSync(join(directory, 'deployment-receipt.json')).length > 0)
  assert.throws(() => prepareTestState({ directory, access: 'e'.repeat(43), allowMountedDirectory: true }), /TEST_STATE_REFUSED/)
})

test('15 CNY policy migration rewrites metadata and preserves settled ledger entries', t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'bc-studio-mvp-migrate-')))
  const access = 'f'.repeat(43)
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const accessHash = createHash('sha256').update(access).digest('hex')
  writeFileSync(join(directory, 'deployment-receipt.json'), JSON.stringify({ version: 1, policy: LEGACY_STUDIO_MVP_POLICY.id, origin: ORIGIN, accessHash, expiresAt: PRICING.expiresAt }), { mode: 0o600 })
  writeFileSync(join(directory, 'binding.key'), Buffer.alloc(32, 7), { mode: 0o600 })
  writeFileSync(join(directory, 'approval.json'), JSON.stringify({ version: 1, publicOrigin: ORIGIN, policyId: LEGACY_STUDIO_MVP_POLICY.id,
    approval: { providerVerified: true, permissionsVerified: true, reference: LEGACY_STUDIO_MVP_POLICY.approval, maxCalls: 8, expiresAt: PRICING.expiresAt },
    sessions: [{ sessionHash: accessHash, principal: 'studio-test-owner-20261020', expiresAt: PRICING.expiresAt, revoked: false, appId: 'pomodoro' }] }), { mode: 0o600 })
  writeFileSync(join(directory, 'studio-ledger.json'), JSON.stringify({ version: 3, approval: LEGACY_STUDIO_MVP_POLICY.approval, profile: 'studio-mvp', pricing: PRICING,
    entries: [{ id: 'legacy-entry', reserveNano: 10000, inputBound: 1, outputBound: 1, status: 'settled', estimatedNano: 10000, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }], halted: false }), { mode: 0o600 })
  const state = prepareTestState({ directory, access })
  assert.equal(state.approval.policyId, STUDIO_MVP_POLICY.id)
  assert.equal(state.approval.approval.maxCalls, 500)
  assert.equal(JSON.parse(readFileSync(join(directory, 'studio-ledger.json'))).entries.length, 1)
  assert.equal(JSON.parse(readFileSync(join(directory, 'studio-ledger.json'))).approval, STUDIO_MVP_POLICY.approval)
})
