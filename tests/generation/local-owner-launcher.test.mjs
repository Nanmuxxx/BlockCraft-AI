import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, lstatSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertLocalGatewayProfile, provisionLocalOwnerState, startLocalOwnerServer } from '../../server/local-owner-launcher.mjs'

const validProfile = {
  policy: { maxCalls: 3, maxOutputTokens: 2048, concurrency: 1, retries: 0, conservativeNano: 500_000_000, maxInputBytes: 65_536, framingTokens: 8192 },
  pricing: { expiresAt: Date.now() + 60_000, model: 'deepseek-flash', inputNanoPerToken: 2_000, outputNanoPerToken: 8_000 },
}
const env = () => ({
  BLOCKCRAFT_LOCAL_OWNER_APPROVED: '1',
  BLOCKCRAFT_LOCAL_SESSION_TOKEN: 'a'.repeat(43),
  BLOCKCRAFT_LOCAL_IDEMPOTENCY_BINDING_KEY: Buffer.alloc(32, 7).toString('base64url'),
  BLOCKCRAFT_LOCAL_PORT: '3017',
  DEEPSEEK_API_KEY: 'synthetic-test-key-never-real',
  DEEPSEEK_BUDGET_LEDGER_PATH: '/tmp/blockcraft-local-test/ledger.json',
})

test('local paid startup refuses expired and over-cap Gateway profiles before touching runtime inputs', () => {
  assert.throws(() => assertLocalGatewayProfile({ ...validProfile, pricing: { ...validProfile.pricing, expiresAt: 0 } }), /expired/)
  assert.throws(() => assertLocalGatewayProfile({ ...validProfile, policy: { ...validProfile.policy, maxCalls: 6 } }), /maxCalls=3/)
  assert.throws(() => assertLocalGatewayProfile({ ...validProfile, policy: { ...validProfile.policy, conservativeNano: 1_000_000_000 } }), /¥0.50/)
  assert.equal(assertLocalGatewayProfile(validProfile), true)
})

test('owner launcher requires explicit approval and rejects an explicitly expired profile', async () => {
  let runtimeCalls = 0, serverCalls = 0
  await assert.rejects(startLocalOwnerServer({ env: {}, runtimeFactory: () => { runtimeCalls++ }, serverFactory: () => { serverCalls++ } }), /OWNER_APPROVED/)
  await assert.rejects(startLocalOwnerServer({ env: env(), profile: { ...validProfile, pricing: { ...validProfile.pricing, expiresAt: 0 } }, runtimeFactory: () => { runtimeCalls++ }, serverFactory: () => { serverCalls++ } }), /expired|SMOKE_POLICY/)
  assert.equal(runtimeCalls, 0)
  assert.equal(serverCalls, 0)
})


test('private identity state persists across startup without replacing the binding key', () => {
  const directory = join(mkdtempSync(join(tmpdir(), 'bc-launcher-test-')), 'private')
  const first = provisionLocalOwnerState(directory)
  const second = provisionLocalOwnerState(directory)
  assert.deepEqual(first.bindingKey, second.bindingKey)
  assert.equal(first.bindingKey.length, 32)
  assert.equal(first.ledgerPath, join(directory, 'smoke-ledger.json'))
  assert.equal(lstatSync(directory).mode & 0o777, 0o700)
  assert.equal(lstatSync(join(directory, 'binding.key')).mode & 0o777, 0o600)
  chmodSync(join(directory, 'binding.key'), 0o644)
  assert.throws(() => provisionLocalOwnerState(directory), /permissions/)
})
