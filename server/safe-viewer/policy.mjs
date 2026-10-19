export const VIEWER_PROTOCOL = 'blockcraft-safe-viewer/1'
export const VIEWER_SDK = '1.0.0'
export const POLICY_VERSION = 'safe-tsx-viewer/1'

export const LIMITS = Object.freeze({
  requestBytes: 512 * 1024,
  responseBytes: 64 * 1024,
  sourceFiles: 8,
  sourceFileBytes: 65_536,
  sourceBytes: 262_144,
  sourceTokens: 24_000,
  sourceNesting: 96,
  bundleBytes: 524_288,
  compileTimeoutMs: 5_000,
  compileConcurrency: 2,
  cacheEntries: 32,
  cacheBytes: 8 * 1024 * 1024,
  sessionTtlMs: 60_000,
  sessions: 64,
  messageBytes: 16_384,
  messageString: 1_024,
})

export const IMPORT_ALLOWLIST = Object.freeze(['react', 'react/jsx-runtime'])

export const FORBIDDEN_GLOBAL_NAMES = Object.freeze([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'RTCPeerConnection',
  'RTCDataChannel', 'Worker', 'SharedWorker', 'ServiceWorker', 'localStorage',
  'sessionStorage', 'indexedDB', 'caches', 'cookieStore', 'sendBeacon', 'eval',
  'Function', 'WebAssembly', 'importScripts', 'postMessage', 'BroadcastChannel',
  'parent', 'top', 'opener', 'location',
])

export const FORBIDDEN_GLOBAL_PROPERTIES = Object.freeze([
  ...FORBIDDEN_GLOBAL_NAMES, 'serviceWorker', 'clipboard', 'geolocation',
  'mediaDevices', 'getUserMedia', 'open', 'print', 'close', 'cookie', 'location',
])

export const FORBIDDEN_GLOBALS = Object.freeze([
  'window', 'globalThis', 'self', 'document', 'navigator', 'parent', 'top', 'opener',
])

export const SAFE_VIEWER_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Origin-Agent-Cluster': '?1',
  'Cross-Origin-Opener-Policy': 'same-origin',
})

export const PERMISSIONS_POLICY = [
  'accelerometer=()', 'autoplay=()', 'camera=()', 'clipboard-read=()',
  'clipboard-write=()', 'display-capture=()', 'encrypted-media=()',
  'fullscreen=()', 'geolocation=()', 'gyroscope=()', 'hid=()',
  'idle-detection=()', 'magnetometer=()', 'microphone=()', 'midi=()',
  'payment=()', 'picture-in-picture=()', 'publickey-credentials-get=()',
  'screen-wake-lock=()', 'serial=()', 'usb=()',
  'xr-spatial-tracking=()',
].join(', ')

export class SafeViewerError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'SafeViewerError'
    this.code = code
  }
}

export function check(condition, code, message = code) {
  if (!condition) throw new SafeViewerError(code, message)
}

export function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function exactKeys(value, required) {
  check(isPlainRecord(value), 'INVALID_REQUEST')
  const keys = Object.keys(value)
  check(keys.length === required.length && required.every(key => Object.prototype.hasOwnProperty.call(value, key)), 'INVALID_REQUEST')
}

export function boundedString(value, max = LIMITS.messageString) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

export function normalizeOrigin(value) {
  check(typeof value === 'string' && value.length <= 256, 'INVALID_ORIGIN', 'Invalid origin')
  let url
  try { url = new URL(value) } catch { throw new SafeViewerError('INVALID_ORIGIN', 'Invalid origin') }
  check((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'INVALID_ORIGIN', 'Origin must be a bare http(s) origin')
  return url.origin
}

export function runnerCsp(parentOrigin, nonce) {
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    'img-src data:',
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${parentOrigin}`,
  ].join('; ')
}

export function hostCsp(parentOrigin, runnerOrigins) {
  const origins = Array.isArray(runnerOrigins) ? runnerOrigins : [runnerOrigins]
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    `frame-src ${origins.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

export function safeMessage(error) {
  if (!(error instanceof Error)) return '操作失败'
  const text = error.message.replace(/[\r\n\t]+/g, ' ').trim()
  return text.length > 0 && text.length <= 300 ? text : '操作失败'
}
