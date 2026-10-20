import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildContinuityPlan } from '../../server/paid-gateway/continuity.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/continuity-synthetic.json', import.meta.url), 'utf8'))
const clone = value => structuredClone(value)

test('builds a policy/version-bound opening debit from a synthetic receipt', () => {
  const plan = buildContinuityPlan(fixture)
  assert.equal(plan.openingDebit.type, 'opening-debit')
  assert.equal(plan.openingDebit.calls, 1)
  assert.equal(plan.openingDebit.reservedNano, 36_658_000)
  assert.equal(plan.openingDebit.receiptDigest, fixture.sourceReceipt.digest)
  assert.equal(plan.targetProfile.version, 1)
  assert.equal(plan.limits.maxCalls, 3)
  assert.equal(plan.limits.maxSpendNano, 20_000_000_000)
  assert.equal(plan.planDigest.length, 64)
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.openingDebit))
})

test('preserves opening debit and digest through a restart-like JSON round trip', () => {
  const first = buildContinuityPlan(fixture)
  const reloaded = JSON.parse(JSON.stringify(first))
  assert.deepEqual(reloaded.openingDebit, first.openingDebit)
  assert.equal(reloaded.planDigest, first.planDigest)
})

test('rejects a repeated receipt import', () => {
  const input = clone(fixture)
  input.importedSourceDigests = [input.sourceReceipt.digest]
  assert.throws(() => buildContinuityPlan(input), { code: 'CONTINUITY_DUPLICATE_IMPORT' })
})

test('fails closed for unknown or uncertain accounting', () => {
  const unknown = clone(fixture)
  unknown.source.accounting.unknownItems = ['unreconciled synthetic record']
  assert.throws(() => buildContinuityPlan(unknown), { code: 'CONTINUITY_ACCOUNTING_UNCERTAIN' })
  const uncertain = clone(fixture)
  uncertain.source.accounting.uncertain = true
  assert.throws(() => buildContinuityPlan(uncertain), { code: 'CONTINUITY_ACCOUNTING_UNCERTAIN' })
})

test('rejects policy/version drift, unsupported source ledger and changed ceilings', () => {
  const targetVersion = clone(fixture)
  targetVersion.target.profile.version = 2
  assert.throws(() => buildContinuityPlan(targetVersion), { code: 'CONTINUITY_TARGET_POLICY_MISMATCH' })
  const policy = clone(fixture)
  policy.target.limits.maxCalls = 4
  assert.throws(() => buildContinuityPlan(policy), { code: 'CONTINUITY_TARGET_LIMIT_MISMATCH' })
  const source = clone(fixture)
  source.source.profile.version = 1
  assert.throws(() => buildContinuityPlan(source), { code: 'CONTINUITY_SOURCE_PROFILE_UNSUPPORTED' })
})

test('rejects malformed receipt and accounting mismatch', () => {
  const badReceipt = clone(fixture)
  badReceipt.sourceReceipt.digest = 'not-a-digest'
  assert.throws(() => buildContinuityPlan(badReceipt), { code: 'CONTINUITY_RECEIPT_INVALID' })
  const badAccounting = clone(fixture)
  badAccounting.source.accounting.consumedCalls = 0
  assert.throws(() => buildContinuityPlan(badAccounting), { code: 'CONTINUITY_ACCOUNTING_MISMATCH' })
})
