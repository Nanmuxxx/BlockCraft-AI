import { randomBytes } from 'node:crypto'
import { createLocalExportHandler, EXPORT_PATH } from './local-http.mjs'

const moduleId = 'virtual:local-project-export'
/** Deliberately dev-only and opt-in. Production and normal dev expose no handler. */
export function localProjectExportPlugin() {
  let enabled = false
  const token = randomBytes(32).toString('hex')
  return {
    name: 'blockcraft-local-project-export',
    configResolved(config) {
      enabled = config.command === 'serve' && !config.isPreview && config.mode === 'local-export'
      if (enabled && (config.server.host !== '127.0.0.1' || !config.server.strictPort || config.server.https)) {
        throw new Error('Local export requires explicit HTTP 127.0.0.1 binding and strictPort')
      }
    },
    config(_config, env) {
      if (env.command === 'serve' && env.mode === 'local-export') return { server: { cors: false } }
    },
    resolveId(id) { if (id === moduleId) return `\0${moduleId}` },
    load(id) { if (id === `\0${moduleId}`) return `export const localExportToken = ${JSON.stringify(enabled ? token : null)};` },
    configureServer(server) {
      if (!enabled) return
      const origin = `http://127.0.0.1:${server.config.server.port}`
      const handler = createLocalExportHandler({ token, origin })
      server.middlewares.use((req, res, next) => {
        // Guard the whole dedicated dev surface against rebinding and cross-origin
        // reads of the ephemeral module; capability never enters a public bundle.
        if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
          !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress)) {
          res.writeHead(403); res.end('LOCAL_ONLY'); return
        }
        if (req.url?.split('?')[0] === EXPORT_PATH) { void handler(req, res); return }
        next()
      })
    },
  }
}
