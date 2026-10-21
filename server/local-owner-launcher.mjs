import { createHash, randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { mkdirSync, lstatSync, readFileSync, openSync, writeFileSync, closeSync, fsyncSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as gatewayRuntime from './paid-gateway/runtime.mjs'
import * as gatewayPricingModule from './paid-gateway/pricing.mjs'
import { createAppServer, createOpaqueSessionPrincipalResolver, startServer, installShutdownHandlers } from './index.mjs'

const fail = reason => { throw new Error(`Local owner launcher refused: ${reason}`) }

export function assertLocalGatewayProfile({ policy = gatewayPricingModule.SMOKE_POLICY, pricing = gatewayPricingModule.PRICING, now = Date.now() } = {}) {
  if (!policy) fail('the isolated Gateway SMOKE_POLICY is not installed')
  if (pricing.expiresAt <= now) fail('the Gateway pricing snapshot is expired')
  if (policy.maxCalls !== 3 || policy.maxOutputTokens !== 2048 || policy.concurrency !== 1 || policy.retries !== 0) {
    fail('the Gateway candidate must enforce maxCalls=3, maxOutputTokens=2048, concurrency=1, retries=0')
  }
  if (!Number.isSafeInteger(policy.conservativeNano) || policy.conservativeNano > 500_000_000) {
    fail('the Gateway candidate must enforce the proposed ¥0.50 first-run cap')
  }
  if (!Number.isSafeInteger(policy.maxInputBytes) || !Number.isSafeInteger(policy.framingTokens) || policy.maxInputBytes + policy.framingTokens > 73_728) {
    fail('the Gateway candidate input bound exceeds the reviewed cost envelope')
  }
  if (pricing.model !== 'deepseek-flash' || pricing.inputNanoPerToken > 2_000 || pricing.outputNanoPerToken > 9_000) {
    fail('the Gateway price snapshot does not match the reviewed conservative price ceiling')
  }
  return true
}

export function provisionLocalOwnerState(directory = join(homedir(), '.blockcraft-ai-local-smoke-20261020')) {
  try { mkdirSync(directory, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const check = (path, mode) => {
    const info = lstatSync(path)
    if (info.isSymbolicLink() || (info.mode & 0o777) !== mode || info.uid !== process.getuid()) fail('private local state permissions are invalid')
    return info
  }
  if (!check(directory, 0o700).isDirectory()) fail('local state must be a private directory')
  const bindingPath = join(directory, 'binding.key')
  let fd
  try {
    fd = openSync(bindingPath, 'wx', 0o600)
    writeFileSync(fd, randomBytes(32)); fsyncSync(fd)
  } catch (error) { if (error.code !== 'EEXIST') throw error }
  finally { if (fd !== undefined) closeSync(fd) }
  if (!check(bindingPath, 0o600).isFile()) fail('binding key must be a private file')
  const bindingKey = readFileSync(bindingPath)
  if (bindingKey.length !== 32) fail('invalid persisted binding key')
  return { bindingKey, ledgerPath: join(directory, 'smoke-ledger.json') }
}

export async function startLocalOwnerServer({ env = process.env, runtimeFactory = gatewayRuntime.createPrincipalPaidGenerationRuntime, serverFactory = startServer,
  profile = { policy: gatewayPricingModule.SMOKE_POLICY, pricing: gatewayPricingModule.PRICING }, stateDirectory, signalHandlers = true } = {}) {
  if (env.BLOCKCRAFT_LOCAL_OWNER_APPROVED !== '1') fail('set BLOCKCRAFT_LOCAL_OWNER_APPROVED=1 in the owner-controlled terminal')
  assertLocalGatewayProfile(profile)
  const portText = env.BLOCKCRAFT_LOCAL_PORT || '3001'
  if (!/^\d{1,5}$/.test(portText)) fail('invalid BLOCKCRAFT_LOCAL_PORT')
  const port = Number(portText)
  if (port < 1 || port > 65535) fail('invalid BLOCKCRAFT_LOCAL_PORT')

  const token = randomBytes(32).toString('base64url')
  const { bindingKey, ledgerPath } = provisionLocalOwnerState(stateDirectory)
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')

  const resolveOpaque = createOpaqueSessionPrincipalResolver({ sessions: [{ sessionHash: tokenHash, principal: 'local-owner', expiresAt: Date.now() + 8 * 60 * 60 * 1000, revoked: false }] })
  // This HTTP cookie is accepted only by this loopback-only entry. The public
  // resolver and its __Host- Secure cookie contract remain unchanged.
  const resolvePrincipal = req => {
    const rawHeaders = [...req.rawHeaders]
    for (let i = 0; i < rawHeaders.length; i += 2) if (rawHeaders[i].toLowerCase() === 'cookie') {
      if (rawHeaders[i + 1].includes('__Host-bc_session=')) return null
      rawHeaders[i + 1] = rawHeaders[i + 1].replace(/(^|;\s*)bc_local_owner=/g, '$1__Host-bc_session=')
    }
    return resolveOpaque({ rawHeaders })
  }
  const started = await serverFactory({
    host: '127.0.0.1', port, env: { ...env, DEEPSEEK_BUDGET_LEDGER_PATH: ledgerPath }, resolvePrincipal, bindingKey,
    principalRuntimeFactory: options => runtimeFactory({ ...options, bindingKey, policy: profile.policy, profile: 'local-smoke' }),
    appServerFactory: options => {
      const server = createAppServer(options)
      const handlers = server.listeners('request')
      server.removeAllListeners('request')
      server.on('request', (req, res) => {
        if (req.headers.host !== `127.0.0.1:${port}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
          res.writeHead(403); res.end(); return
        }
        if (req.url === '/local-owner/start') {
          if (req.method !== 'GET' || (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) ||
              (req.headers['sec-fetch-site'] && !['none', 'same-origin'].includes(req.headers['sec-fetch-site']))) {
            res.writeHead(403); res.end(); return
          }
          res.writeHead(303, { Location: '/ai-create', 'Cache-Control': 'no-store',
            'Set-Cookie': `bc_local_owner=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` })
          res.end(); return
        }
        for (const handler of handlers) handler.call(server, req, res)
      })
      return server
    },
    interactive: {
      enabled: true,
      approval: { providerVerified: true, permissionsVerified: true, reference: 'OWNER-LOCAL-TEST-20261020', maxCalls: 3, expiresAt: Date.now() + 8 * 60 * 60 * 1000 },
      allowedOrigin: `http://127.0.0.1:${port}`,
      resolveAccess: async (_req, { principal }) => ({ sessionId: principal, appId: 'local-owner', readOnly: false }),
    },
  })
  if (started.server.address()?.address !== '127.0.0.1') {
    await started.shutdown()
    fail('server did not bind exclusively to loopback')
  }
  if (signalHandlers) installShutdownHandlers(started.shutdown)
  return started
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startLocalOwnerServer().then(({ server }) => {
    console.info(`BlockCraft AI owner-only local backend listening at http://127.0.0.1:${server.address().port}`)
  }).catch(() => {
    console.error('BlockCraft AI owner-only local backend refused to start. Check local policy and configuration.')
    process.exitCode = 1
  })
}
