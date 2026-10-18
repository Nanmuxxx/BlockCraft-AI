import { timingSafeEqual } from 'node:crypto'

export const EXPORT_PATH = '/api/local-project-export'
export const MAX_BODY_BYTES = 4_000_000
const loopback = address => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
const safeCode = code => typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : 'EXPORT_FAILED'

/** Local single-user packaging capability, NOT cloud identity/project ACL.
 * No server project store, filesystem inputs, URLs or global registry are read.
 */
export function createLocalExportHandler({ token, origin }) {
  let busy = false
  return async (req, res) => {
    const fail = (status, code) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify({ code }))
    }
    if (req.url !== EXPORT_PATH) return fail(404, 'NOT_FOUND')
    const supplied = req.headers.authorization ?? ''
    const expected = `Bearer ${token}`
    const suppliedBytes = Buffer.from(supplied)
    const expectedBytes = Buffer.from(expected)
    if (!loopback(req.socket.remoteAddress) || req.headers.host !== new URL(origin).host || req.headers.origin !== origin ||
      suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return fail(403, 'EXPORT_UNAUTHORIZED')
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED')
    if (req.headers['content-type'] !== 'application/json' || req.headers['content-encoding']) return fail(415, 'INVALID_CONTENT_TYPE')
    if (busy) return fail(429, 'EXPORT_BUSY')
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) return fail(413, 'INPUT_LIMIT')
    busy = true
    const timeout = setTimeout(() => req.destroy(), 30_000)
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > MAX_BODY_BYTES) { fail(413, 'INPUT_LIMIT'); return }
        chunks.push(chunk)
      }
      let input
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
      catch { return fail(400, 'INVALID_INPUT') }
      // The #30 exporter validates the complete snapshot and every exact digest.
      // Its output is buffered in full before any successful response headers.
      const { exportProjectZip } = await import('../../tools/project-zip-export/export.mjs')
      const result = await exportProjectZip(input)
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${result.filename}"`,
        'Content-Length': result.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(result.bytes)
    } catch (error) {
      if (!res.headersSent && !res.destroyed) fail(422, safeCode(error?.code))
    } finally { clearTimeout(timeout); busy = false }
  }
}
