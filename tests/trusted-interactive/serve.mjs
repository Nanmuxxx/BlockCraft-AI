// Explicit local OFFLINE demo, never reads .env or uses a real API credential.
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createAppServer } from '../../server/index.mjs'
const origin = 'http://127.0.0.1:5198'
const spec = JSON.parse(readFileSync(new URL('./pomodoro.json', import.meta.url)))
const server = createAppServer({ apiKey: 'offline-only', model: 'offline-fixture-model',
  fetchImpl: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec) } }] }),
  interactive: { enabled: true, allowedOrigin: origin,
    approval: { providerVerified: true, permissionsVerified: true, reference: 'OFFLINE-ONLY-NOT-PAID-APPROVAL', maxCalls: 20, expiresAt: Date.now() + 3600000 },
    resolveAccess: async req => ['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ? { sessionId: 'local-fixture', appId: 'fixture', readOnly: false } : null,
    reserveBudget: async () => true,
  },
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const root = fileURLToPath(new URL('../../', import.meta.url))
const vite = await createServer({ root, server: { host: '127.0.0.1', port: 5198, strictPort: true,
  fs: { allow: [root, fileURLToPath(new URL('../../node_modules', import.meta.url))] },
  proxy: { '/api': { target: `http://127.0.0.1:${server.address().port}`, changeOrigin: false } },
} })
await vite.listen()
console.info(`OFFLINE ONLY, fixed 25-minute JSON, zero paid requests: ${origin}/tests/trusted-interactive/index.html`)
async function stop() { await vite.close(); server.closeAllConnections(); server.close(); process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
