import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { openMochiBudget } from '../../server/paid-gateway/mochi-budget.mjs'
import { PRICING, price, STUDIO_MVP_POLICY } from '../../server/paid-gateway/pricing.mjs'

const bindingKey = Buffer.alloc(32, 0x3c)
const hash = 'ab'.repeat(32)
const storePath = directory => join(directory, '.mochi-budget-v1')
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'blockcraft-mochi-budget-'))
  chmodSync(directory, 0o700)
  const ledgerPath = join(directory, 'ledger.json')
  const ledger = openLedger(ledgerPath)
  t.after(() => { ledger.close(); rmSync(directory, { recursive: true, force: true }) })
  return { directory, ledgerPath, ledger }
}
const open = (fixture, options = {}) => openMochiBudget({ ...fixture, bindingKey, ...options })
const reserve = budget => budget.reserve(100, 100, hash)

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt - 1000 }))

test('seeds original eight calls and their conservative amount without consuming primary call budget', t => {
  const fixtureValue = fixture(t), budget = open(fixtureValue)
  assert.deepEqual(budget.snapshot(), {
    calls: 8, reservedNano: 280_314_000, maxCalls: 100, maxNano: 5_000_000_000,
    seedCalls: 8, seedNano: 280_314_000, remainingCalls: 92, remainingNano: 4_719_686_000, pricingExpiresAt: PRICING.expiresAt,
  })
  assert.equal(fixtureValue.ledger.snapshot().entries.length, 0)
  const id = reserve(budget)
  assert.match(id, /^[a-f0-9-]{36}$/)
  // Model transport may only run after reserve returns: the signed receipt
  // already exists on disk, including the exact conservative token ceiling.
  const record = JSON.parse(readFileSync(join(storePath(fixtureValue.directory), '001.json'), 'utf8'))
  assert.equal(record.payload.id, id)
  assert.equal(record.payload.reserveNano, price(100, 100))
  assert.equal(lstatSync(storePath(fixtureValue.directory)).mode & 0o777, 0o700)
  assert.equal(lstatSync(join(storePath(fixtureValue.directory), '001.json')).mode & 0o777, 0o600)
  assert.equal(JSON.stringify(record).includes(bindingKey.toString('hex')), false)
})

test('100-call cap includes samples, survives restart and shared handles never use stale counts', t => {
  const value = fixture(t), first = open(value), second = open(value)
  let mockEgress = 0
  for (let index = 0; index < 92; index++) { reserve(index % 2 ? first : second); mockEgress++ }
  assert.equal(mockEgress, 92)
  assert.equal(first.snapshot().calls, 100)
  assert.throws(() => reserve(second), { code: 'MOCHI_BUDGET_EXHAUSTED' })
  value.ledger.close()
  const restartedLedger = openLedger(value.ledgerPath)
  const reopened = open({ ...value, ledger: restartedLedger })
  assert.equal(reopened.snapshot().remainingCalls, 0)
  assert.throws(() => reserve(reopened), { code: 'MOCHI_BUDGET_EXHAUSTED' })
  assert.equal(reopened.snapshot().reservedNano, 280_314_000 + 92 * price(100, 100))
  restartedLedger.close()
})

test('money cap stops independently of call cap and does not refund after restart', t => {
  const value = fixture(t), budget = open(value)
  const input = STUDIO_MVP_POLICY.maxInputBytes + STUDIO_MVP_POLICY.framingTokens
  const output = STUDIO_MVP_POLICY.maxOutputTokens
  const allowed = Math.floor(4_719_686_000 / price(input, output))
  for (let index = 0; index < allowed; index++) budget.reserve(input, output, hash)
  assert.ok(budget.snapshot().remainingCalls > 0)
  assert.throws(() => budget.reserve(input, output, hash), { code: 'MOCHI_BUDGET_EXHAUSTED' })
  const reopened = open(value)
  assert.throws(() => reopened.reserve(input, output, hash), { code: 'MOCHI_BUDGET_EXHAUSTED' })
  assert.equal(reopened.snapshot().reservedNano, 280_314_000 + allowed * price(input, output))
})

test('expiry rejects reserve and snapshot with no additional receipt or mock egress', t => {
  const value = fixture(t), budget = open(value)
  reserve(budget)
  t.mock.timers.tick(1000)
  let mockEgress = 0
  assert.throws(() => { reserve(budget); mockEgress++ }, { code: 'PRICING_EXPIRED' })
  assert.throws(() => budget.snapshot(), { code: 'PRICING_EXPIRED' })
  assert.equal(mockEgress, 0)
  assert.equal(lstatSync(join(storePath(value.directory), '001.json')).isFile(), true)
  assert.throws(() => lstatSync(join(storePath(value.directory), '002.json')), { code: 'ENOENT' })
})

test('invalid bounds and non-hash request identity fail before persistence without poisoning valid input', t => {
  const value = fixture(t), budget = open(value)
  for (const args of [[0, 1, hash], [1, -1, hash], [1, 8193, hash], [73_729, 1, hash], [1.5, 1, hash], [1, 1, 'private prompt']]) {
    assert.throws(() => budget.reserve(...args), { code: 'MOCHI_BUDGET_RESERVATION_INVALID' })
  }
  assert.equal(budget.snapshot().calls, 8)
  reserve(budget)
  assert.equal(budget.snapshot().calls, 9)
})

test('requires canonical active lease and an adequate binding key', t => {
  const value = fixture(t)
  assert.throws(() => open({ ...value, ledger: {} }), { code: 'LEDGER_LEASE_REQUIRED' })
  assert.throws(() => open(value, { bindingKey: Buffer.alloc(16) }), { code: 'MOCHI_BUDGET_KEY_REQUIRED' })
  const other = mkdtempSync(join(tmpdir(), 'blockcraft-mochi-other-'))
  t.after(() => rmSync(other, { recursive: true, force: true }))
  assert.throws(() => open({ ...value, directory: other }), { code: 'SIDECAR_DIRECTORY_MISMATCH' })
  const budget = open(value)
  value.ledger.close()
  assert.throws(() => reserve(budget), { code: 'LEDGER_LEASE_REQUIRED' })
  assert.throws(() => budget.snapshot(), { code: 'LEDGER_LEASE_REQUIRED' })
})

test('modified signed receipt or manifest and wrong binding key fail closed across restart', t => {
  for (const target of ['manifest.json', '001.json']) {
    const value = fixture(t), budget = open(value)
    reserve(budget)
    const path = join(storePath(value.directory), target), record = JSON.parse(readFileSync(path, 'utf8'))
    if (target === 'manifest.json') record.payload.seedCalls = 0
    else record.payload.reserveNano = 1
    writeFileSync(path, JSON.stringify(record))
    assert.throws(() => reserve(budget), { code: 'MOCHI_BUDGET_INVALID' })
    assert.throws(() => reserve(budget), { code: 'MOCHI_BUDGET_UNAVAILABLE' })
    assert.throws(() => open(value), { code: 'MOCHI_BUDGET_INVALID' })
  }
  const value = fixture(t)
  open(value)
  assert.throws(() => open(value, { bindingKey: Buffer.alloc(32, 0x4a) }), { code: 'MOCHI_BUDGET_INVALID' })
})

test('truncated receipt, missing manifest and receipt sequence gaps cannot initialize a new budget', t => {
  for (const damage of ['partial', 'missing-manifest', 'gap']) {
    const value = fixture(t), budget = open(value)
    reserve(budget)
    const path = storePath(value.directory)
    if (damage === 'partial') writeFileSync(join(path, '002.json'), '{', { mode: 0o600 })
    if (damage === 'missing-manifest') unlinkSync(join(path, 'manifest.json'))
    if (damage === 'gap') renameSync(join(path, '001.json'), join(path, '002.json'))
    assert.throws(() => open(value), error => ['MOCHI_BUDGET_INVALID', 'MOCHI_BUDGET_UNAVAILABLE'].includes(error.code))
  }
  const value = fixture(t)
  mkdirSync(storePath(value.directory), { mode: 0o700 })
  assert.throws(() => open(value), { code: 'MOCHI_BUDGET_INVALID' })
})

test('symlink directories, linked receipts and permissive files are rejected', t => {
  for (const damage of ['symlink-directory', 'symlink-file', 'hardlink', 'permissions']) {
    const value = fixture(t), budget = open(value)
    reserve(budget)
    const path = storePath(value.directory), receipt = join(path, '001.json')
    if (damage === 'symlink-directory') {
      renameSync(path, path + '-original')
      symlinkSync(path + '-original', path, 'dir')
    } else if (damage === 'symlink-file') {
      renameSync(receipt, join(value.directory, 'original.json'))
      symlinkSync(join(value.directory, 'original.json'), receipt)
    } else if (damage === 'hardlink') linkSync(receipt, join(value.directory, 'linked.json'))
    else chmodSync(receipt, 0o644)
    assert.throws(() => reserve(budget), { code: 'MOCHI_BUDGET_PERMISSIONS' })
    assert.throws(() => open(value), { code: 'MOCHI_BUDGET_PERMISSIONS' })
  }
})

test('failed exclusive append poisons handle and leaves malformed entry fail closed on restart', t => {
  const value = fixture(t), budget = open(value)
  reserve(budget)
  // Simulate a crashed prior append; preflight must reject it before a caller
  // can reach its mock provider, and must retain the conservative first call.
  writeFileSync(join(storePath(value.directory), '002.json'), '', { mode: 0o600 })
  let mockEgress = 0
  assert.throws(() => { reserve(budget); mockEgress++ }, { code: 'MOCHI_BUDGET_INVALID' })
  assert.throws(() => reserve(budget), { code: 'MOCHI_BUDGET_UNAVAILABLE' })
  assert.equal(mockEgress, 0)
  assert.throws(() => open(value), { code: 'MOCHI_BUDGET_INVALID' })
})

test('mounted parent compatibility never relaxes newly created budget directory/files', t => {
  const value = fixture(t)
  chmodSync(value.directory, 0o777)
  assert.throws(() => open(value), { code: 'MOCHI_BUDGET_PERMISSIONS' })
  const budget = open(value, { allowMountedDirectory: true })
  reserve(budget)
  assert.equal(lstatSync(storePath(value.directory)).mode & 0o777, 0o700)
  assert.equal(lstatSync(join(storePath(value.directory), '001.json')).mode & 0o777, 0o600)
})

test('lost receipt tails, whole stores and independent anchors cannot roll back allowance after restart', t => {
  for (const damage of ['tail', 'whole-store', 'anchor', 'anchor-tail', 'anchor-partial']) {
    const value = fixture(t), budget = open(value)
    reserve(budget)
    const path = storePath(value.directory)
    const anchor = join(value.directory, '.mochi-budget-anchor-v1-001.json')
    if (damage === 'tail') unlinkSync(join(path, '001.json'))
    if (damage === 'whole-store') rmSync(path, { recursive: true })
    if (damage === 'anchor') unlinkSync(join(value.directory, '.mochi-budget-anchor-v1-manifest.json'))
    if (damage === 'anchor-tail') unlinkSync(anchor)
    if (damage === 'anchor-partial') writeFileSync(anchor, '{')
    let mockEgress = 0
    assert.throws(() => { reserve(budget); mockEgress++ }, error => ['MOCHI_BUDGET_INVALID', 'MOCHI_BUDGET_UNAVAILABLE'].includes(error.code))
    value.ledger.close()
    const restartedLedger = openLedger(value.ledgerPath)
    try {
      assert.throws(() => open({ ...value, ledger: restartedLedger }), error => ['MOCHI_BUDGET_INVALID', 'MOCHI_BUDGET_UNAVAILABLE'].includes(error.code))
      assert.equal(mockEgress, 0)
    } finally { restartedLedger.close() }
  }
})

test('a reservation interrupted between parent anchor and receipt stays fail closed', t => {
  const value = fixture(t), budget = open(value)
  reserve(budget)
  // A complete signed anchor with no corresponding store receipt models the
  // exact persisted state of a crash between the two durable appends.
  const record = JSON.parse(readFileSync(join(value.directory, '.mochi-budget-anchor-v1-001.json'), 'utf8'))
  assert.equal(record.payload.sequence, 1)
  unlinkSync(join(storePath(value.directory), '001.json'))
  assert.throws(() => open(value), { code: 'MOCHI_BUDGET_INVALID' })
})

test('paired receipt/anchor tail deletion and total subordinate loss cannot roll back the primary checkpoint', t => {
  for (const damage of ['paired-tail', 'both-stores']) {
    const value = fixture(t), budget = open(value)
    reserve(budget)
    const expected = { version: 1, sequence: 1, calls: 9, reservedNano: 280_314_000 + price(100, 100) }
    assert.deepEqual(value.ledger.mochiBudgetSnapshot(), expected)
    if (damage === 'paired-tail') {
      unlinkSync(join(storePath(value.directory), '001.json'))
      unlinkSync(join(value.directory, '.mochi-budget-anchor-v1-001.json'))
    } else {
      rmSync(storePath(value.directory), { recursive: true })
      for (const name of ['manifest.json', '001.json']) unlinkSync(join(value.directory, '.mochi-budget-anchor-v1-' + name))
    }
    let mockEgress = 0
    assert.throws(() => { reserve(budget); mockEgress++ }, error => ['MOCHI_BUDGET_INVALID', 'MOCHI_BUDGET_UNAVAILABLE'].includes(error.code))
    assert.equal(mockEgress, 0)
    value.ledger.close()
    const restartedLedger = openLedger(value.ledgerPath)
    try {
      assert.deepEqual(restartedLedger.mochiBudgetSnapshot(), expected)
      assert.throws(() => open({ ...value, ledger: restartedLedger }), { code: 'MOCHI_BUDGET_INVALID' })
      assert.deepEqual(restartedLedger.mochiBudgetSnapshot(), expected)
    } finally { restartedLedger.close() }
  }
})

test('initialization or reservation interrupted after its primary checkpoint stays fail closed on restart', t => {
  for (const stage of ['initialize', 'reserve']) {
    const value = fixture(t)
    const seed = { version: 1, sequence: 0, calls: 8, reservedNano: 280_314_000 }
    if (stage === 'initialize') value.ledger.advanceMochiBudgetCheckpoint(seed)
    else {
      open(value)
      value.ledger.advanceMochiBudgetCheckpoint({ ...seed, sequence: 1, calls: 9, reservedNano: seed.reservedNano + price(100, 100) })
    }
    assert.throws(() => open(value), { code: 'MOCHI_BUDGET_INVALID' })
    value.ledger.close()
    const restartedLedger = openLedger(value.ledgerPath)
    try { assert.throws(() => open({ ...value, ledger: restartedLedger }), { code: 'MOCHI_BUDGET_INVALID' }) }
    finally { restartedLedger.close() }
  }
})

test('legacy primary ledgers retain settled entries and initialize the optional checkpoint once', t => {
  const value = fixture(t)
  const id = value.ledger.reserve(100, 100, hash)
  value.ledger.settle(id, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })
  const before = value.ledger.snapshot()
  assert.equal(Object.hasOwn(before, 'mochiBudgetCheckpoint'), false)
  assert.equal(value.ledger.mochiBudgetSnapshot(), null)
  value.ledger.close()
  const restartedLedger = openLedger(value.ledgerPath)
  try {
    const budget = open({ ...value, ledger: restartedLedger })
    assert.equal(budget.snapshot().calls, 8)
    assert.deepEqual(restartedLedger.snapshot().entries, before.entries)
    const copied = restartedLedger.mochiBudgetSnapshot(); copied.calls = 0
    assert.equal(restartedLedger.mochiBudgetSnapshot().calls, 8)
    assert.throws(() => restartedLedger.advanceMochiBudgetCheckpoint({ version: 1, sequence: 0, calls: 8, reservedNano: 280_314_000 }),
      { code: 'MOCHI_BUDGET_CHECKPOINT_INVALID' })
  } finally { restartedLedger.close() }
})

test('primary checkpoints reject unknown fields, inconsistent counts and nonmonotonic advances', t => {
  const value = fixture(t), budget = open(value)
  const seed = value.ledger.mochiBudgetSnapshot()
  for (const invalid of [null, {}, { ...seed, extra: true }, { ...seed, version: 2 }, { ...seed, calls: 7 },
    { ...seed, sequence: -1 }, { ...seed, reservedNano: 0 }, { ...seed, reservedNano: 5_000_000_001 },
    { ...seed, sequence: 2, calls: 10, reservedNano: seed.reservedNano + 1 },
    { ...seed, sequence: 1, calls: 9 }, seed]) {
    assert.throws(() => value.ledger.advanceMochiBudgetCheckpoint(invalid), { code: 'MOCHI_BUDGET_CHECKPOINT_INVALID' })
    assert.deepEqual(value.ledger.mochiBudgetSnapshot(), seed)
  }
  reserve(budget)
  const first = value.ledger.mochiBudgetSnapshot()
  assert.throws(() => value.ledger.advanceMochiBudgetCheckpoint({ ...first, sequence: 2, calls: 10, reservedNano: seed.reservedNano }),
    { code: 'MOCHI_BUDGET_CHECKPOINT_INVALID' })
  assert.equal(budget.snapshot().calls, 9)
})

test('malformed persisted primary checkpoints refuse ledger restart while old ledgers remain compatible', t => {
  const invalid = [null, [], {}, { version: 1, sequence: 0, calls: 8, reservedNano: 280_314_000, unknown: true },
    { version: 1, sequence: 1, calls: 8, reservedNano: 280_314_001 },
    { version: 1, sequence: 93, calls: 101, reservedNano: 280_314_001 }]
  for (const checkpoint of invalid) {
    const value = fixture(t)
    value.ledger.close()
    const state = JSON.parse(readFileSync(value.ledgerPath, 'utf8'))
    state.mochiBudgetCheckpoint = checkpoint
    writeFileSync(value.ledgerPath, JSON.stringify(state))
    assert.throws(() => openLedger(value.ledgerPath), { code: 'MOCHI_BUDGET_CHECKPOINT_INVALID' })
  }
})

test('checkpoint persistence failure prevents receipts and egress and poisons the ledger', t => {
  const value = fixture(t), budget = open(value)
  const before = readFileSync(value.ledgerPath, 'utf8')
  // Make only the atomic replacement destination invalid. This models a
  // durable-write failure without changing filesystem permissions or globals.
  renameSync(value.ledgerPath, value.ledgerPath + '.retained')
  mkdirSync(value.ledgerPath, { mode: 0o700 })
  let mockEgress = 0
  assert.throws(() => { reserve(budget); mockEgress++ }, { code: 'MOCHI_BUDGET_UNAVAILABLE' })
  assert.equal(mockEgress, 0)
  assert.throws(() => value.ledger.mochiBudgetSnapshot(), { code: 'LEDGER_UNAVAILABLE' })
  assert.throws(() => lstatSync(join(storePath(value.directory), '001.json')), { code: 'ENOENT' })
  assert.throws(() => lstatSync(join(value.directory, '.mochi-budget-anchor-v1-001.json')), { code: 'ENOENT' })
  assert.equal(readFileSync(value.ledgerPath + '.retained', 'utf8'), before)
})
