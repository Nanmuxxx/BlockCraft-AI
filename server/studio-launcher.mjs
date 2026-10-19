import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync, writeSync, fsyncSync, renameSync } from 'node:fs'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAppServer, createOpaqueSessionPrincipalResolver, startServer, installShutdownHandlers } from './index.mjs'
import { createPrincipalPaidGenerationRuntime } from './paid-gateway/runtime.mjs'
import { POLICY, PRICING } from './paid-gateway/pricing.mjs'

const refuse = () => { throw new Error('STUDIO_CONFIGURATION_REFUSED') }
const STUDIO_APP_ID = 'pomodoro'
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

function privateFile(path, maxBytes) {
  if (!isAbsolute(path) || realpathSync(path) !== path) refuse()
  const parent = lstatSync(dirname(path))
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700) refuse()
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > maxBytes) refuse()
    const bytes = readFileSync(fd)
    if (bytes.length > maxBytes) refuse()
    return bytes
  } finally { closeSync(fd) }
}

/** Owner-controlled private filesystem is the trust root, not an environment flag.
 * This launcher never provisions approvals, binding keys or initial durable state.
 */
function readApproval(path, publicOrigin) {
  const value = JSON.parse(privateFile(path, 64 * 1024).toString('utf8'))
  const keys = ['version', 'publicOrigin', 'policyId', 'approval', 'sessions', ...(value?.issuer ? ['issuer'] : [])]
  if (!exactKeys(value, keys) || value.version !== 1 ||
      value.publicOrigin !== publicOrigin || value.policyId !== POLICY.id) refuse()
  const a = value.approval
  if (!exactKeys(a, ['providerVerified', 'permissionsVerified', 'reference', 'maxCalls', 'expiresAt']) ||
      a.providerVerified !== true || a.permissionsVerified !== true || typeof a.reference !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(a.reference) || a.maxCalls !== POLICY.maxCalls ||
      !Number.isSafeInteger(a.expiresAt) || a.expiresAt <= Date.now() || a.expiresAt > PRICING.expiresAt || Date.now() >= PRICING.expiresAt) refuse()
  if (!Array.isArray(value.sessions) || value.sessions.length < 1 || value.sessions.length > (value.issuer ? 255 : 256)) refuse()
  for (const s of value.sessions) {
    if (!exactKeys(s, ['sessionHash', 'principal', 'expiresAt', 'revoked', 'appId']) ||
        typeof s.principal !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(s.principal) ||
        s.appId !== STUDIO_APP_ID || s.expiresAt > a.expiresAt) refuse()
  }
  if (new Set(value.sessions.map(s => s.principal)).size !== value.sessions.length) refuse()
  // The existing resolver validates hashes, expiry shape, revocation and duplicates.
  if (value.issuer) {
    const g = value.issuer
    if (!exactKeys(g, ['id', 'credentialHash', 'principal', 'appId', 'issuedAt', 'expiresAt', 'sessionExpiresAt', 'revoked']) ||
        typeof g.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(g.id) || typeof g.credentialHash !== 'string' || !/^[a-f0-9]{64}$/.test(g.credentialHash) ||
        typeof g.principal !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(g.principal) || g.appId !== STUDIO_APP_ID || typeof g.revoked !== 'boolean' ||
        !Number.isSafeInteger(g.issuedAt) || !Number.isSafeInteger(g.expiresAt) || !Number.isSafeInteger(g.sessionExpiresAt) ||
        g.issuedAt > Date.now() || g.expiresAt <= g.issuedAt || g.expiresAt - g.issuedAt > 600_000 ||
        g.sessionExpiresAt <= g.expiresAt || g.sessionExpiresAt - g.issuedAt > 1800_000 || g.sessionExpiresAt > a.expiresAt ||
        value.sessions.some(s => s.principal === g.principal)) refuse()
  }
  const resolver = createOpaqueSessionPrincipalResolver({ sessions: value.sessions })
  return { ...value, resolver }
}

export async function startStudioServer({ env = process.env, host = '127.0.0.1', port = 3001,
  fetchImpl, signalHandlers = true, issuerFault = () => {} } = {}) {
  // Only a path is selected by env. No flag grants approval and no state is created here.
  const path = env.STUDIO_APPROVAL_PATH
  const publicOrigin = env.PUBLIC_ORIGIN
  if (typeof path !== 'string' || !isAbsolute(path) || typeof publicOrigin !== 'string') refuse()
  const origin = new URL(publicOrigin)
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin || origin.username || origin.password) refuse()
  const directory = dirname(path)
  const stat = lstatSync(directory)
  if (realpathSync(directory) !== directory || !stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) refuse()
  const approved = readApproval(path, publicOrigin)
  const bindingKey = privateFile(join(directory, 'binding.key'), 32)
  if (bindingKey.length !== 32) refuse()
  // Issuer never creates a new paid ledger; continuity requires separate review.
  if (approved.issuer) privateFile(join(directory, 'studio-ledger.json'), 1024 * 1024)
  let issuer
  const current = req => {
    try {
      const config = readApproval(path, publicOrigin)
      // Approval changes require a restart; revocation/expiry remain live.
      if (JSON.stringify(config.approval) !== JSON.stringify(approved.approval)) return null
      const issued = issuer?.session(config)
      const principal = (issued ? createOpaqueSessionPrincipalResolver({ sessions: [...config.sessions, issued] }) : config.resolver)(req)
      if (!principal) return null
      const session = [...config.sessions, ...(issued ? [issued] : [])].find(s => s.principal === principal && !s.revoked && s.expiresAt > Date.now())
      return session ? { principal, sessionId: session.sessionHash, appId: STUDIO_APP_ID } : null
    } catch { return null }
  }
  const started = await startServer({ host, port,
    env: { DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY, DEEPSEEK_BUDGET_LEDGER_PATH: join(directory, 'studio-ledger.json') },
    bindingKey,
    resolvePrincipal: req => current(req)?.principal ?? null,
    principalRuntimeFactory: options => createPrincipalPaidGenerationRuntime({ ...options, policy: POLICY, profile: 'production', fetchImpl }),
    interactive: {
      enabled: true, approval: approved.approval, allowedOrigin: publicOrigin,
      resolveAccess: (req, { principal }) => {
        const session = current(req)
        return session?.principal === principal ? { sessionId: session.sessionId, appId: session.appId, readOnly: false } : null
      },
    },
    appServerFactory: options => {
      // startServer has acquired the existing Gateway lock before this factory.
      if (approved.issuer) issuer = createIssuer({ directory, bindingKey, approved, reload: () => readApproval(path, publicOrigin), fault: issuerFault })
      const server = createAppServer({ ...options, apiKey: '', model: PRICING.model, publicOrigin })
      const handlers = server.listeners('request')
      server.removeAllListeners('request')
      server.on('request', (req, res) => {
        if (issuer?.handle(req, res)) return
        let pathname = req.url?.split('?')[0]
        try { pathname = decodeURIComponent(pathname) } catch { /* Core rejects malformed paths. */ }
        if (pathname === '/api/ai/generate') {
          const origins = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'origin')
          if (origins.length !== 1 || req.headers.origin !== publicOrigin) {
            res.writeHead(403, { 'Cache-Control': 'no-store' }); res.end(); return
          }
        }
        for (const handler of handlers) handler.call(server, req, res)
      })
      return server
    },
  })
  let stopping
  const shutdown = () => stopping ??= (async () => { started.server.beginShutdown(); await issuer?.drain(); await started.shutdown() })()
  if (signalHandlers) installShutdownHandlers(shutdown)
  return Object.freeze({ server: started.server, shutdown })
}

// Canonical v1: UTF8 JSON.stringify over fixed ordered fields below; no whitespace.
const digest = value => createHash('sha256').update(value).digest('hex')
function statePayload(s) {
  return JSON.stringify({ version: s.version, grantDigest: s.grantDigest, attempts: s.attempts,
    consumed: s.consumed, sessionHash: s.sessionHash, sessionExpiresAt: s.sessionExpiresAt })
}
function grantPayload(g) {
  return JSON.stringify({ id: g.id, credentialHash: g.credentialHash, principal: g.principal,
    appId: g.appId, issuedAt: g.issuedAt, expiresAt: g.expiresAt, sessionExpiresAt: g.sessionExpiresAt, revoked: g.revoked })
}
function createIssuer({ directory, bindingKey, approved, reload, fault }) {
  const statePath = join(directory, 'studio-issuer-state.json')
  const grantDigest = digest(grantPayload(approved.issuer))
  const mac = payload => createHmac('sha256', bindingKey).update('blockcraft-studio-issuer-v1\n').update(payload).digest('hex')
  let halted = false, closing = false
  const readers = new Set(), pending = new Set()
  function read() {
    const s = JSON.parse(privateFile(statePath, 4096).toString('utf8'))
    if (!exactKeys(s, ['version', 'grantDigest', 'attempts', 'consumed', 'sessionHash', 'sessionExpiresAt', 'mac']) ||
        s.version !== 1 || s.grantDigest !== grantDigest || !Number.isSafeInteger(s.attempts) || s.attempts < 0 || s.attempts > 5 ||
        typeof s.consumed !== 'boolean' || (s.consumed ? !/^[a-f0-9]{64}$/.test(s.sessionHash) ||
          s.sessionExpiresAt !== approved.issuer.sessionExpiresAt || s.attempts < 1 : s.sessionHash !== null || s.sessionExpiresAt !== null) ||
        !/^[a-f0-9]{64}$/.test(s.mac) || !timingSafeEqual(Buffer.from(s.mac, 'hex'), Buffer.from(mac(statePayload(s)), 'hex'))) refuse()
    return s
  }
  read() // No implicit initialization/recovery/reset.
  function commit(s) {
    const temp = join(directory, `studio-issuer-${randomBytes(16).toString('hex')}.tmp`)
    const bytes = Buffer.from(JSON.stringify({ ...JSON.parse(statePayload(s)), mac: mac(statePayload(s)) }))
    let fd, parent
    try {
      fault('before-open'); fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); fault('after-open')
      fault('before-write'); let offset = 0
      while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset); if (n < 1) refuse(); offset += n }
      fault('after-write'); fault('before-file-fsync'); fsyncSync(fd); fault('after-file-fsync')
      closeSync(fd); fd = undefined
      fault('before-rename'); renameSync(temp, statePath); fault('after-rename')
      parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      fault('before-dir-fsync'); fsyncSync(parent); fault('after-dir-fsync')
    } catch { halted = true; throw new Error('ISSUER_UNAVAILABLE') }
    finally { if (fd !== undefined) closeSync(fd); if (parent !== undefined) closeSync(parent) }
  }
  function live() {
    const config = reload()
    if (JSON.stringify(config.approval) !== JSON.stringify(approved.approval) || !config.issuer || digest(grantPayload(config.issuer)) !== grantDigest || config.issuer.revoked) refuse()
    return config
  }
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'Connection': 'close' }
  const send = (res, status, extra = {}, body = '') => { if (!res.destroyed) { res.writeHead(status, { ...headers, ...extra }); res.end(body) } }
  async function exchange(req, res) {
    let timer
    try {
      if (readers.size >= 2) { send(res, 429); return }
      readers.add(req)
      const chunks = []; let size = 0
      const body = new Promise((resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('DEADLINE')); req.destroy() }, 2000)
        req.on('data', chunk => { size += chunk.length; if (size > 1024) { reject(new Error('SIZE')); req.destroy() } else chunks.push(chunk) })
        req.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.once('error', reject); req.once('aborted', () => reject(new Error('ABORT')))
      })
      const text = await body
      if (closing || halted) { send(res, 503); return }
      const config = live(), grant = config.issuer, s = read()
      if (grant.expiresAt <= Date.now() || s.consumed || s.attempts >= 5) { send(res, 401); return }
      // Every bounded body reaching comparison spends a durable attempt.
      s.attempts++; commit(s)
      const fields = new URLSearchParams(text), code = fields.get('credential')
      if ([...fields.keys()].length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(code || '') ||
          Buffer.from(code, 'base64url').toString('base64url') !== code ||
          !timingSafeEqual(Buffer.from(digest(code), 'hex'), Buffer.from(grant.credentialHash, 'hex'))) { send(res, 401); return }
      if (live().issuer.expiresAt <= Date.now()) { send(res, 401); return }
      const token = randomBytes(32).toString('base64url')
      s.consumed = true; s.sessionHash = digest(token); s.sessionExpiresAt = grant.sessionExpiresAt
      commit(s) // consume+hash is durable BEFORE any Set-Cookie.
      send(res, 303, { Location: '/ai-create', 'Set-Cookie': `__Host-bc_session=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor((grant.sessionExpiresAt - Date.now()) / 1000))}` })
    } catch { send(res, 503) }
    finally { clearTimeout(timer); readers.delete(req) }
  }
  return {
    session(config) {
      if (halted || !config.issuer || config.issuer.revoked || digest(grantPayload(config.issuer)) !== grantDigest) return null
      const s = read()
      return s.consumed && s.sessionExpiresAt > Date.now() ? { sessionHash: s.sessionHash, principal: config.issuer.principal,
        expiresAt: s.sessionExpiresAt, revoked: false, appId: STUDIO_APP_ID } : null
    },
    handle(req, res) {
      let pathname = req.url?.split('?')[0]
      try { pathname = decodeURIComponent(pathname) } catch { return false }
      if (!['/studio/sign-in', '/studio/session'].includes(pathname)) return false
      if (closing || halted) { send(res, 503); return true }
      if (req.url !== pathname) { send(res, 400); return true }
      if (pathname === '/studio/sign-in') {
        if (req.method !== 'GET') send(res, 405)
        // no-referrer makes Chromium send Origin:null on native form POST.
        // same-origin preserves the required Origin without disclosing URLs off-site.
        else send(res, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'same-origin' }, '<!doctype html><html><meta charset="utf-8"><title>Studio sign in</title><form method="post" action="/studio/session"><label>Owner access credential <input type="password" name="credential" required autocomplete="off" maxlength="43"></label><button>Sign in</button></form></html>')
        return true
      }
      const origins = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'origin')
      if (origins.length !== 1 || req.headers.origin !== approved.publicOrigin ||
          (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) { send(res, 403); return true }
      if (req.method !== 'POST') { send(res, 405); return true }
      if (req.headers['content-type'] !== 'application/x-www-form-urlencoded') { send(res, 415); return true }
      const task = exchange(req, res); pending.add(task); void task.finally(() => pending.delete(task))
      return true
    },
    async drain() { closing = true; for (const req of readers) req.destroy(); await Promise.allSettled([...pending]) },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStudioServer().catch(() => {
    console.error('Studio refused to start; owner approval and platform configuration require review.')
    process.exitCode = 1
  })
}
