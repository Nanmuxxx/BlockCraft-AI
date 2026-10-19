import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { build, initialize } from 'esbuild-wasm'
import { createSafeViewerService } from '../../server/safe-viewer/index.mjs'
import { hostCsp } from '../../server/safe-viewer/policy.mjs'
import { createFixtures } from './fixtures.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../..')
let esbuildReady

async function ensureEsbuild() {
  esbuildReady ??= initialize()
  await esbuildReady
}

async function clientBundle() {
  await ensureEsbuild()
  const result = await build({
    entryPoints: [path.join(root, 'src/integrations/safe-viewer/client.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
  })
  return result.outputFiles[0].contents
}

export async function start({
  hostName = '127.0.0.1',
  runnerHostNames = ['127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.5', '127.0.0.6', '127.0.0.7'],
  serviceOptions = {},
} = {}) {
  const fixtures = await createFixtures()
  const service = createSafeViewerService({ enabled: true, ...serviceOptions })
  const client = await clientBundle()
  const hostSource = await readFile(path.join(directory, 'host.html'), 'utf8')
  const hostScript = await readFile(path.join(directory, 'host.js'), 'utf8')
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://host.invalid')
      if (url.pathname.startsWith('/runner') || url.pathname === '/api/safe-viewer/compile' || url.pathname === '/api/safe-viewer/retire') {
        return await service.handleRequest(req, res)
      }
      if (url.pathname === '/fixtures.json') {
        const text = JSON.stringify(fixtures)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
        return res.end(text)
      }
      if (url.pathname === '/api/safe-viewer/config') {
        const text = JSON.stringify({ runnerOrigins })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
        return res.end(text)
      }
      if (url.pathname === '/client.js') {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store', 'content-length': client.byteLength })
        return res.end(client)
      }
      if (url.pathname === '/host.js') {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(hostScript) })
        return res.end(hostScript)
      }
      if (url.pathname === '/api/safe-viewer/stats') {
        const text = JSON.stringify({ ...service.stats(), runnerCookieHeaders: stats.runnerCookieHeaders })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) })
        return res.end(text)
      }
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        return res.end('{"ok":true}')
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const body = hostSource
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': hostCsp(hostOrigin, runnerOrigins),
          'content-length': Buffer.byteLength(body),
          'x-content-type-options': 'nosniff',
        })
        return res.end(body)
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('server error')
    }
  })
  const stats = { runnerCookieHeaders: 0 }
  server.on('request', req => {
    if (req.url?.startsWith('/runner') && req.headers.cookie) stats.runnerCookieHeaders++
  })
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
  const port = server.address().port
  const hostOrigin = `http://${hostName}:${port}`
  const runnerOrigins = runnerHostNames.map(name => `http://${name}:${port}`)
  service.setOrigins({ parentOrigin: hostOrigin, runnerOrigins })
  await service.ready()
  return Object.freeze({
    hostOrigin,
    runnerOrigins,
    runnerOrigin: runnerOrigins[0],
    fixtures,
    service,
    stats,
    async stop() {
      await service.dispose()
      await new Promise(resolve => server.close(resolve))
    },
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const running = await start()
  process.stdout.write(JSON.stringify({ host: running.hostOrigin, runners: running.runnerOrigins }) + '\n')
  const close = async () => { await running.stop(); process.exit(0) }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}
