import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { openIdempotencySidecar } from '../../server/paid-gateway/idempotency-sidecar.mjs'

const bindingKey = Buffer.alloc(32, 0x5a)
const idempotencyKey = '0123456789abcdefghijklmnopqrstuv'
const payload = Buffer.from('{"idea":"task list"}')
const reserveOptions = { inputBound: 100, outputBound: 100, requestHash: 'mock-request-hash' }

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'blockcraft-idempotency-'))
  chmodSync(directory, 0o700)
  const ledgerPath = join(directory, 'ledger.json')
  t.after(() => import('node:fs/promises').then(fs => fs.rm(directory, { recursive: true, force: true })))
  return { directory, ledgerPath }
}

function sidecar(ledger, directory, options = {}) {
  return openIdempotencySidecar({ ledger, directory, bindingKey, ...options })
}

function reserve(store, overrides = {}) {
  return store.reserve({ principal: 'opaque-account-17', idempotencyKey, payload, ...reserveOptions, ...overrides })
}

test('same principal/key is single-use concurrently and remains claimed after restart', t => {
  const { directory, ledgerPath } = fixture(t)
  let ledger = openLedger(ledgerPath)
  let store = sidecar(ledger, directory)
  let mockEgressCalls = 0
  const outcomes = Array.from({ length: 12 }, () => {
    try { const id = reserve(store); mockEgressCalls++; return { id } } catch (error) { return { code: error.code } }
  })
  assert.equal(outcomes.filter(x => x.id).length, 1)
  assert.equal(outcomes.filter(x => x.code === 'IDEMPOTENCY_REPLAY').length, 11)
  assert.equal(mockEgressCalls, 1)
  ledger.settle(outcomes.find(x => x.id).id, { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 })
  store.close()
  ledger.close()

  ledger = openLedger(ledgerPath)
  store = sidecar(ledger, directory)
  assert.throws(() => reserve(store), { code: 'IDEMPOTENCY_REPLAY' })
  assert.equal(ledger.snapshot().entries.length, 1)
  assert.equal(JSON.stringify(store.snapshot()).includes('opaque-account-17'), false)
  assert.equal(JSON.stringify(store.snapshot()).includes(idempotencyKey), false)
  assert.equal(readFileSync(join(directory, '.paid-idempotency.json'), 'utf8').includes(bindingKey.toString()), false)
  assert.equal(lstatSync(join(directory, '.paid-idempotency.json')).mode & 0o077, 0)
  store.close()
  ledger.close()
})

test('same principal/key with different payload conflicts without a second reservation', t => {
  const { directory, ledgerPath } = fixture(t)
  const ledger = openLedger(ledgerPath)
  const store = sidecar(ledger, directory)
  reserve(store)
  assert.throws(() => reserve(store, { payload: Buffer.from('{"idea":"different"}') }), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal(ledger.snapshot().entries.length, 1)
  store.close()
  ledger.close()
})

test('invalid identity or idempotency key fails closed before claim and reservation', t => {
  const { directory, ledgerPath } = fixture(t)
  const ledger = openLedger(ledgerPath)
  const store = sidecar(ledger, directory)
  assert.throws(() => reserve(store, { principal: true }), { code: 'PRINCIPAL_INVALID' })
  assert.throws(() => reserve(store, { idempotencyKey: 'user-id' }), { code: 'IDEMPOTENCY_KEY_INVALID' })
  assert.equal(store.snapshot().claims.length, 0)
  assert.equal(ledger.snapshot().entries.length, 0)
  store.close()
  ledger.close()
})

test('claim-store creation failure and corruption happen before any reservation', t => {
  const { directory, ledgerPath } = fixture(t)
  mkdirSync(join(directory, '.paid-idempotency.json'))
  const ledger = openLedger(ledgerPath)
  assert.throws(() => sidecar(ledger, directory), { code: 'IDEMPOTENCY_STORE_PERMISSIONS' })
  assert.equal(ledger.snapshot().entries.length, 0)
  ledger.close()

  const second = fixture(t)
  writeFileSync(join(second.directory, '.paid-idempotency.json'), '{broken', { mode: 0o600 })
  const ledger2 = openLedger(second.ledgerPath)
  assert.throws(() => sidecar(ledger2, second.directory), { code: 'IDEMPOTENCY_UNAVAILABLE' })
  assert.equal(ledger2.snapshot().entries.length, 0)
  ledger2.close()
})

test('claim persistence failure poisons the sidecar before reservation and later retries', t => {
  const { directory, ledgerPath } = fixture(t)
  const ledger = openLedger(ledgerPath)
  const store = sidecar(ledger, directory)
  const moved = directory + '-moved'
  renameSync(directory, moved)
  writeFileSync(directory, 'blocked path')
  assert.throws(() => reserve(store), { code: 'IDEMPOTENCY_UNAVAILABLE' })
  unlinkSync(directory)
  renameSync(moved, directory)
  assert.throws(() => reserve(store), { code: 'IDEMPOTENCY_UNAVAILABLE' })
  assert.equal(ledger.snapshot().entries.length, 0)
  store.close()
  ledger.close()
})

test('capacity and binding-key mismatch fail closed before reserve', t => {
  const { directory, ledgerPath } = fixture(t)
  let ledger = openLedger(ledgerPath)
  let store = sidecar(ledger, directory, { maxClaims: 1 })
  reserve(store)
  store.close()
  ledger.close()

  ledger = openLedger(ledgerPath)
  assert.throws(() => sidecar(ledger, directory, { maxClaims: 1, bindingKey: Buffer.alloc(32, 0x4b) }), { code: 'IDEMPOTENCY_KEY_MISMATCH' })
  store = sidecar(ledger, directory, { maxClaims: 1 })
  assert.throws(() => reserve(store, { idempotencyKey: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef' }), { code: 'IDEMPOTENCY_STORE_FULL' })
  assert.equal(ledger.snapshot().entries.length, 1)
  store.close()
  ledger.close()
})

test('unknown outcome keeps claim and ledger halt across restart', t => {
  const { directory, ledgerPath } = fixture(t)
  let ledger = openLedger(ledgerPath)
  let store = sidecar(ledger, directory)
  const id = reserve(store)
  ledger.uncertain(id)
  store.close()
  ledger.close()

  ledger = openLedger(ledgerPath)
  store = sidecar(ledger, directory)
  assert.throws(() => reserve(store), { code: 'IDEMPOTENCY_REPLAY' })
  assert.equal(ledger.snapshot().halted, true)
  assert.equal(ledger.snapshot().entries.length, 1)
  store.close()
  ledger.close()
})

test('a second handle cannot retain stale claims; close/reopen reloads settled claims', t => {
  const { directory, ledgerPath } = fixture(t)
  const ledger = openLedger(ledgerPath)
  const first = sidecar(ledger, directory)
  assert.throws(() => sidecar(ledger, directory), { code: 'IDEMPOTENCY_LOCKED' })
  const id = reserve(first)
  ledger.settle(id, { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 })
  assert.throws(() => sidecar(ledger, directory), { code: 'IDEMPOTENCY_LOCKED' })
  first.close()
  const second = sidecar(ledger, directory)
  first.close() // An old handle must not release its replacement's lease.
  assert.throws(() => reserve(first), { code: 'IDEMPOTENCY_UNAVAILABLE' })
  assert.throws(() => reserve(second), { code: 'IDEMPOTENCY_REPLAY' })
  assert.throws(() => sidecar(ledger, directory), { code: 'IDEMPOTENCY_LOCKED' })
  assert.equal(ledger.snapshot().entries.length, 1)
  assert.equal(second.snapshot().claims.length, 1)
  second.close()
  ledger.close()
})

test('directory-wide ownership excludes different ledgers, aliases and another process', t => {
  const { directory, ledgerPath } = fixture(t)
  const ledger = openLedger(ledgerPath)
  const alternate = openLedger(join(directory, 'alternate.json'))
  const first = sidecar(ledger, directory)
  const alias = join(directory, 'alias')
  symlinkSync(directory, alias, 'dir')
  assert.throws(() => sidecar(ledger, alias), { code: 'IDEMPOTENCY_LOCKED' })
  assert.throws(() => sidecar(alternate, join(directory, 'alias', '..', 'alias')), { code: 'IDEMPOTENCY_LOCKED' })
  const script = `
    import { openLedger } from ${JSON.stringify(new URL('../../server/paid-gateway/ledger.mjs', import.meta.url).href)};
    import { openIdempotencySidecar } from ${JSON.stringify(new URL('../../server/paid-gateway/idempotency-sidecar.mjs', import.meta.url).href)};
    const ledger = openLedger(process.argv[1]);
    try {
      openIdempotencySidecar({ ledger, directory: process.argv[2], bindingKey: Buffer.alloc(32, 0x5a) });
      process.exitCode = 1;
    } catch (e) { if (e.code !== 'IDEMPOTENCY_LOCKED') throw e; }
    finally { ledger.close(); }
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, join(directory, 'child.json'), alias], { encoding: 'utf8', timeout: 5000 })
  assert.equal(child.status, 0, child.stderr)
  const id = reserve(first)
  ledger.settle(id, { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 })
  first.close()
  const next = sidecar(alternate, alias)
  assert.throws(() => reserve(next), { code: 'IDEMPOTENCY_REPLAY' })
  assert.equal(ledger.snapshot().entries.length, 1)
  assert.equal(alternate.snapshot().entries.length, 0)
  next.close()
  alternate.close()
  ledger.close()
})

test('ledger close cannot transfer sidecar ownership; stale sidecar locks deny startup', t => {
  const { directory, ledgerPath } = fixture(t)
  let ledger = openLedger(ledgerPath)
  const first = sidecar(ledger, directory)
  ledger.close()
  ledger = openLedger(ledgerPath)
  assert.throws(() => reserve(first), { code: 'LEDGER_LEASE_REQUIRED' })
  assert.throws(() => sidecar(ledger, directory), { code: 'IDEMPOTENCY_LOCKED' })
  assert.equal(ledger.snapshot().entries.length, 0)
  first.close()
  const second = sidecar(ledger, directory)
  second.close()
  writeFileSync(join(directory, '.paid-idempotency.json.lock'), 'synthetic stale lease', { mode: 0o600 })
  assert.throws(() => sidecar(ledger, directory), { code: 'IDEMPOTENCY_LOCKED' })
  assert.equal(ledger.snapshot().entries.length, 0)
  ledger.close()
})
