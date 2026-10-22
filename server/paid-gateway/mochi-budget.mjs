import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertLedgerLease } from './ledger.mjs'
import { ensure, STUDIO_MVP_POLICY } from './pricing.mjs'

const MAX_CALLS = 100
const MAX_NANO = 5_000_000_000
const SEED_CALLS = 8
const SEED_NANO = 280_314_000
const STORE = '.mochi-budget-v1'
const ANCHOR = '.mochi-budget-anchor-v1-'
const VERSION = 1
const HASH = /^[a-f0-9]{64}$/
const fail = code => { throw Object.assign(new Error(code), { code }) }
const keysAre = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())

// A subordinate, conservative reservation ledger. It never settles or refunds:
// the original eight sampling calls remain charged at their reserved ceiling.
// The primary paid ledger still independently controls every network request.
export function openMochiBudget({ ledger, directory, bindingKey, allowMountedDirectory = false, pricingGuard } = {}) {
  const PRICING = ledger?.snapshot?.().pricing
  const price = (input, output) => input * PRICING.inputNanoPerToken + output * PRICING.outputNanoPerToken
  const root = realpathSync(resolve(directory ?? ''))
  assertLedgerLease(ledger, root)
  ensure(Buffer.isBuffer(bindingKey) && bindingKey.length >= 32, 'MOCHI_BUDGET_KEY_REQUIRED')
  const key = Buffer.from(bindingKey)
  const parent = lstatSync(root)
  ensure(parent.isDirectory() && !parent.isSymbolicLink()
    && ((parent.mode & 0o077) === 0 || allowMountedDirectory && (parent.mode & 0o777) === 0o777), 'MOCHI_BUDGET_PERMISSIONS')
  const path = join(root, STORE)
  let broken = false
  const sign = payload => createHmac('sha256', key).update('blockcraft-mochi-budget-v1\0').update(JSON.stringify(payload)).digest('hex')
  const manifest = { version: VERSION, seedCalls: SEED_CALLS, seedNano: SEED_NANO, maxCalls: MAX_CALLS, maxNano: MAX_NANO, pricingExpiresAt: PRICING.expiresAt, inputNanoPerToken: PRICING.inputNanoPerToken, outputNanoPerToken: PRICING.outputNanoPerToken }

  function privateStat(stat, isDirectory = false) {
    ensure((isDirectory ? stat.isDirectory() : stat.isFile()) && !stat.isSymbolicLink()
      && (isDirectory || stat.nlink === 1) && ((stat.mode & 0o077) === 0 || allowMountedDirectory
        && (isDirectory ? (stat.mode & 0o777) === 0o777 : [0o644, 0o666, 0o777].includes(stat.mode & 0o777)))
      && (typeof process.getuid !== 'function' || stat.uid === process.getuid()), 'MOCHI_BUDGET_PERMISSIONS')
  }
  function checkDirectory() { privateStat(lstatSync(path), true) }
  function read(name, directory = path) {
    const filename = join(directory, name)
    privateStat(lstatSync(filename))
    const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(fd)
      privateStat(stat)
      ensure(stat.size > 0 && stat.size <= 4096, 'MOCHI_BUDGET_INVALID')
      const record = JSON.parse(readFileSync(fd, 'utf8'))
      ensure(keysAre(record, ['payload', 'mac']) && typeof record.mac === 'string' && HASH.test(record.mac), 'MOCHI_BUDGET_INVALID')
      ensure(timingSafeEqual(Buffer.from(record.mac, 'hex'), Buffer.from(sign(record.payload), 'hex')), 'MOCHI_BUDGET_INVALID')
      return record.payload
    } finally { closeSync(fd) }
  }
  function append(name, payload, directory = path) {
    // O_EXCL prevents replacement/reuse. A killed or failed partial write stays
    // visible and invalid, so startup cannot silently reset the allowance.
    const fd = openSync(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { writeFileSync(fd, JSON.stringify({ payload, mac: sign(payload) }) + '\n'); fsyncSync(fd) }
    finally { closeSync(fd) }
    const dirFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
  }
  function load() {
    checkDirectory()
    const names = readdirSync(path).sort()
    ensure(names.length >= 1 && names.length <= MAX_CALLS - SEED_CALLS + 1 && names.includes('manifest.json'), 'MOCHI_BUDGET_INVALID')
    // The duplicate receipts detect single-copy damage. The primary ledger's
    // independent high-water mark also detects paired deletion or lost stores.
    // None of these copies silently repairs or initializes another one.
    const anchors = readdirSync(root).filter(name => name.startsWith(ANCHOR)).sort()
    const expected = names.map(name => ANCHOR + name).sort()
    ensure(JSON.stringify(anchors) === JSON.stringify(expected), 'MOCHI_BUDGET_INVALID')
    for (const name of names) ensure(JSON.stringify(read(name)) === JSON.stringify(read(ANCHOR + name, root)), 'MOCHI_BUDGET_INVALID')
    const persisted = read('manifest.json')
    ensure(JSON.stringify(persisted) === JSON.stringify(manifest), 'MOCHI_BUDGET_INVALID')
    const receipts = names.filter(name => name !== 'manifest.json')
    let reservedNano = SEED_NANO
    for (let index = 0; index < receipts.length; index++) {
      ensure(receipts[index] === `${String(index + 1).padStart(3, '0')}.json`, 'MOCHI_BUDGET_INVALID')
      const entry = read(receipts[index])
      ensure(keysAre(entry, ['version', 'sequence', 'id', 'inputBound', 'outputBound', 'reserveNano', 'requestHash'])
        && entry.version === VERSION && entry.sequence === index + 1
        && typeof entry.id === 'string' && /^[a-f0-9-]{36}$/.test(entry.id)
        && typeof entry.requestHash === 'string' && HASH.test(entry.requestHash), 'MOCHI_BUDGET_INVALID')
      validateBounds(entry.inputBound, entry.outputBound)
      ensure(entry.reserveNano === price(entry.inputBound, entry.outputBound), 'MOCHI_BUDGET_INVALID')
      reservedNano += entry.reserveNano
      ensure(Number.isSafeInteger(reservedNano) && reservedNano <= MAX_NANO, 'MOCHI_BUDGET_INVALID')
    }
    const calls = SEED_CALLS + receipts.length
    const checkpoint = ledger.mochiBudgetSnapshot()
    ensure(checkpoint?.version === VERSION && checkpoint.sequence === receipts.length
      && checkpoint.calls === calls && checkpoint.reservedNano === reservedNano, 'MOCHI_BUDGET_INVALID')
    return { calls, reservedNano }
  }
  function validateBounds(inputBound, outputBound) {
    ensure(Number.isSafeInteger(inputBound) && inputBound > 0 && inputBound <= STUDIO_MVP_POLICY.maxInputBytes + STUDIO_MVP_POLICY.framingTokens
      && Number.isSafeInteger(outputBound) && outputBound > 0 && outputBound <= STUDIO_MVP_POLICY.maxOutputTokens, 'MOCHI_BUDGET_RESERVATION_INVALID')
  }
  function guarded(operation) {
    ensure(!broken, 'MOCHI_BUDGET_UNAVAILABLE')
    assertLedgerLease(ledger, root)
    try { return operation() } catch (error) {
      if (error.code === 'MOCHI_BUDGET_EXHAUSTED' || error.code === 'PRICING_EXPIRED' || error.code === 'PRICING_UNVERIFIED' || error.code === 'MOCHI_BUDGET_RESERVATION_INVALID') throw error
      broken = true
      if (error.code?.startsWith('MOCHI_BUDGET_')) throw error
      fail('MOCHI_BUDGET_UNAVAILABLE')
    }
  }
  guarded(() => {
    let missing = false
    try { lstatSync(path) } catch (error) { if (error.code !== 'ENOENT') throw error; missing = true }
    if (missing) {
      ensure(ledger.mochiBudgetSnapshot() === null
        && !readdirSync(root).some(name => name.startsWith(ANCHOR)), 'MOCHI_BUDGET_INVALID')
      // Mark initialization in the existing primary ledger before creating any
      // subordinate copy. Even simultaneous loss of both copies cannot reset it.
      ledger.advanceMochiBudgetCheckpoint({ version: VERSION, sequence: 0, calls: SEED_CALLS, reservedNano: SEED_NANO })
      append(ANCHOR + 'manifest.json', manifest, root)
      mkdirSync(path, { mode: 0o700 })
      append('manifest.json', manifest)
      const rootFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      try { fsyncSync(rootFd) } finally { closeSync(rootFd) }
    }
    load()
  })

  return Object.freeze({
    reserve(inputBound, outputBound, requestHash) {
      return guarded(() => {
        pricingGuard ? pricingGuard() : ensure(Date.now() < PRICING.expiresAt, 'PRICING_EXPIRED')
        validateBounds(inputBound, outputBound)
        ensure(typeof requestHash === 'string' && HASH.test(requestHash), 'MOCHI_BUDGET_RESERVATION_INVALID')
        const state = load(), reserveNano = price(inputBound, outputBound)
        ensure(state.calls < MAX_CALLS && state.reservedNano + reserveNano <= MAX_NANO, 'MOCHI_BUDGET_EXHAUSTED')
        const sequence = state.calls - SEED_CALLS + 1, id = randomUUID()
        const name = `${String(sequence).padStart(3, '0')}.json`
        const receipt = { version: VERSION, sequence, id, inputBound, outputBound, reserveNano, requestHash }
        ledger.advanceMochiBudgetCheckpoint({ version: VERSION, sequence, calls: state.calls + 1,
          reservedNano: state.reservedNano + reserveNano })
        append(ANCHOR + name, receipt, root)
        append(name, receipt)
        return id
      })
    },
    snapshot() {
      return guarded(() => {
        pricingGuard ? pricingGuard() : ensure(Date.now() < PRICING.expiresAt, 'PRICING_EXPIRED')
        const state = load()
        return { ...state, maxCalls: MAX_CALLS, maxNano: MAX_NANO, seedCalls: SEED_CALLS, seedNano: SEED_NANO,
          remainingCalls: MAX_CALLS - state.calls, remainingNano: MAX_NANO - state.reservedNano, pricingExpiresAt: PRICING.expiresAt }
      })
    },
  })
}
