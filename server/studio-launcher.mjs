import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAppServer, createOpaqueSessionPrincipalResolver, startServer, installShutdownHandlers } from './index.mjs'
import { createPrincipalPaidGenerationRuntime } from './paid-gateway/runtime.mjs'
import { POLICY, PRICING } from './paid-gateway/pricing.mjs'

const refuse = () => { throw new Error('STUDIO_CONFIGURATION_REFUSED') }
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
 * This launcher never provisions approvals, binding keys, sessions or cookies.
 */
function readApproval(path, publicOrigin) {
  const value = JSON.parse(privateFile(path, 64 * 1024).toString('utf8'))
  if (!exactKeys(value, ['version', 'publicOrigin', 'policyId', 'approval', 'sessions']) || value.version !== 1 ||
      value.publicOrigin !== publicOrigin || value.policyId !== POLICY.id) refuse()
  const a = value.approval
  if (!exactKeys(a, ['providerVerified', 'permissionsVerified', 'reference', 'maxCalls', 'expiresAt']) ||
      a.providerVerified !== true || a.permissionsVerified !== true || typeof a.reference !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(a.reference) || a.maxCalls !== POLICY.maxCalls ||
      !Number.isSafeInteger(a.expiresAt) || a.expiresAt <= Date.now() || a.expiresAt > PRICING.expiresAt || Date.now() >= PRICING.expiresAt) refuse()
  if (!Array.isArray(value.sessions) || value.sessions.length < 1 || value.sessions.length > 256) refuse()
  for (const s of value.sessions) {
    if (!exactKeys(s, ['sessionHash', 'principal', 'expiresAt', 'revoked', 'appId']) ||
        typeof s.principal !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(s.principal) ||
        typeof s.appId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(s.appId) || s.expiresAt > a.expiresAt) refuse()
  }
  if (new Set(value.sessions.map(s => s.principal)).size !== value.sessions.length) refuse()
  // The existing resolver validates hashes, expiry shape, revocation and duplicates.
  const resolver = createOpaqueSessionPrincipalResolver({ sessions: value.sessions })
  return { ...value, resolver }
}

export async function startStudioServer({ env = process.env, host = '127.0.0.1', port = 3001,
  fetchImpl, signalHandlers = true } = {}) {
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
  const current = req => {
    try {
      const config = readApproval(path, publicOrigin)
      // Approval changes require a restart; revocation/expiry remain live.
      if (JSON.stringify(config.approval) !== JSON.stringify(approved.approval)) return null
      const principal = config.resolver(req)
      if (!principal) return null
      const session = config.sessions.find(s => s.principal === principal && !s.revoked && s.expiresAt > Date.now())
      return session ? { principal, appId: session.appId } : null
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
        return session?.principal === principal ? { sessionId: principal, appId: session.appId, readOnly: false } : null
      },
    },
    appServerFactory: options => {
      const server = createAppServer({ ...options, apiKey: '', model: PRICING.model, publicOrigin })
      const handlers = server.listeners('request')
      server.removeAllListeners('request')
      server.on('request', (req, res) => {
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
  if (signalHandlers) installShutdownHandlers(started.shutdown)
  return started
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStudioServer().catch(() => {
    console.error('Studio refused to start; owner approval and platform configuration require review.')
    process.exitCode = 1
  })
}
