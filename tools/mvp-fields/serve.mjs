import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { createAppServer } from '../../server/index.mjs'
import { createLocalAccess } from '../../server/paid-gateway/access.mjs'
import { createPaidTransport } from '../../server/paid-gateway/provider.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { PRICING, POLICY } from '../../server/paid-gateway/pricing.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** Loopback composition only. The bearer stays in this process and proxy. */
export async function startMvpServer({ live = false, fixture = false, port = 0, fetchImpl } = {}) {
  if (live && fetchImpl) throw new Error('LIVE_TRANSPORT_MUST_BE_NATIVE')
  if (!live && typeof fetchImpl !== 'function') throw new Error('EXPLICIT_OFFLINE_TRANSPORT_REQUIRED')
  let ledger, api, vite
  const token = randomBytes(32).toString('hex'), access = createLocalAccess(token)
  let apiKey = 'offline-mvp-fixture-key'
  if (live) {
    // Git's common directory is canonical across all worktrees. Never reset or
    // copy this approval ledger to get extra attempts or reservations.
    const common = resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim())
    if (!process.env.DEEPSEEK_API_KEY) process.loadEnvFile(resolve(common, '../server/.env'))
    apiKey = process.env.DEEPSEEK_API_KEY?.trim()
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY_REQUIRED')
    const privateDir = resolve(common, 'ai-private', POLICY.approval)
    mkdirSync(privateDir, { recursive: true, mode: 0o700 })
    ledger = openLedger(resolve(privateDir, 'ledger.json'))
    fetchImpl = createPaidTransport({ apiKey, ledger })
  }
  const audit = () => {
    const entries = ledger?.snapshot().entries ?? []
    return { source: live ? 'deepseek' : 'offline-fixture', model: live ? PRICING.model : 'offline',
      approval: POLICY.approval, userLimitCny: 5, reservationLimitCny: POLICY.conservativeNano / 1e9,
      calls: entries.length, maxCalls: POLICY.maxCalls, halted: ledger?.snapshot().halted ?? false,
      estimatedCny: entries.reduce((n, e) => n + (e.estimatedNano ?? 0), 0) / 1e9,
      reservedCny: entries.reduce((n, e) => n + e.reserveNano, 0) / 1e9,
      entries: entries.map(({ id, status, usage, reserveNano, estimatedNano }) => ({ id, status, usage, reservedCny: reserveNano / 1e9, estimatedCny: estimatedNano === undefined ? null : estimatedNano / 1e9 })) }
  }
  try {
    api = createAppServer({ apiKey, fetchImpl, model: live ? PRICING.model : 'offline', generationAccess: access,
      fieldPlanning: { enabled: true, resolveAccess: access } })
    api.listen(0, '127.0.0.1'); await once(api, 'listening')
    let origin = ''
    vite = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true,
      proxy: { '/api': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: false,
        configure(proxy) { proxy.on('proxyReq', request => request.setHeader('Authorization', 'Bearer ' + token)) } } } },
      plugins: [{ name: 'authorized-local-mvp', configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)
            || req.headers['sec-fetch-site'] === 'cross-site') {
            res.writeHead(403); res.end('LOCAL_ORIGIN_REQUIRED'); return
          }
          const path = (req.url || '').split('?')[0]
          if (path === '/api/mvp-audit' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(audit())); return
          }
          if (fixture && path === '/__field-plans' && req.method === 'GET') {
            void server.transformIndexHtml(path, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/field-plans/fixture.tsx"></script></body></html>')
              .then(html => { res.setHeader('Content-Type', 'text/html'); res.end(html) }).catch(next)
            return
          }
          next()
        })
      } }] })
    await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`
    return { origin, audit, async close() { await vite.close(); await new Promise(r => { api.closeAllConnections(); api.close(r) }); ledger?.close() } }
  } catch (error) { await vite?.close(); api?.closeAllConnections(); api?.close(); ledger?.close(); throw error }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv.includes('--live')) throw new Error('EXPLICIT_LIVE_FLAG_REQUIRED')
  const server = await startMvpServer({ live: true, fixture: process.argv.includes('--fixture'), port: Number(process.env.MVP_PORT || 5199) })
  console.log(JSON.stringify({ url: server.origin + '/ai-create', fixtureUrl: process.argv.includes('--fixture') ? server.origin + '/__field-plans?generate' : null, budget: server.audit() }))
  let closing = false
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (closing) return; closing = true
    console.log(JSON.stringify({ finalBudget: server.audit() })); await server.close()
  })
}
