import { openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PRICING, POLICY, SMOKE_POLICY, ensure, price } from './pricing.mjs'

// The canonical CLI path is shared across worktrees. Hold an exclusive process
// lease throughout the run. Crashed/stale leases are NEVER auto-recovered.
export function openLedger(path, { policy = POLICY, profile = 'production' } = {}) {
  ensure(policy === POLICY && profile === 'production' || policy === SMOKE_POLICY && profile === 'local-smoke', 'LEDGER_PROFILE')
  const version = profile === 'local-smoke' ? 2 : 1
  const parent = lstatSync(dirname(path))
  ensure(parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o077) === 0, 'LEDGER_PERMISSIONS')
  let lock
  try { lock = openSync(path + '.lock', 'wx', 0o600); fsyncSync(lock) }
  catch { throw Object.assign(new Error('LEDGER_LOCKED'), { code: 'LEDGER_LOCKED' }) }
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
      ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0, 'LEDGER_PERMISSIONS')
      state = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = { version, approval: policy.approval, pricing: PRICING, entries: [], halted: false,
        ...(version === 2 ? { profile } : {}) }
      persist()
    }
    ensure(state.version === version && state.approval === policy.approval && JSON.stringify(state.pricing) === JSON.stringify(PRICING)
      && (version === 1 || state.profile === profile) && Array.isArray(state.entries), 'LEDGER_INVALID')
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
  return Object.freeze({
    policyId: policy.id,
    reserve(inputBound, outputBound, requestHash) {
      check()
      ensure(Date.now() < PRICING.expiresAt, 'PRICING_EXPIRED')
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
  })
}
