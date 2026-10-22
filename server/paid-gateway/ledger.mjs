import { openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PRICING, STUDIO_PRICING, POLICY, SMOKE_POLICY, STUDIO_MVP_POLICY, ensure } from './pricing.mjs'

const openLedgerDirectories = new WeakMap()
const MOCHI_SEED_CALLS = 8
const MOCHI_SEED_NANO = 280_314_000
const MOCHI_MAX_CALLS = 100
const MOCHI_MAX_NANO = 5_000_000_000

function validateMochiCheckpoint(value) {
  ensure(value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(['calls', 'reservedNano', 'sequence', 'version'])
    && value.version === 1 && Number.isSafeInteger(value.sequence)
    && value.sequence >= 0 && value.sequence <= MOCHI_MAX_CALLS - MOCHI_SEED_CALLS
    && value.calls === MOCHI_SEED_CALLS + value.sequence
    && Number.isSafeInteger(value.reservedNano) && value.reservedNano <= MOCHI_MAX_NANO
    && (value.sequence === 0 ? value.reservedNano === MOCHI_SEED_NANO : value.reservedNano > MOCHI_SEED_NANO),
  'MOCHI_BUDGET_CHECKPOINT_INVALID')
}

function validateStudioCheckpoint(v) {
  const legacy = v && Object.hasOwn(v, 'legacyDebtHash')
  ensure(v && typeof v === 'object' && !Array.isArray(v)
    && JSON.stringify(Object.keys(v).sort()) === JSON.stringify(['calls', 'reservedNano', 'seedCalls', 'seedLedgerCalls', 'seedLedgerHash', 'seedNano', 'sequence', 'version', ...(legacy ? ['legacyDebtHash'] : [])].sort())
    && (!legacy || typeof v.legacyDebtHash === 'string' && /^[a-f0-9]{64}$/.test(v.legacyDebtHash))
    && v.version === 1 && Number.isSafeInteger(v.sequence) && v.sequence >= 0
    && Number.isSafeInteger(v.seedLedgerCalls) && v.seedLedgerCalls >= 0
    && v.seedCalls === v.seedLedgerCalls + 8 + (legacy ? 1 : 0) && v.calls === v.seedCalls + v.sequence
    && Number.isSafeInteger(v.calls) && v.calls >= 8 && v.calls <= 100
    && Number.isSafeInteger(v.seedNano) && v.seedNano >= 280_314_000 + (legacy ? 212_992_000 : 0)
    && Number.isSafeInteger(v.reservedNano) && v.reservedNano >= v.seedNano && v.reservedNano <= 5_000_000_000
    && (v.sequence === 0 ? v.reservedNano === v.seedNano : v.reservedNano > v.seedNano)
    && typeof v.seedLedgerHash === 'string' && /^[a-f0-9]{64}$/.test(v.seedLedgerHash), 'STUDIO_BUDGET_CHECKPOINT_INVALID')
}

// ModelScope keeps /mnt/workspace across container replacement. A process
// killed during a deployment can leave the old empty lease file behind even
// though no process still owns its descriptor. Recover only this exact stale
// case when the mounted-directory compatibility mode is explicitly enabled;
// an actively held lease still fails closed.
function lockIsHeld(path) {
  try {
    const target = realpathSync(path)
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      let fds
      try { fds = readdirSync(`/proc/${pid}/fd`) } catch { continue }
      for (const fd of fds) {
        try {
          if (realpathSync(`/proc/${pid}/fd/${fd}`) === target) return true
        } catch { /* process may exit while scanning */ }
      }
    }
    return false
  } catch { return true }
}

export function assertLedgerLease(ledger, directory) {
  const lease = openLedgerDirectories.get(ledger)
  ensure(lease && lease.isOpen(), 'LEDGER_LEASE_REQUIRED')
  ensure(lease.directory === realpathSync(directory), 'SIDECAR_DIRECTORY_MISMATCH')
}

// The canonical CLI path is shared across worktrees. Hold an exclusive process
// lease throughout the run. Crashed/stale leases are NEVER auto-recovered.
export function openLedger(path, { pricing, policy = POLICY, profile = 'production', now = Date.now, allowMountedDirectory = false, pricingGuard } = {}) {
  ensure(profile === 'production' || policy === SMOKE_POLICY && profile === 'local-smoke' || policy === STUDIO_MVP_POLICY && profile === 'studio-mvp', 'LEDGER_PROFILE')
  pricing ??= profile === 'production' ? PRICING : STUDIO_PRICING
  pricing = Object.freeze({ ...pricing }); policy = Object.freeze({ ...policy })
  ensure(typeof pricing.model === 'string' && Number.isSafeInteger(pricing.expiresAt)
    && Number.isSafeInteger(pricing.inputNanoPerToken) && pricing.inputNanoPerToken > 0
    && Number.isSafeInteger(pricing.outputNanoPerToken) && pricing.outputNanoPerToken > 0, 'PRICING_INVALID')
  ensure(typeof policy.approval === 'string' && policy.approval.length > 0
    && ['stopNano', 'absoluteNano', 'conservativeNano'].every(k => Number.isSafeInteger(policy[k]) && policy[k] > 0 && (profile !== 'production' || policy[k] <= 5_000_000_000))
    && Number.isSafeInteger(policy.maxCalls) && policy.maxCalls > 0 && (profile !== 'production' || policy.maxCalls <= 100)
    && ['maxInputBytes', 'framingTokens', 'maxOutputTokens', 'maxResponseBytes', 'timeoutMs'].every(k => Number.isSafeInteger(policy[k]) && policy[k] > 0 && policy[k] <= POLICY[k]), 'POLICY_INVALID')
  const price = (prompt, completion) => prompt * pricing.inputNanoPerToken + completion * pricing.outputNanoPerToken

  const version = profile === 'studio-mvp' ? 3 : profile === 'local-smoke' ? 2 : 1
  const parent = lstatSync(dirname(path))
  const mountedMode = mode => allowMountedDirectory && (mode & 0o777) === 0o777
  ensure(parent.isDirectory() && !parent.isSymbolicLink() && ((parent.mode & 0o077) === 0 || mountedMode(parent.mode)), 'LEDGER_PERMISSIONS')
  let lock
  try { lock = openSync(path + '.lock', 'wx', 0o600); fsyncSync(lock) }
  catch {
    if (allowMountedDirectory && !lockIsHeld(path + '.lock')) {
      const stale = `${path}.stale-${randomUUID()}`
      try { renameSync(path + '.lock', stale); lock = openSync(path + '.lock', 'wx', 0o600); fsyncSync(lock) }
      catch { throw Object.assign(new Error('LEDGER_LOCKED'), { code: 'LEDGER_LOCKED' }) }
    } else throw Object.assign(new Error('LEDGER_LOCKED'), { code: 'LEDGER_LOCKED' })
  }
  let state, closed = false, broken = false
  function persist() {
    const temp = join(dirname(path), '.ledger-' + randomUUID())
    const fd = openSync(temp, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify(state) + '\n'); fsyncSync(fd) }
    finally { closeSync(fd) }
    renameSync(temp, path)
    const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir) } finally { closeSync(dir) }
  }
  try {
    try {
      const stat = lstatSync(path)
      ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && ((stat.mode & 0o077) === 0 || mountedMode(stat.mode)), 'LEDGER_PERMISSIONS')
      state = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = { version, approval: policy.approval, pricing, entries: [], halted: false,
        ...(version !== 1 ? { profile } : {}) }
      persist()
    }
    ensure(state.version === version && state.approval === policy.approval && JSON.stringify(state.pricing) === JSON.stringify(pricing)
      && (version === 1 || state.profile === profile) && Array.isArray(state.entries), 'LEDGER_INVALID')
    if (Object.hasOwn(state, 'studioBudgetCheckpoint')) validateStudioCheckpoint(state.studioBudgetCheckpoint)
    if (Object.hasOwn(state, 'mochiBudgetCheckpoint')) validateMochiCheckpoint(state.mochiBudgetCheckpoint)
    let total = 0
    for (const entry of state.entries) {
      ensure(typeof entry.id === 'string' && Number.isSafeInteger(entry.reserveNano) && entry.reserveNano > 0 && Number.isSafeInteger(entry.inputBound) && Number.isSafeInteger(entry.outputBound), 'LEDGER_INVALID')
      ensure(entry.reserveNano === price(entry.inputBound, entry.outputBound), 'LEDGER_INVALID')
      ensure(['reserved', 'settled', 'uncertain'].includes(entry.status), 'LEDGER_INVALID')
      if (entry.status === 'settled') ensure(Number.isSafeInteger(entry.estimatedNano) && entry.estimatedNano >= 0 && entry.estimatedNano <= entry.reserveNano, 'LEDGER_INVALID')
      total += entry.reserveNano
    }
    ensure(Number.isSafeInteger(total) && total <= policy.conservativeNano && state.entries.length <= policy.maxCalls, 'LEDGER_INVALID')
    if (state.entries.some(entry => entry.status !== 'settled')) state.halted = true
    persist()
  } catch (error) { closeSync(lock); unlinkSync(path + '.lock'); throw error }
  const check = () => { ensure(!closed && !broken, 'LEDGER_UNAVAILABLE') }
  function save() { try { persist() } catch { broken = true; throw Object.assign(new Error('LEDGER_UNAVAILABLE'), { code: 'LEDGER_UNAVAILABLE' }) } }
  const ledger = {
    policyId: policy.id ?? policy.approval,
    studioBudgetSnapshot() { check(); return structuredClone(state.studioBudgetCheckpoint ?? null) },
    advanceStudioBudgetCheckpoint(next) {
      check(); validateStudioCheckpoint(next)
      const previous = state.studioBudgetCheckpoint
      ensure(previous ? next.sequence === previous.sequence + 1 && next.calls === previous.calls + 1
        && next.reservedNano > previous.reservedNano && next.seedCalls === previous.seedCalls
        && next.seedNano === previous.seedNano && next.seedLedgerCalls === previous.seedLedgerCalls
        && next.seedLedgerHash === previous.seedLedgerHash && next.legacyDebtHash === previous.legacyDebtHash : next.sequence === 0, 'STUDIO_BUDGET_CHECKPOINT_INVALID')
      state.studioBudgetCheckpoint = structuredClone(next); save()
    },
    mochiBudgetSnapshot() { check(); return structuredClone(state.mochiBudgetCheckpoint ?? null) },
    advanceMochiBudgetCheckpoint(next) {
      check()
      validateMochiCheckpoint(next)
      const previous = state.mochiBudgetCheckpoint
      ensure(previous ? next.sequence === previous.sequence + 1 && next.reservedNano > previous.reservedNano
        : next.sequence === 0, 'MOCHI_BUDGET_CHECKPOINT_INVALID')
      state.mochiBudgetCheckpoint = structuredClone(next)
      // Commit the independent high-water mark before subordinate receipts.
      // A partial reservation closes Mochi after restart instead of refunding it.
      save()
    },
    reserve(inputBound, outputBound, requestHash) {
      check()
      if (pricingGuard) pricingGuard(); else ensure(now() < pricing.expiresAt, 'PRICING_EXPIRED')
      ensure(!state.halted && !state.entries.some(e => e.status !== 'settled'), 'BUDGET_HALTED')
      ensure(Number.isSafeInteger(inputBound) && inputBound > 0 && inputBound <= policy.maxInputBytes + policy.framingTokens && Number.isSafeInteger(outputBound) && outputBound > 0 && outputBound <= policy.maxOutputTokens, 'RESERVATION_INVALID')
      const reserveNano = price(inputBound, outputBound), used = state.entries.reduce((sum, e) => sum + e.reserveNano, 0)
      ensure(state.entries.length < policy.maxCalls && used + reserveNano <= Math.min(policy.stopNano, policy.absoluteNano, policy.conservativeNano), 'BUDGET_EXHAUSTED')
      const entry = { id: randomUUID(), at: new Date().toISOString(), requestHash, inputBound, outputBound, reserveNano, status: 'reserved' }
      state.entries.push(entry); save() // Durable reservation BEFORE network; never refunded.
      return entry.id
    },
    settle(id, usage) {
      check(); const entry = state.entries.find(e => e.id === id)
      ensure(entry?.status === 'reserved', 'LEDGER_INVALID')
      const prompt = usage?.prompt_tokens, completion = usage?.completion_tokens
      const valid = Number.isSafeInteger(prompt) && prompt >= 0 && prompt <= entry.inputBound
        && Number.isSafeInteger(completion) && completion >= 0 && completion <= entry.outputBound
        && usage.total_tokens === prompt + completion
      if (!valid) { entry.status = 'uncertain'; state.halted = true; save(); ensure(false, 'USAGE_UNRELIABLE') }
      entry.status = 'settled'; entry.usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
      entry.estimatedNano = price(prompt, completion); save()
    },
    uncertain(id) { check(); const entry = state.entries.find(e => e.id === id); if (entry?.status === 'reserved') { entry.status = 'uncertain'; state.halted = true; save() } },
    snapshot() { check(); return structuredClone(state) },
    close() { if (closed) return; closed = true; closeSync(lock); if (!broken) unlinkSync(path + '.lock') },
  }
  openLedgerDirectories.set(ledger, { directory: realpathSync(dirname(path)), isOpen: () => !closed && !broken })
  return Object.freeze(ledger)
}
