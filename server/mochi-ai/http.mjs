import { LIMITS, MochiError } from '../../src/integrations/mochi-ai/protocol.mjs'
import { abortable } from '../ai-abort.mjs'
const PATHS = new Set(['/api/mochi-ai/analyze', '/api/mochi-ai/consent', '/api/mochi-ai/ignore', '/api/mochi-ai/status'])
function send(res, status, data) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
}
async function read(req) {
  let size = 0; const chunks = []
  const timer = setTimeout(() => req.destroy(), 10_000)
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > LIMITS.requestBytes) throw new MochiError('INPUT_TOO_LARGE', '请求过大。', 413)
      chunks.push(chunk)
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
    catch { throw new MochiError('INVALID_INPUT', '请求必须是 JSON。') }
  } finally { clearTimeout(timer) }
}
/** Returns false for unrelated routes. No automatic registration or standalone listener.
 * allowedOrigin is deployment-owned (supports HTTPS); never infer it from untrusted Host.
 */
export function createMochiHandler({ service, resolveAccess, allowedOrigin, accessTimeoutMs = 5000 } = {}) {
  if (!Number.isFinite(accessTimeoutMs) || accessTimeoutMs <= 0 || accessTimeoutMs > 5000) throw new RangeError('Access deadline must be within 1–5000ms')
  const ingress = new Map()
  return async (req, res) => {
    if (!PATHS.has(req.url)) return false
    const controller = new AbortController()
    const close = () => { if (!res.writableEnded) controller.abort() }; res.on('close', close)
    const aborted = () => controller.abort(); req.on('aborted', aborted)
    if (req.aborted || res.destroyed) controller.abort()
    try {
      // Public disabled status contains no session/project or authorization data.
      // It lets the real Workshop explain deployment blockers without fake auth.
      if (req.url.endsWith('/status') && req.method === 'GET' && (!allowedOrigin || typeof resolveAccess !== 'function')) {
        send(res, 200, { enabled: false, proactiveEnabled: false, modificationsEnabled: false, reason: 'ACCESS_UNAVAILABLE' }); return true
      }
      if (!allowedOrigin || typeof resolveAccess !== 'function') throw new MochiError('AI_DISABLED', 'Mochi AI 尚未配置可信访问权限。', 503)
      if (req.headers.origin && req.headers.origin !== allowedOrigin) throw new MochiError('ORIGIN_REJECTED', '不允许跨来源请求。', 403)
      const expectedMethod = req.url.endsWith('/status') ? 'GET' : 'POST'
      if (req.method !== expectedMethod) throw new MochiError('METHOD_NOT_ALLOWED', '请求方法无效。', 405)
      const clock = Date.now()
      for (const [key, value] of ingress) if (value.reset <= clock) ingress.delete(key)
      const key = req.socket.remoteAddress
      if (!ingress.has(key)) {
        if (ingress.size >= 1000) throw new MochiError('SERVER_BUSY', '服务繁忙。', 503)
        ingress.set(key, { count: 0, reset: clock + 60_000 })
      }
      if (++ingress.get(key).count > 60) throw new MochiError('THROTTLED', '请求过于频繁。', 429)
      controller.signal.throwIfAborted()
      const deadline = setTimeout(() => controller.abort(new MochiError('ACCESS_UNAVAILABLE', 'Mochi AI 可信访问权限暂不可用。', 503)), accessTimeoutMs)
      let access
      try { access = await abortable(Promise.resolve(resolveAccess(req, { signal: controller.signal })), controller.signal) }
      finally { clearTimeout(deadline) }
      if (!access) throw new MochiError('UNAUTHORIZED', '请先建立可信应用会话。', 401)
      controller.signal.throwIfAborted()
      if (expectedMethod === 'GET') { send(res, 200, service.status(access)); return true }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new MochiError('UNSUPPORTED_MEDIA_TYPE', '请使用 JSON。', 415)
      if (Number(req.headers['content-length']) > LIMITS.requestBytes) throw new MochiError('INPUT_TOO_LARGE', '请求过大。', 413)
      const input = await read(req)
      controller.signal.throwIfAborted()
      const data = req.url.endsWith('/analyze') ? await service.analyze(access, input, { signal: controller.signal }) :
        req.url.endsWith('/consent') ? service.consent(access, input) : service.ignore(access, input)
      send(res, 200, data)
    } catch (error) {
      const safe = error instanceof MochiError ? error : controller.signal.aborted ? new MochiError('CANCELLED', '已取消请求。', 499) : new MochiError('INTERNAL_ERROR', 'Mochi 暂时无法回答。', 500)
      send(res, safe.status, { error: { code: safe.code, message: safe.message } })
    } finally { res.off('close', close); req.off('aborted', aborted) }
    return true
  }
}
