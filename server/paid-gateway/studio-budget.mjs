import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertLedgerLease } from './ledger.mjs'
import { ensure, STUDIO_PRICING as PRICING, STUDIO_MVP_POLICY, STUDIO_AUTHORIZATION } from './pricing.mjs'

const PREFIX = '.studio-cumulative-v1-'
const price = (prompt, completion) => prompt * PRICING.inputNanoPerToken + completion * PRICING.outputNanoPerToken
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const signable = value => JSON.stringify(value)

// A single allowance for every Studio provider protocol. Existing ledger
// entries remain untouched. Legacy settled costs are verified and retained;
// new requests are charged their complete conservative ceiling, never refunded.
export function openStudioBudget({ ledger, directory, bindingKey, pricingGuard, allowMountedDirectory = false, historicalDebit } = {}) {
  ensure(historicalDebit === undefined || historicalDebit && Object.keys(historicalDebit).length === 3
    && historicalDebit.calls === 1 && historicalDebit.nano === 212_992_000
    && typeof historicalDebit.evidenceHash === 'string' && /^[a-f0-9]{64}$/.test(historicalDebit.evidenceHash), 'STUDIO_BUDGET_HISTORY_UNVERIFIED')
  const debtFields = historicalDebit ? { legacyDebtHash: historicalDebit.evidenceHash } : {}
  const root = realpathSync(resolve(directory ?? ''))
  assertLedgerLease(ledger, root)
  ensure(Buffer.isBuffer(bindingKey) && bindingKey.length >= 32, 'STUDIO_BUDGET_KEY_REQUIRED')
  const key = Buffer.from(bindingKey)
  const parent = lstatSync(root)
  ensure(parent.isDirectory() && !parent.isSymbolicLink()
    && ((parent.mode & 0o077) === 0 || allowMountedDirectory && (parent.mode & 0o777) === 0o777)
    && (typeof process.getuid !== 'function' || parent.uid === process.getuid()), 'STUDIO_BUDGET_INVALID')
  const fileMode = stat => (stat.mode & 0o077) === 0 || allowMountedDirectory && [0o644, 0o666, 0o777].includes(stat.mode & 0o777)
  const mac = payload => createHmac('sha256', key).update('blockcraft-studio-cumulative-v1\0').update(signable(payload)).digest('hex')
  let broken = false
  const filename = (name, copy) => join(root, PREFIX + copy + '-' + name + '.json')
  function read(name, copy) {
    const path = filename(name, copy), stat = lstatSync(path)
    ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && fileMode(stat), 'STUDIO_BUDGET_INVALID')
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const s = fstatSync(fd)
      ensure(s.isFile() && s.nlink === 1 && fileMode(s) && s.size > 0 && s.size <= 4096
        && (typeof process.getuid !== 'function' || s.uid === process.getuid()), 'STUDIO_BUDGET_INVALID')
      const record = JSON.parse(readFileSync(fd, 'utf8'))
      ensure(record && Object.keys(record).length === 2 && typeof record.mac === 'string' && /^[a-f0-9]{64}$/.test(record.mac), 'STUDIO_BUDGET_INVALID')
      ensure(timingSafeEqual(Buffer.from(record.mac, 'hex'), Buffer.from(mac(record.payload), 'hex')), 'STUDIO_BUDGET_INVALID')
      return record.payload
    } finally { closeSync(fd) }
  }
  function append(name, payload) {
    for (const copy of ['anchor', 'receipt']) {
      const fd = openSync(filename(name, copy), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try { writeFileSync(fd, JSON.stringify({ payload, mac: mac(payload) }) + '\n'); fsyncSync(fd) }
      finally { closeSync(fd) }
      const parent = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      try { fsyncSync(parent) } finally { closeSync(parent) }
    }
  }
  function guarded(fn) {
    ensure(!broken, 'STUDIO_BUDGET_UNAVAILABLE'); assertLedgerLease(ledger, root)
    try { return fn() } catch (error) {
      if (['STUDIO_BUDGET_EXHAUSTED', 'PRICING_UNVERIFIED', 'PRICING_EXPIRED', 'STUDIO_BUDGET_RESERVATION_INVALID'].includes(error.code)) throw error
      broken = true
      if (error.code?.startsWith('STUDIO_BUDGET_')) throw error
      throw Object.assign(new Error('STUDIO_BUDGET_INVALID'), { code: 'STUDIO_BUDGET_INVALID' })
    }
  }
  function load() {
    const checkpoint = ledger.studioBudgetSnapshot()
    ensure(checkpoint, 'STUDIO_BUDGET_INVALID')
    ensure(checkpoint.legacyDebtHash === historicalDebit?.evidenceHash, 'STUDIO_BUDGET_HISTORY_UNVERIFIED')
    const expected = ['manifest', ...Array.from({ length: checkpoint.sequence }, (_, i) => String(i + 1).padStart(3, '0'))]
      .flatMap(name => ['anchor', 'receipt'].map(copy => PREFIX + copy + '-' + name + '.json')).sort()
    ensure(JSON.stringify(readdirSync(root).filter(n => n.startsWith(PREFIX)).sort()) === JSON.stringify(expected), 'STUDIO_BUDGET_INVALID')
    const manifest = read('manifest', 'anchor')
    ensure(JSON.stringify(manifest) === JSON.stringify(read('manifest', 'receipt'))
      && JSON.stringify(manifest) === JSON.stringify({ version: 1, authorization: STUDIO_AUTHORIZATION.id,
        seedCalls: checkpoint.seedCalls, seedNano: checkpoint.seedNano, seedLedgerCalls: checkpoint.seedLedgerCalls, seedLedgerHash: checkpoint.seedLedgerHash, ...debtFields,
        maxCalls: 100, maxNano: 5_000_000_000, inputNanoPerToken: PRICING.inputNanoPerToken, outputNanoPerToken: PRICING.outputNanoPerToken }), 'STUDIO_BUDGET_INVALID')
    const entries = ledger.snapshot().entries
    ensure(entries.length === checkpoint.seedLedgerCalls + checkpoint.sequence
      && hash(entries.slice(0, checkpoint.seedLedgerCalls)) === checkpoint.seedLedgerHash, 'STUDIO_BUDGET_INVALID')
    let total = checkpoint.seedNano
    for (let i = 1; i <= checkpoint.sequence; i++) {
      const name = String(i).padStart(3, '0'), receipt = read(name, 'anchor'), entry = entries[checkpoint.seedLedgerCalls + i - 1]
      ensure(JSON.stringify(receipt) === JSON.stringify(read(name, 'receipt'))
        && Object.keys(receipt).length === 5 && receipt.sequence === i && receipt.requestHash === entry.requestHash
        && receipt.inputBound === entry.inputBound && receipt.outputBound === entry.outputBound
        && receipt.reserveNano === price(entry.inputBound, entry.outputBound), 'STUDIO_BUDGET_INVALID')
      total += receipt.reserveNano
    }
    ensure(total === checkpoint.reservedNano, 'STUDIO_BUDGET_INVALID')
    return checkpoint
  }
  guarded(() => {
    if (!ledger.studioBudgetSnapshot()) {
      ensure(!readdirSync(root).some(n => n.startsWith(PREFIX)), 'STUDIO_BUDGET_INVALID')
      const state = ledger.snapshot()
      ensure(!state.halted && state.entries.every(e => e.status === 'settled' && e.usage
        && e.estimatedNano === price(e.usage.prompt_tokens, e.usage.completion_tokens)
        && e.usage.total_tokens === e.usage.prompt_tokens + e.usage.completion_tokens
        && Number.isSafeInteger(e.usage.prompt_tokens) && e.usage.prompt_tokens >= 0 && e.usage.prompt_tokens <= e.inputBound
        && Number.isSafeInteger(e.usage.completion_tokens) && e.usage.completion_tokens >= 0 && e.usage.completion_tokens <= e.outputBound), 'STUDIO_BUDGET_HISTORY_UNVERIFIED')
      const seedCalls = state.entries.length + STUDIO_AUTHORIZATION.knownHistoricalCalls + (historicalDebit?.calls ?? 0)
      const seedNano = state.entries.reduce((n, e) => n + e.estimatedNano, STUDIO_AUTHORIZATION.knownHistoricalNano + (historicalDebit?.nano ?? 0))
      ensure(seedCalls <= 100 && seedNano <= 5_000_000_000, 'STUDIO_BUDGET_EXHAUSTED')
      const checkpoint = { version: 1, sequence: 0, calls: seedCalls, reservedNano: seedNano,
        seedCalls, seedNano, seedLedgerCalls: state.entries.length, seedLedgerHash: hash(state.entries), ...debtFields }
      ledger.advanceStudioBudgetCheckpoint(checkpoint)
      append('manifest', { version: 1, authorization: STUDIO_AUTHORIZATION.id,
        seedCalls, seedNano, seedLedgerCalls: state.entries.length, seedLedgerHash: checkpoint.seedLedgerHash, ...debtFields,
        maxCalls: 100, maxNano: 5_000_000_000, inputNanoPerToken: PRICING.inputNanoPerToken, outputNanoPerToken: PRICING.outputNanoPerToken })
    }
    load()
  })
  return Object.freeze({
    snapshot() { return guarded(() => { const s = load(); return { ...s, maxCalls: 100, maxNano: 5_000_000_000, remainingCalls: 100 - s.calls, remainingNano: 5_000_000_000 - s.reservedNano } }) },
    reserve(inputBound, outputBound, requestHash) {
      return guarded(() => {
        pricingGuard?.()
        ensure(Number.isSafeInteger(inputBound) && inputBound > 0 && inputBound <= STUDIO_MVP_POLICY.maxInputBytes + STUDIO_MVP_POLICY.framingTokens
          && Number.isSafeInteger(outputBound) && outputBound > 0 && outputBound <= STUDIO_MVP_POLICY.maxOutputTokens
          && typeof requestHash === 'string' && /^[a-f0-9]{64}$/.test(requestHash), 'STUDIO_BUDGET_RESERVATION_INVALID')
        const s = load(), reserveNano = price(inputBound, outputBound)
        ensure(s.calls < 100 && s.reservedNano + reserveNano <= 5_000_000_000, 'STUDIO_BUDGET_EXHAUSTED')
        const sequence = s.sequence + 1
        ledger.advanceStudioBudgetCheckpoint({ ...s, sequence, calls: s.calls + 1, reservedNano: s.reservedNano + reserveNano })
        append(String(sequence).padStart(3, '0'), { sequence, inputBound, outputBound, reserveNano, requestHash })
      })
    },
  })
}
