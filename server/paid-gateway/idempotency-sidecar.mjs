import { createHmac, createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { assertLedgerLease } from './ledger.mjs'
import { ensure } from './pricing.mjs'

const VERSION = 1
const DEFAULT_MAX_CLAIMS = 1000
const fail = code => { throw Object.assign(new Error(code), { code }) }
const tag = (key, value) => createHmac('sha256', key).update(value).digest('hex')

// ModelScope keeps /mnt/workspace across container replacement. A killed
// process can leave an empty sidecar lease behind. Recover only that exact
// stale case in mounted-directory compatibility mode; active leases fail
// closed so two runtimes can never share the store.
function lockIsHeld(path) {
  try {
    const target = statSync(path)
    for (const pid of readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue
      let fds
      try { fds = readdirSync(`/proc/${pid}/fd`) } catch { continue }
      for (const fd of fds) {
        try {
          const current = statSync(`/proc/${pid}/fd/${fd}`)
          if (current.dev === target.dev && current.ino === target.ino) return true
        } catch { /* process may exit while scanning */ }
      }
    }
    return false
  } catch { return true }
}

function writeAtomic(path, value) {
  const directory = dirname(path)
  const temp = join(directory, '.idempotency-' + randomUUID())
  const fd = openSync(temp, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd) }
  finally { closeSync(fd) }
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
  ensure(state?.version === VERSION && typeof state.keyCheck === 'string'
    && /^[a-f0-9]{64}$/.test(state.keyCheck) && Array.isArray(state.claims), 'IDEMPOTENCY_STORE_INVALID')
  ensure(state.claims.length <= maxClaims, 'IDEMPOTENCY_STORE_FULL')
  const seen = new Set()
  for (const claim of state.claims) {
    ensure(typeof claim.principalTag === 'string' && /^[a-f0-9]{64}$/.test(claim.principalTag)
      && typeof claim.keyTag === 'string' && /^[a-f0-9]{64}$/.test(claim.keyTag)
      && typeof claim.payloadHash === 'string' && /^[a-f0-9]{64}$/.test(claim.payloadHash), 'IDEMPOTENCY_STORE_INVALID')
    const pair = claim.principalTag + ':' + claim.keyTag
    ensure(!seen.has(pair), 'IDEMPOTENCY_STORE_INVALID')
    seen.add(pair)
  }
}

export function openIdempotencySidecar({ ledger, directory, bindingKey, maxClaims = DEFAULT_MAX_CLAIMS, allowMountedDirectory = false } = {}) {
  const resolvedDirectory = realpathSync(resolve(directory ?? ''))
  assertLedgerLease(ledger, resolvedDirectory)
  ensure(Buffer.isBuffer(bindingKey) && bindingKey.length >= 32, 'IDEMPOTENCY_KEY_REQUIRED')
  bindingKey = Buffer.from(bindingKey)
  ensure(Number.isSafeInteger(maxClaims) && maxClaims > 0 && maxClaims <= 100_000, 'IDEMPOTENCY_CAPACITY_INVALID')
  const keyCheck = tag(bindingKey, 'blockcraft-paid-idempotency-key-check-v1')
  const path = join(resolvedDirectory, '.paid-idempotency.json')
  const lockPath = path + '.lock'
  let lock
  try { lock = openSync(lockPath, 'wx', 0o600); fsyncSync(lock) }
  catch {
    if (lock !== undefined) closeSync(lock)
    if (allowMountedDirectory && !lockIsHeld(lockPath)) {
      const stale = `${lockPath}.stale-${randomUUID()}`
      try {
        renameSync(lockPath, stale)
        lock = openSync(lockPath, 'wx', 0o600)
        fsyncSync(lock)
      } catch { fail('IDEMPOTENCY_LOCKED') }
    } else fail('IDEMPOTENCY_LOCKED')
  }
  const release = () => { closeSync(lock); unlinkSync(lockPath) }
  let state, closed = false, broken = false
  try {
    try {
      const stat = lstatSync(path)
      const mode = stat.mode & 0o777
      ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
        ((mode & 0o077) === 0 || (allowMountedDirectory && [0o644, 0o666, 0o777].includes(mode))), 'IDEMPOTENCY_STORE_PERMISSIONS')
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
    release(); bindingKey.fill(0)
    if (error.code?.startsWith('IDEMPOTENCY_')) throw error
    fail('IDEMPOTENCY_UNAVAILABLE')
  }

  const check = () => {
    ensure(!closed && !broken, 'IDEMPOTENCY_UNAVAILABLE')
    assertLedgerLease(ledger, resolvedDirectory)
  }
  const inspect = ({ principal, idempotencyKey, payload }) => {
    check()
    ensure(typeof principal === 'string' && Buffer.byteLength(principal, 'utf8') > 0
      && Buffer.byteLength(principal, 'utf8') <= 256, 'PRINCIPAL_INVALID')
    ensure(typeof idempotencyKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(idempotencyKey), 'IDEMPOTENCY_KEY_INVALID')
    ensure(Buffer.isBuffer(payload) || payload instanceof Uint8Array, 'IDEMPOTENCY_PAYLOAD_INVALID')
    const principalTag = tag(bindingKey, principal)
    const keyTag = tag(bindingKey, idempotencyKey)
    const payloadHash = createHash('sha256').update(payload).digest('hex')
    const existing = state.claims.find(claim => claim.principalTag === principalTag && claim.keyTag === keyTag)
    if (existing) fail(existing.payloadHash === payloadHash ? 'IDEMPOTENCY_REPLAY' : 'IDEMPOTENCY_CONFLICT')
    return { principalTag, keyTag, payloadHash }
  }

  return Object.freeze({
    check: inspect,
    reserve(options) {
      const { inputBound, outputBound, requestHash } = options
      const { principalTag, keyTag, payloadHash } = inspect(options)
      ensure(state.claims.length < maxClaims, 'IDEMPOTENCY_STORE_FULL')
      const next = { version: VERSION, keyCheck, claims: [...state.claims, { principalTag, keyTag, payloadHash }] }
      try { writeAtomic(path, next) } catch { broken = true; fail('IDEMPOTENCY_UNAVAILABLE') }
      state = next
      return ledger.reserve(inputBound, outputBound, requestHash)
    },
    close() { if (closed) return; closed = true; bindingKey.fill(0); release() },
    snapshot() { check(); return structuredClone(state) },
  })
}
