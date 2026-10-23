import { constants, openSync, closeSync, fstatSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { dirname, join, isAbsolute } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { POLICY, STUDIO_PRICING, ensure } from './pricing.mjs'

// Only trusted server code selects an account. Features never have budgets.
export const UNIFIED_PRICING = STUDIO_PRICING
const accountPolicy = (account, maxNano, maxCalls) => Object.freeze({ ...POLICY,
  id: `UNIFIED-AI-20261023-${account}`, approval: `UNIFIED-AI-20261023-${account}`,
  stopNano: maxNano, absoluteNano: maxNano, conservativeNano: maxNano, maxCalls,
})
export const UNIFIED_CUSTOMER_POLICY = accountPolicy('customer', 20_000_000_000, null)
export const UNIFIED_TEST_POLICY = accountPolicy('agent-test', 5_000_000_000, 200)
const policies = Object.freeze({ customer: UNIFIED_CUSTOMER_POLICY, 'agent-test': UNIFIED_TEST_POLICY })
const HASH = /^[a-f0-9]{64}$/
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const integer = value => Number.isSafeInteger(value) && value >= 0
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const hash = value => createHash('sha256').update(value).digest('hex')
function validatePricing(pricing) {
  ensure(plain(pricing) && pricing.model === 'deepseek-flash'
    && pricing.inputNanoPerToken === 2000 && pricing.outputNanoPerToken === 8000
    && Number.isSafeInteger(pricing.expiresAt), 'PRICING_INVALID')
}
function checkDirectory(path, mounted) {
  const stat = lstatSync(dirname(path))
  ensure(isAbsolute(path) && realpathSync(dirname(path)) === dirname(path)
    && stat.isDirectory() && !stat.isSymbolicLink()
    && (typeof process.getuid !== 'function' || stat.uid === process.getuid())
    && ((stat.mode & 0o777) === 0o700 || mounted && (stat.mode & 0o777) === 0o777), 'LEDGER_PERMISSIONS')
}
const fileModeOk = (stat, mounted) => (stat.mode & 0o777) === 0o600
  || mounted && [0o644, 0o666, 0o777].includes(stat.mode & 0o777)
const owned = stat => typeof process.getuid !== 'function' || stat.uid === process.getuid()
function held(path) {
  try {
    const target = realpathSync(path)
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      let descriptors
      try { descriptors = readdirSync(`/proc/${pid}/fd`) }
      catch {
        // If descriptors of another same-user process cannot be inspected,
        // there is no evidence that its lease is stale: do not steal it.
        try { if (owned(lstatSync(`/proc/${pid}`))) return true } catch { /* exited */ }
        continue
      }
      for (const fd of descriptors) {
        try { if (realpathSync(`/proc/${pid}/fd/${fd}`) === target) return true } catch { /* exited */ }
      }
    }
    return false
  } catch { return true }
}
function lease(path, mounted) {
  try { const fd = openSync(path + '.lock', 'wx', 0o600); fsyncSync(fd); return fd }
  catch {
    if (mounted && !held(path + '.lock')) {
      const stat = lstatSync(path + '.lock')
      ensure(stat.isFile() && !stat.isSymbolicLink() && stat.size === 0 && stat.nlink === 1
        && owned(stat) && fileModeOk(stat, mounted), 'LEDGER_LOCKED')
      renameSync(path + '.lock', path + '.stale-' + randomUUID())
      const fd = openSync(path + '.lock', 'wx', 0o600); fsyncSync(fd); return fd
    }
    ensure(false, 'LEDGER_LOCKED')
  }
}
function durable(path, state, initialize = false) {
  const temp = join(dirname(path), '.unified-' + randomUUID())
  const fd = openSync(initialize ? path : temp, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(state) + '\n'); fsyncSync(fd) }
  finally { closeSync(fd) }
  if (!initialize) renameSync(temp, path)
  const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir) } finally { closeSync(dir) }
}

/** Explicit administrative reset into a NEW path. Runtime never creates a ledger. */
export function initializeUnifiedLedger(path, { epochId, pricing = UNIFIED_PRICING, now = Date.now, allowMountedDirectory = false } = {}) {
  ensure(typeof epochId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(epochId), 'LEDGER_EPOCH_INVALID')
  validatePricing(pricing); checkDirectory(path, allowMountedDirectory)
  const lock = lease(path, allowMountedDirectory)
  try {
    durable(path, { version: 4, epochId, initializedAt: new Date(now()).toISOString(), pricing,
      accounts: Object.fromEntries(Object.keys(policies).map(account => [account, { halted: false, entries: [] }])) }, true)
  } finally { closeSync(lock); unlinkSync(path + '.lock') }
}

/** One locked file, two accounts, unlimited persistent idempotency claims. */
export function openUnifiedLedger(path, { pricing = UNIFIED_PRICING, pricingGuard, now = Date.now, allowMountedDirectory = false } = {}) {
  validatePricing(pricing); pricing = Object.freeze({ ...pricing }); checkDirectory(path, allowMountedDirectory)
  const lock = lease(path, allowMountedDirectory)
  let state, closed = false, broken = false
  const price = (input, output) => input * pricing.inputNanoPerToken + output * pricing.outputNanoPerToken
  const charge = entry => entry.status === 'settled' ? entry.estimatedNano : entry.reserveNano
  const used = account => account.entries.reduce((total, entry) => total + charge(entry), 0)
  function validUsage(usage, entry) {
    return plain(usage) && integer(usage.prompt_tokens) && usage.prompt_tokens <= entry.inputBound
      && integer(usage.completion_tokens) && usage.completion_tokens <= entry.outputBound
      && usage.total_tokens === usage.prompt_tokens + usage.completion_tokens
  }
  try {
    const stat = lstatSync(path)
    ensure(realpathSync(path) === path && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
      && owned(stat) && fileModeOk(stat, allowMountedDirectory), 'LEDGER_PERMISSIONS')
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const actual = fstatSync(fd)
      ensure(actual.isFile() && actual.nlink === 1 && actual.ino === stat.ino && actual.dev === stat.dev
        && owned(actual) && fileModeOk(actual, allowMountedDirectory), 'LEDGER_PERMISSIONS')
      state = JSON.parse(readFileSync(fd, 'utf8'))
    } finally { closeSync(fd) }
    ensure(plain(state) && state.version === 4 && typeof state.epochId === 'string'
      && /^[a-zA-Z0-9_-]{8,128}$/.test(state.epochId) && equal(state.pricing, pricing)
      && plain(state.accounts) && equal(Object.keys(state.accounts).sort(), Object.keys(policies).sort()), 'LEDGER_INVALID')
    for (const [name, account] of Object.entries(state.accounts)) {
      const policy = policies[name], ids = new Set(), claims = new Set()
      ensure(plain(account) && typeof account.halted === 'boolean' && Array.isArray(account.entries), 'LEDGER_INVALID')
      for (const entry of account.entries) {
        ensure(plain(entry) && typeof entry.id === 'string' && !ids.has(entry.id)
          && HASH.test(entry.requestHash) && Number.isSafeInteger(entry.inputBound) && entry.inputBound > 0
          && entry.inputBound <= policy.maxInputBytes + policy.framingTokens && Number.isSafeInteger(entry.outputBound)
          && entry.outputBound > 0 && entry.outputBound <= policy.maxOutputTokens
          && entry.reserveNano === price(entry.inputBound, entry.outputBound)
          && ['reserved', 'settled', 'uncertain'].includes(entry.status), 'LEDGER_INVALID')
        ids.add(entry.id)
        if (entry.claim !== undefined) {
          ensure(plain(entry.claim) && HASH.test(entry.claim.identity) && HASH.test(entry.claim.payloadHash)
            && !claims.has(entry.claim.identity), 'LEDGER_INVALID'); claims.add(entry.claim.identity)
        }
        if (entry.status === 'settled') ensure(validUsage(entry.usage, entry)
          && entry.estimatedNano === price(entry.usage.prompt_tokens, entry.usage.completion_tokens), 'LEDGER_INVALID')
        // A crash after reservation is fully charged, never silently refunded.
        if (entry.status === 'reserved') entry.status = 'uncertain'
      }
      ensure(Number.isSafeInteger(used(account)) && used(account) <= policy.stopNano
        && (policy.maxCalls === null || account.entries.length <= policy.maxCalls), 'LEDGER_INVALID')
    }
    durable(path, state)
  } catch (error) { closeSync(lock); unlinkSync(path + '.lock'); throw error }
  const check = () => ensure(!closed && !broken, 'LEDGER_UNAVAILABLE')
  function save() { try { durable(path, state) } catch { broken = true; ensure(false, 'LEDGER_UNAVAILABLE') } }
  function accountSnapshot(name) {
    check(); const account = state.accounts[name], policy = policies[name], usedNano = used(account)
    return structuredClone({ version: 4, epochId: state.epochId, account: name, pricing, policyId: policy.id,
      halted: account.halted, entries: account.entries, calls: account.entries.length, usedNano,
      reservedNano: account.entries.reduce((sum, e) => sum + e.reserveNano, 0),
      maxCalls: policy.maxCalls, maxNano: policy.stopNano, remainingNano: policy.stopNano - usedNano,
      remainingCalls: policy.maxCalls === null ? null : policy.maxCalls - account.entries.length })
  }
  const handles = new Map()
  function forAccount(name) {
    check(); ensure(Object.hasOwn(policies, name), 'BUDGET_ACCOUNT_INVALID')
    if (handles.has(name)) return handles.get(name)
    const account = state.accounts[name], policy = policies[name]
    function reserve(inputBound, outputBound, requestHash, claim) {
      check(); if (pricingGuard) pricingGuard(); else ensure(now() < pricing.expiresAt, 'PRICING_EXPIRED')
      ensure(!account.halted, 'BUDGET_HALTED')
      ensure(Number.isSafeInteger(inputBound) && inputBound > 0 && inputBound <= policy.maxInputBytes + policy.framingTokens
        && Number.isSafeInteger(outputBound) && outputBound > 0 && outputBound <= policy.maxOutputTokens && HASH.test(requestHash), 'RESERVATION_INVALID')
      if (claim) checkClaim(claim)
      const reserveNano = price(inputBound, outputBound)
      ensure((policy.maxCalls === null || account.entries.length < policy.maxCalls)
        && used(account) + reserveNano <= policy.stopNano, 'BUDGET_EXHAUSTED')
      const entry = { id: randomUUID(), at: new Date(now()).toISOString(), requestHash, inputBound, outputBound,
        reserveNano, status: 'reserved', ...(claim ? { claim } : {}) }
      account.entries.push(entry); save(); return entry.id
    }
    function checkClaim(claim) {
      check(); const previous = account.entries.find(e => e.claim?.identity === claim.identity)
      ensure(!previous || previous.claim.payloadHash === claim.payloadHash, 'IDEMPOTENCY_CONFLICT')
      ensure(!previous, 'IDEMPOTENCY_REPLAY')
    }
    const ledger = Object.freeze({ policyId: policy.id, policy,
      reserve,
      settle(id, usage) {
        check(); const entry = account.entries.find(e => e.id === id)
        ensure(entry?.status === 'reserved', 'LEDGER_INVALID')
        if (!validUsage(usage, entry)) {
          entry.status = 'uncertain';
          // Missing usage is an unknown charge covered by the reservation.
          // A provider claiming inconsistent/excess usage invalidates bounds.
          if (usage !== undefined && usage !== null) account.halted = true;
          save(); ensure(false, 'USAGE_UNRELIABLE')
        }
        entry.status = 'settled'; entry.usage = { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens }
        entry.estimatedNano = price(usage.prompt_tokens, usage.completion_tokens); save()
      },
      uncertain(id) {
        check(); const entry = account.entries.find(e => e.id === id)
        if (entry?.status === 'reserved') { entry.status = 'uncertain'; save() }
      },
      snapshot: () => accountSnapshot(name),
      reservationStore({ principal, key, payloadHash } = {}) {
        ensure(typeof principal === 'string' && principal.length > 0 && principal.length <= 256
          && typeof key === 'string' && key.length > 0 && key.length <= 256 && HASH.test(payloadHash), 'IDEMPOTENCY_INVALID')
        // Only hashes are persisted. No prompts, records, identifiers or credentials.
        const claim = Object.freeze({ identity: hash(JSON.stringify([principal, key])), payloadHash })
        return Object.freeze({ check: () => checkClaim(claim), reserve: (_body, input, output, requestHash) => reserve(input, output, requestHash, claim) })
      },
    })
    handles.set(name, ledger); return ledger
  }
  return Object.freeze({ forAccount,
    snapshot() { check(); return { version: 4, epochId: state.epochId, accounts: Object.fromEntries(Object.keys(policies).map(name => [name, accountSnapshot(name)])) } },
    close() { if (closed) return; closed = true; closeSync(lock); if (!broken) unlinkSync(path + '.lock') },
  })
}
