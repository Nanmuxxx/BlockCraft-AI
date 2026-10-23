/** Explicit owner-authorized reset to one persistent AI epoch. Legacy budget
 * artifacts are archived, never consulted by the new request path. Credentials
 * and business files remain untouched. Missing or partial state fails closed. */
import { constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, readFileSync, writeFileSync, fsyncSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { initializeUnifiedLedger, openUnifiedLedger, UNIFIED_CUSTOMER_POLICY, UNIFIED_PRICING } from './paid-gateway/unified-ledger.mjs'
import { startStudioServer } from './studio-launcher.mjs'
import { startServer, installShutdownHandlers } from './index.mjs'
import { createLivePricingVerifier } from './paid-gateway/live-pricing.mjs'

export const UNIFIED_ORIGIN = 'https://nanmuxxx-blockcraft-ai-test-7a2adbb-20261020.ms.show'
export const UNIFIED_EPOCH = 'owner-unified-ai-20261023-v1'
export const UNIFIED_TEST_PRINCIPAL = 'studio-agent-test-shared-20261023'
const ROOT = '/mnt/workspace/blockcraft-test-10cny-20261020'
const LEGACY_SCOPE = 'mvp-5cny-20261022-scope'
const EPOCH_DIRECTORY = 'unified-ai-budget-20261023-v1'
const MARKER = 'unified-ai-budget-20261023-v1.migration.json'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const refuse = stage => { throw Object.assign(new Error('UNIFIED_MIGRATION_REFUSED'), { code: 'UNIFIED_MIGRATION_REFUSED', stage }) }
function read(path, limit = 16 * 1024 * 1024, mounted = false, metadataOnly = false) {
  if (realpathSync(path) !== path) refuse('file-canonical')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const s = fstatSync(fd)
    if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid() || s.size > limit ||
      ![0o600, ...(mounted ? [0o644, 0o666, 0o777] : [])].includes(s.mode & 0o777)) refuse('file-metadata')
    return metadataOnly ? undefined : readFileSync(fd)
  } finally { closeSync(fd) }
}
function directory(path, mounted) {
  const s = lstatSync(path)
  if (!s.isDirectory() || realpathSync(path) !== path || s.uid !== process.getuid() ||
    ![0o700, ...(mounted ? [0o777] : [])].includes(s.mode & 0o777)) refuse('directory-metadata')
}
function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
function once(path, bytes) {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
}
function replace(path, bytes) {
  const temp = join(dirname(path), `.unified-receipt-${randomBytes(12).toString('hex')}`)
  once(temp, bytes); renameSync(temp, path); syncDirectory(dirname(path))
}
const hmac = (key, domain, value) => createHmac('sha256', key).update(domain).update('\0').update(value).digest('hex')
export function deriveUnifiedTestCredentials(bindingKey) {
  if (!Buffer.isBuffer(bindingKey) || bindingKey.length !== 32) refuse('binding-key')
  const derive = label => createHmac('sha256', bindingKey).update(label).digest('base64url')
  const access = derive('blockcraft-agent-test-access-v1'), session = derive('blockcraft-agent-test-session-v1')
  return Object.freeze({ access, session, sessionHash: hash(session) })
}

export function prepareUnifiedStudioState({ directory: root = ROOT, access, allowMountedDirectory = false,
  initializeLedger = initializeUnifiedLedger, fault = () => {} } = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(access || '')) refuse('access-shape')
  directory(root, allowMountedDirectory)
  const legacy = join(root, LEGACY_SCOPE), target = join(root, EPOCH_DIRECTORY), markerPath = join(root, MARKER)
  directory(legacy, allowMountedDirectory)
  const key = read(join(legacy, 'binding.key'), 32, allowMountedDirectory)
  if (key.length !== 32) refuse('binding-key')
  const signed = payload => JSON.stringify({ payload, mac: hmac(key, 'blockcraft-unified-migration-v1', JSON.stringify(payload)) })
  const contract = { version: 1, epochId: UNIFIED_EPOCH, directory: EPOCH_DIRECTORY, origin: UNIFIED_ORIGIN,
    accessHash: hash(access), bindingHash: hash(key), customer: { maxNano: 20_000_000_000, maxCalls: null },
    agentTest: { maxNano: 5_000_000_000, maxCalls: 200 } }
  let created = false
  if (!readdirSync(root).includes(MARKER)) {
    // The intent is durable before any initialization. Interrupted migrations
    // require review instead of silently issuing another fresh allowance.
    if (readdirSync(root).includes(EPOCH_DIRECTORY)) refuse('unreceipted-epoch')
    once(markerPath, signed({ ...contract, state: 'initializing' })); syncDirectory(root)
    fault('after-marker')
    const staging = join(root, `.unified-epoch-${randomBytes(12).toString('hex')}`)
    mkdirSync(staging, { mode: 0o700 })
    const approvalBytes = read(join(legacy, 'approval.json'), 65536, allowMountedDirectory)
    const approval = JSON.parse(approvalBytes)
    if (approval.publicOrigin !== UNIFIED_ORIGIN || !approval.sessions?.some(s => s.sessionHash === hash(access) && !s.revoked) ||
      approval.approval?.providerVerified !== true || approval.approval?.permissionsVerified !== true) refuse('legacy-approval')
    once(join(staging, 'binding.key'), key)
    const migratedApproval = { ...approval, policyId: UNIFIED_CUSTOMER_POLICY.id,
      approval: { ...approval.approval, reference: UNIFIED_CUSTOMER_POLICY.approval, maxCalls: null, expiresAt: Number.MAX_SAFE_INTEGER } }
    once(join(staging, 'approval.json'), JSON.stringify(migratedApproval))
    if (approval.issuer) once(join(staging, 'studio-issuer-state.json'), read(join(legacy, 'studio-issuer-state.json'), 4096, allowMountedDirectory))
    const archive = join(staging, 'archive'); mkdirSync(archive, { mode: 0o700 })
    const entries = []
    function copyBudgetTree(source, destination, relative) {
      directory(source, allowMountedDirectory); mkdirSync(destination, { mode: 0o700 })
      for (const name of readdirSync(source).sort()) {
        const src = join(source, name), dest = join(destination, name), rel = `${relative}/${name}`
        const stat = lstatSync(src)
        if (stat.isDirectory()) copyBudgetTree(src, dest, rel)
        else { const bytes = read(src, 16 * 1024 * 1024, allowMountedDirectory); once(dest, bytes); entries.push({ file: rel, sha256: hash(bytes), bytes: bytes.length }) }
      }
      syncDirectory(destination)
    }
    for (const [source, prefix] of [[root, 'root'], [legacy, 'legacy-scope']]) {
      for (const name of readdirSync(source).sort()) {
        const budgetArtifact = /^(?:mvp-.*(?:\.json|scope)|(?:studio|mochi)-ledger.*\.json|\.(?:studio|mochi)-budget-v\d+|.*budget.*\.json)$/.test(name)
        if (!budgetArtifact || name === MARKER) continue
        const src = join(source, name), dest = join(archive, `${prefix}-${name}`), rel = `${prefix}-${name}`
        if (lstatSync(src).isDirectory()) {
          // Copy only budget files from scopes, excluding credentials/business.
          if (/scope$/.test(name)) continue
          copyBudgetTree(src, dest, rel)
        } else { const bytes = read(src, 16 * 1024 * 1024, allowMountedDirectory); once(dest, bytes); entries.push({ file: rel, sha256: hash(bytes), bytes: bytes.length }) }
      }
    }
    once(join(archive, 'legacy-approval.sha256'), hash(approvalBytes))
    const manifest = JSON.stringify({ version: 1, epochId: UNIFIED_EPOCH, entries })
    once(join(staging, 'archive-manifest.json'), manifest)
    initializeLedger(join(staging, 'unified-ledger.json'), { epochId: UNIFIED_EPOCH, pricing: UNIFIED_PRICING, allowMountedDirectory })
    syncDirectory(archive); syncDirectory(staging); fault('before-install')
    renameSync(staging, target); syncDirectory(root); fault('after-install')
    replace(markerPath, signed({ ...contract, state: 'complete', archiveManifestHash: hash(manifest) })); created = true
  }
  const receipt = JSON.parse(read(markerPath, 65536, allowMountedDirectory))
  if (!receipt?.payload || receipt.mac !== hmac(key, 'blockcraft-unified-migration-v1', JSON.stringify(receipt.payload)) ||
    receipt.payload.state !== 'complete' || JSON.stringify(Object.fromEntries(Object.keys(contract).map(k => [k, receipt.payload[k]]))) !== JSON.stringify(contract)) refuse('migration-receipt')
  directory(target, allowMountedDirectory)
  if (!read(join(target, 'binding.key'), 32, allowMountedDirectory).equals(key) ||
    hash(read(join(target, 'archive-manifest.json'), 1024 * 1024, allowMountedDirectory)) !== receipt.payload.archiveManifestHash) refuse('epoch-continuity')
  // Presence is mandatory; the ledger engine validates the private state.
  read(join(target, 'unified-ledger.json'), Number.POSITIVE_INFINITY, allowMountedDirectory, true)
  const ledger = openUnifiedLedger(join(target, 'unified-ledger.json'), { pricing: UNIFIED_PRICING, allowMountedDirectory })
  try {
    if (ledger.snapshot().epochId !== receipt.payload.epochId) refuse('ledger-epoch-mismatch')
  } finally { ledger.close() }
  const approval = JSON.parse(read(join(target, 'approval.json'), 65536, allowMountedDirectory))
  if (approval.policyId !== UNIFIED_CUSTOMER_POLICY.id || approval.approval?.maxCalls !== null || approval.publicOrigin !== UNIFIED_ORIGIN) refuse('epoch-approval')
  return { directory: target, ledgerPath: join(target, 'unified-ledger.json'), approval, bindingKey: key, created,
    testCredentials: deriveUnifiedTestCredentials(key) }
}

const send = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...extra })
  res.end(JSON.stringify(body))
}
export async function startUnifiedStudioDeployment({ env = process.env, directory = ROOT, host = '0.0.0.0', port = Number(env.PORT || 7860),
  fetchImpl = globalThis.fetch, verifyPricing = createLivePricingVerifier(), signalHandlers = true, allowMountedDirectory = true } = {}) {
  const access = env.BLOCKCRAFT_TEST_ACCESS?.trim()
  let configured = Boolean(env.DEEPSEEK_API_KEY?.trim() && access), unavailable = configured ? null : 'AI_NOT_CONFIGURED'
  let started, state, stage = 'pricing-verification'
  let resolvePrincipal = () => null
  try {
    if (configured) {
      if (typeof verifyPricing.assertCurrent !== 'function') refuse('pricing-guard')
      await verifyPricing(); stage = 'unified-state'
      state = prepareUnifiedStudioState({ directory, access, allowMountedDirectory })
      stage = 'studio-server'
      started = await startStudioServer({ env: { DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY, STUDIO_APPROVAL_PATH: join(state.directory, 'approval.json'), PUBLIC_ORIGIN: UNIFIED_ORIGIN },
        host, port, fetchImpl: async (...args) => { await verifyPricing(); return fetchImpl(...args) }, signalHandlers: false,
        policy: UNIFIED_CUSTOMER_POLICY, profile: 'unified-studio', allowMountedDirectory, mochiEnabled: true,
        verifyPricing, pricingGuard: verifyPricing.assertCurrent,
        unifiedBudget: { ledgerPath: state.ledgerPath, testPrincipal: UNIFIED_TEST_PRINCIPAL, testSessionHash: state.testCredentials.sessionHash } })
      // Authentication, issuer sessions and live revocation use the exact same
      // resolver as paid requests; the status endpoint cannot retain stale access.
      resolvePrincipal = started.resolveStudioPrincipal
    }
  } catch (error) {
    configured = false; unavailable = 'AI_AUTHORIZATION_LOCKED'; resolvePrincipal = () => null
    // Only fixed stages/codes are logged; never private records or credentials.
    console.error(JSON.stringify({ event: 'unified-studio-paid-disabled', stage: /^[a-z-]+$/.test(error.stage || '') ? error.stage : stage,
      code: /^[A-Z_]{1,64}$/.test(error.code || '') ? error.code : 'CONFIGURATION_REFUSED' }))
  }
  if (!started) started = await startServer({ host, port, env: {} })
  const handlers = started.server.listeners('request'); started.server.removeAllListeners('request')
  const attempts = new Map(), pending = new Set()
  async function login(req, res, testAccount) {
    let timer
    try {
      if (!configured) { send(res, 503, { error: unavailable }); return }
      const origins = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'origin')
      if (origins.length !== 1 || req.headers.origin !== UNIFIED_ORIGIN || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') { send(res, 403, { error: 'ORIGIN_REJECTED' }); return }
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') { send(res, 415, { error: 'INVALID_REQUEST' }); return }
      for (const [key, value] of attempts) if (value.until <= Date.now()) attempts.delete(key)
      const ip = req.socket.remoteAddress
      if (!attempts.has(ip)) {
        if (attempts.size >= 1000) { send(res, 429, { error: 'RATE_LIMITED' }); return }
        attempts.set(ip, { count: 0, until: Date.now() + 60_000 })
      }
      if (++attempts.get(ip).count > 5) { send(res, 429, { error: 'RATE_LIMITED' }); return }
      let size = 0; const chunks = []; timer = setTimeout(() => req.destroy(), 3000)
      for await (const chunk of req) { size += chunk.length; if (size > 1024) { req.destroy(); return }; chunks.push(chunk) }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')), credential = testAccount ? state.testCredentials.access : access
      if (!body || Object.keys(body).length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(body.credential || '') ||
        !timingSafeEqual(Buffer.from(hash(body.credential), 'hex'), Buffer.from(hash(credential), 'hex'))) { send(res, 401, { error: 'UNAUTHORIZED' }); return }
      const session = testAccount ? state.testCredentials.session : body.credential
      send(res, 200, { authenticated: true }, { 'Set-Cookie': `__Host-bc_session=${session}; Secure; HttpOnly; SameSite=None; Partitioned; Path=/; Max-Age=2592000` })
    } catch { if (!res.destroyed && !res.writableEnded) send(res, 400, { error: 'INVALID_REQUEST' }) }
    finally { clearTimeout(timer) }
  }
  async function status(req, res) {
    let pricingVerified = false
    if (configured) { try { await verifyPricing(); verifyPricing.assertCurrent(); pricingVerified = true } catch {} }
    const principal = resolvePrincipal(req), authenticated = Boolean(principal)
    let budget
    if (authenticated) {
      try { budget = started.budgetStatus(principal === UNIFIED_TEST_PRINCIPAL ? 'agent-test' : 'customer') }
      catch { send(res, 503, { configured, authenticated, unavailable: 'AI_AUTHORIZATION_LOCKED' }); return }
    }
    send(res, 200, { configured: configured && pricingVerified, authenticated, unavailable: configured && !pricingVerified ? 'PRICING_UNVERIFIED' : unavailable,
      singleBoot: false, model: UNIFIED_PRICING.model, expiresAt: Number.MAX_SAFE_INTEGER,
      pricingVerification: 'official-page-at-startup-and-every-15-minutes', ...(budget ? { budget } : {}) })
  }
  started.server.on('request', (req, res) => {
    let task
    if (req.url === '/api/studio/status' && req.method === 'GET') task = status(req, res)
    else if (req.url === '/api/studio/session' || req.url === '/api/studio/test-session') task = login(req, res, req.url === '/api/studio/test-session')
    else { for (const handler of handlers) handler.call(started.server, req, res); return }
    pending.add(task); void task.finally(() => pending.delete(task))
  })
  let stopping
  const shutdown = () => stopping ??= (async () => { await Promise.allSettled([...pending]); await started.shutdown() })()
  if (signalHandlers) installShutdownHandlers(shutdown)
  const accounts = configured ? Object.fromEntries(['customer', 'agent-test'].map(account => {
    const b = started.budgetStatus(account)
    return [account, { calls: b.calls, chargedCny: b.reservedCny, capCny: b.capCny, maxCalls: b.maxCalls }]
  })) : undefined
  console.info(JSON.stringify({ event: 'unified-studio-ready', configured, epochId: UNIFIED_EPOCH, state: state?.created ? 'new-authorized-epoch' : configured ? 'persistent-epoch-reused' : 'disabled', ...(accounts ? { accounts } : {}) }))
  return { server: started.server, shutdown }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startUnifiedStudioDeployment().catch(() => { console.error(JSON.stringify({ event: 'unified-studio-start-refused' })); process.exitCode = 1 })
}
