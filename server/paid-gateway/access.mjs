import { timingSafeEqual, createHash } from 'node:crypto'
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const digest = value => createHash('sha256').update(value).digest()
export function createLocalAccess(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('ACCESS_CONFIGURATION')
  const expected = digest('Bearer ' + token)
  return req => loopback.has(req.socket.remoteAddress)
    && typeof req.headers.authorization === 'string'
    && req.headers.authorization.length <= 100
    && timingSafeEqual(digest(req.headers.authorization), expected)
}

// Bounded asynchronous auth; disconnect/timeout cannot admit a late callback.
export async function authorizeGeneration(req, res, resolveAccess) {
  if (typeof resolveAccess !== 'function') return false
  const controller = new AbortController()
  const abort = () => controller.abort()
  res.once('close', abort)
  const timer = setTimeout(abort, 2000)
  try {
    if (res.destroyed) return false
    const result = await Promise.race([
      Promise.resolve().then(() => resolveAccess(req, { signal: controller.signal })),
      new Promise(resolve => controller.signal.addEventListener('abort', () => resolve(false), { once: true })),
    ])
    return !controller.signal.aborted && !res.destroyed && result === true
  } catch { return false }
  finally { clearTimeout(timer); res.off('close', abort); controller.abort() }
}
