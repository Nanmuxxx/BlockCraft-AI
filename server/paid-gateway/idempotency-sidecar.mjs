import { createHmac, createHash } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertLedgerLease } from './ledger.mjs'
import { ensure } from './pricing.mjs'

const VERSION = 1
const DEFAULT_MAX_CLAIMS = 1000

function failClosed(code = 'IDEMPOTENCY_UNAVAILABLE') {
  throw Object.assign(new Error(code), { code })
}

function tag(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

function writeAtomic(path, value) {
  const directory = dirname(path)
  const temp = join(directory, '.idempotency-' + randomUUID())
  const fd = openSync(temp, 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(value) + '\n')
    fsyncSync(fd)
  } finally { closeSync(fd) }
  try {
    renameSync(temp, path)
    const dirFd = openSync(directory, 'r')
    try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
  } catch (error) {
    try { unlinkSync(temp) } catch {}
    throw error
  }
}

function validateState(state, maxClaims) {
  ensure(state?.version === VERSION && typeof state.keyCheck === 'string' && /^[a-f0-9]{64}$/.test(state.keyCheck) && Array.isArray(state.claims), 'IDEMPOTENCY_STORE_INVALID')
  ensure(state.claims.length <= maxClaims, 'IDEMPOTENCY_STORE_FULL')
  const seen = new Set()
  for (const claim of state.claims) {
    ensure(typeof claim.principalTag === 'string' && /^[a-f0-9]{64}$/.test(claim.principalTag), 'IDEMPOTENCY_STORE_INVALID')
    ensure(typeof claim.keyTag === 'string' && /^[a-f0-9]{64}$/.test(claim.keyTag), 'IDEMPOTENCY_STORE_INVALID')
    ensure(typeof claim.payloadHash === 'string' && /^[a-f0-9]{64}$/.test(claim.payloadHash), 'IDEMPOTENCY_STORE_INVALID')
    const pair = claim.principalTag + ':' + claim.keyTag
    ensure(!seen.has(pair), 'IDEMPOTENCY_STORE_INVALID')
    seen.add(pair)
  }
}

export function openIdempotencySidecar({ ledger, directory, bindingKey, maxClaims = DEFAULT_MAX_CLAIMS } = {}) {
  const resolvedDirectory = realpathSync(resolve(directory ?? ''))
  assertLedgerLease(ledger, resolvedDirectory)
  ensure(Buffer.isBuffer(bindingKey) && bindingKey.length >= 32, 'IDEMPOTENCY_KEY_REQUIRED')
  bindingKey = Buffer.from(bindingKey)
  ensure(Number.isSafeInteger(maxClaims) && maxClaims > 0 && maxClaims <= 100_000, 'IDEMPOTENCY_CAPACITY_INVALID')
  const keyCheck = tag(bindingKey, 'blockcraft-paid-idempotency-key-check-v1')

  const path = join(resolvedDirectory, '.paid-idempotency.json')
  // A ledger lock protects one ledger file, not this directory-wide store.
  // An OS lease also excludes other ledger paths/processes and path aliases.
  // Stale leases are never automatically recovered.
  const lockPath = path + '.lock'
  let lock
  try {
    lock = openSync(lockPath, 'wx', 0o600)
    fsyncSync(lock)
  } catch {
    if (lock !== undefined) closeSync(lock)
    failClosed('IDEMPOTENCY_LOCKED')
  }
  const release = () => { closeSync(lock); unlinkSync(lockPath) }
  let state
  let closed = false
  let broken = false
  try {
    try {
      const stat = lstatSync(path)
      ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0, 'IDEMPOTENCY_STORE_PERMISSIONS')
      ensure(stat.size <= Math.min(64 * 1024 * 1024, maxClaims * 512 + 256), 'IDEMPOTENCY_STORE_INVALID')
      state = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = { version: VERSION, keyCheck, claims: [] }
      writeAtomic(path, state)
    }
    validateState(state, maxClaims)
    ensure(state.keyCheck === keyCheck, 'IDEMPOTENCY_KEY_MISMATCH')
  } catch (error) {
    release()
    bindingKey.fill(0)
    if (error.code?.startsWith('IDEMPOTENCY_')) throw error
    failClosed()
  }

  const check = () => {
    ensure(!closed && !broken, 'IDEMPOTENCY_UNAVAILABLE')
    assertLedgerLease(ledger, resolvedDirectory)
  }

  return Object.freeze({
    reserve({ principal, idempotencyKey, payload, inputBound, outputBound, requestHash }) {
      check()
      ensure(typeof principal === 'string' && Buffer.byteLength(principal, 'utf8') > 0 && Buffer.byteLength(principal, 'utf8') <= 256, 'PRINCIPAL_INVALID')
      ensure(typeof idempotencyKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(idempotencyKey), 'IDEMPOTENCY_KEY_INVALID')
      ensure(Buffer.isBuffer(payload) || payload instanceof Uint8Array, 'IDEMPOTENCY_PAYLOAD_INVALID')
      const principalTag = tag(bindingKey, principal)
      const keyTag = tag(bindingKey, idempotencyKey)
      const payloadHash = createHash('sha256').update(payload).digest('hex')
      const existing = state.claims.find(claim => claim.principalTag === principalTag && claim.keyTag === keyTag)
      if (existing) {
        if (existing.payloadHash !== payloadHash) failClosed('IDEMPOTENCY_CONFLICT')
        failClosed('IDEMPOTENCY_REPLAY')
      }
      ensure(state.claims.length < maxClaims, 'IDEMPOTENCY_STORE_FULL')

      const next = { version: VERSION, keyCheck, claims: [...state.claims, { principalTag, keyTag, payloadHash }] }
      try { writeAtomic(path, next) }
      catch { broken = true; failClosed() }
      state = next

      try { return ledger.reserve(inputBound, outputBound, requestHash) }
      catch (error) { throw error }
    },
    close() {
      if (closed) return
      closed = true
      bindingKey.fill(0)
      release()
    },
    snapshot() { check(); return structuredClone(state) },
  })
}
