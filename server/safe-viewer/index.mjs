import { randomBytes } from 'node:crypto'
import { json as protocolJson, protocol } from '../custom-block/protocol.mjs'
import { assertSafeSource } from './source-policy.mjs'
import { createCompiler, createProcessRegistry } from './compile.mjs'
import {
  LIMITS, PERMISSIONS_POLICY, SAFE_VIEWER_HEADERS, SafeViewerError, VIEWER_PROTOCOL,
  boundedString, check, exactKeys, hostCsp, isPlainRecord, normalizeOrigin, runnerCsp, safeMessage,
} from './policy.mjs'

const jsonLimits = Object.freeze({ ...protocol.JSON_LIMITS, maxBytes: LIMITS.requestBytes })

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    ...SAFE_VIEWER_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

function fail(res, error) {
  const code = error && typeof error.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'VIEWER_ERROR'
  const status = {
    VIEWER_DISABLED: 503,
    INVALID_REQUEST: 400,
    INVALID_ORIGIN: 403,
    ORIGIN_REJECTED: 403,
    CONTENT_TYPE_REJECTED: 415,
    REQUEST_TOO_LARGE: 413,
    COMPILER_BUSY: 429,
    COMPILE_TIMEOUT: 504,
    COMPILE_CANCELLED: 499,
    COMPILER_TERMINATION_FAILED: 503,
    COMPILER_QUARANTINED: 503,
    COMPILER_CONFIGURATION: 503,
    RUNNER_CAPACITY: 503,
    SESSION_EXPIRED: 404,
    NOT_FOUND: 404,
  }[code] ?? 422
  json(res, status, { error: { code, message: error instanceof SafeViewerError ? safeMessage(error) : '安全校验失败' } })
}

function htmlEscape(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function runnerHtml(session) {
  const nonce = htmlEscape(session.nonce)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="blockcraft-parent-origin" content="${htmlEscape(session.parentOrigin)}">
  <meta name="blockcraft-session" content="${htmlEscape(session.id)}">
  <meta name="blockcraft-nonce" content="${nonce}">
  <title>BlockCraft 隔离运行器</title>
  <style nonce="${nonce}">:root{color-scheme:light}html,body,#root{margin:0;min-height:100%;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}body{padding:12px;box-sizing:border-box;background:#fffdf9;color:#2d241f}button,input,select,textarea{font:inherit}[role=alert]{padding:12px;border:1px solid #d9b8a3;border-radius:10px;background:#fff3ea}</style>
</head>
<body>
  <div id="root" data-safe-viewer-root></div>
  <script type="module" src="${htmlEscape(session.bundlePath)}" nonce="${nonce}"></script>
</body>
</html>`
}

async function readJson(req, maxBytes) {
  const length = req.headers['content-length']
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new SafeViewerError('REQUEST_TOO_LARGE', 'Request body is too large')
  }
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.byteLength
    check(bytes <= maxBytes, 'REQUEST_TOO_LARGE', 'Request body is too large')
    chunks.push(chunk)
  }
  check(bytes > 0, 'INVALID_REQUEST', 'Empty request body')
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) } catch {
    throw new SafeViewerError('INVALID_REQUEST', 'Request body is not UTF-8')
  }
  try { return JSON.parse(text) } catch {
    throw new SafeViewerError('INVALID_REQUEST', 'Request body is not JSON')
  }
}

function contentIsJson(req) {
  const value = req.headers['content-type'] ?? ''
  return /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value)
}

function requestHost(req) {
  const host = req.headers.host
  check(typeof host === 'string' && host.length <= 256, 'ORIGIN_REJECTED', 'Missing Host')
  return host
}

export function createSafeViewerService({
  enabled = false,
  parentOrigins = [],
  runnerOrigin = null,
  runnerOrigins = [],
  compileTimeoutMs = LIMITS.compileTimeoutMs,
  sessionTtlMs = LIMITS.sessionTtlMs,
  maxSessions = LIMITS.sessions,
  processRegistry = createProcessRegistry(),
} = {}) {
  const parentSet = new Set(parentOrigins.map(normalizeOrigin))
  let runnerPool = (runnerOrigins.length ? runnerOrigins : runnerOrigin ? [runnerOrigin] : []).map(normalizeOrigin)
  const quarantined = new Set()
  let runnerCursor = 0
  let disposed = false
  const sessions = new Map()
  const compiler = createCompiler({ compileTimeoutMs, processRegistry })
  const stats = {
    compiles: 0,
    failures: 0,
    sessionsCreated: 0,
    sessionsExpired: 0,
    runnerRequests: 0,
    bundleRequests: 0,
    cacheHits: 0,
    cacheBuilds: 0,
    runnerCookieHeaders: 0,
    runnerRetired: 0,
  }

  function ensureReady() {
    check(!disposed, 'VIEWER_DISPOSED', 'Viewer service disposed')
    check(enabled === true, 'VIEWER_DISABLED', 'Safe viewer is disabled')
    check(runnerPool.length > 0, 'VIEWER_NOT_CONFIGURED', 'Runner origins are not configured')
  }

  function nextRunner() {
    const available = runnerPool.filter(origin => !quarantined.has(origin))
    check(available.length > 0, 'RUNNER_CAPACITY', 'No healthy runner origin is available')
    const selected = available[runnerCursor % available.length]
    runnerCursor++
    return selected
  }

  function prune() {
    const now = Date.now()
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) { sessions.delete(id); stats.sessionsExpired++ }
    }
    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next().value
      if (!oldest) break
      sessions.delete(oldest)
      stats.sessionsExpired++
    }
  }

  function sessionOf(id) {
    prune()
    if (!boundedString(id, 128)) throw new SafeViewerError('SESSION_EXPIRED', 'Viewer session is unavailable')
    const session = sessions.get(id)
    if (!session || session.expiresAt <= Date.now()) throw new SafeViewerError('SESSION_EXPIRED', 'Viewer session is unavailable')
    return session
  }

  function requestMeta(req) {
    const origin = req.headers.origin
    check(typeof origin === 'string' && parentSet.has(origin), 'ORIGIN_REJECTED', 'Request origin is not allowed')
    check(origin === `http://${requestHost(req)}` || origin === `https://${requestHost(req)}`, 'ORIGIN_REJECTED', 'Origin and Host do not match')
    const site = req.headers['sec-fetch-site']
    check(site === undefined || site === 'same-origin', 'ORIGIN_REJECTED', 'Cross-site compile request')
    return { origin }
  }

  async function compile(input, meta, { signal } = {}) {
    ensureReady()
    check(meta && parentSet.has(meta.origin), 'ORIGIN_REJECTED', 'Compile origin is not allowed')
    stats.compiles++
    try {
      protocol.assertJson(input, jsonLimits)
      exactKeys(input, ['protocol', 'instance', 'artifact'])
      check(input.protocol === VIEWER_PROTOCOL, 'INVALID_PROTOCOL', 'Unknown viewer protocol')
      const instance = input.instance
      const artifact = input.artifact
      exactKeys(instance, ['id', 'definitionId', 'versionDigest', 'props'])
      protocolJson.id(instance.id)
      protocol.assertArtifactReference({ definitionId: instance.definitionId, versionDigest: instance.versionDigest })
      check(isPlainRecord(instance.props), 'INVALID_REQUEST', 'Props must be a plain object')
      protocol.assertSourceArtifact(artifact)
      check(artifact.manifest.definitionId === instance.definitionId, 'DIGEST_MISMATCH', 'Definition reference does not match artifact')
      check(artifact.manifest.requestedCapabilities.length === 0, 'CAPABILITIES_REJECTED', 'Viewer artifacts cannot request host capabilities')
      check(Object.keys(artifact.manifest.events).length === 0, 'EVENTS_REJECTED', 'Viewer artifacts cannot emit host events')
      const digest = await protocol.computeVersionDigest(artifact)
      check(digest === instance.versionDigest, 'DIGEST_MISMATCH', 'Artifact content digest mismatch')
      protocol.assertObjectSchema(artifact.manifest.propsSchema)
      protocol.assertSchemaValue(artifact.manifest.propsSchema, instance.props)
      assertSafeSource(artifact)
      const result = await compiler.compile({ ...artifact, versionDigest: instance.versionDigest }, { signal })
      const id = randomBytes(24).toString('base64url')
      const nonce = randomBytes(24).toString('base64url')
      const expiresAt = Date.now() + sessionTtlMs
      const selectedRunner = nextRunner()
      const bundlePath = `/runner/bundle/${result.digest.slice(7)}.js?session=${encodeURIComponent(id)}`
      sessions.set(id, Object.freeze({
        id, nonce, expiresAt, parentOrigin: meta.origin, runnerOrigin: selectedRunner,
        bundleDigest: result.digest, bundlePath, versionDigest: instance.versionDigest,
      }))
      stats.sessionsCreated++
      if (result.cache === 'hit') stats.cacheHits++
      else stats.cacheBuilds++
      prune()
      const bundleUrl = `${selectedRunner}${bundlePath}`
      return {
        sessionId: id,
        nonce,
        runnerUrl: `${selectedRunner}/runner?session=${encodeURIComponent(id)}`,
        bundleUrl,
        bundleDigest: result.digest,
        expiresAt,
        cache: result.cache,
      }
    } catch (error) {
      stats.failures++
      throw error
    }
  }

  async function handleCompile(req, res) {
    const controller = new AbortController()
    const cancel = () => { if (!res.writableEnded) controller.abort() }
    res.once('close', cancel)
    try {
      ensureReady()
      check(req.method === 'POST', 'INVALID_REQUEST', 'Compile requires POST')
      const meta = requestMeta(req)
      check(contentIsJson(req), 'CONTENT_TYPE_REJECTED', 'Compile requires application/json')
      const input = await readJson(req, LIMITS.requestBytes)
      if (res.destroyed) return
      const result = await compile(input, meta, { signal: controller.signal })
      json(res, 200, result)
    } catch (error) {
      if (!res.destroyed) fail(res, error)
    } finally { res.off('close', cancel) }
  }

  async function handleRunner(req, res) {
    try {
      ensureReady()
      check(req.method === 'GET', 'INVALID_REQUEST', 'Runner requires GET')
      const requestHostValue = requestHost(req)
      check(runnerPool.some(origin => new URL(origin).host === requestHostValue), 'ORIGIN_REJECTED', 'Runner Host mismatch')
      stats.runnerRequests++
      if (req.headers.cookie) stats.runnerCookieHeaders++
      const url = new URL(req.url, 'http://runner.invalid')
      check(url.pathname === '/runner' || url.pathname === '/runner/', 'NOT_FOUND', 'Unknown runner route')
      check([...url.searchParams.keys()].length === 1 && url.searchParams.has('session'), 'INVALID_REQUEST', 'Invalid runner session')
      const session = sessionOf(url.searchParams.get('session'))
      check(requestHostValue === new URL(session.runnerOrigin).host, 'ORIGIN_REJECTED', 'Runner Host mismatch')
      const body = runnerHtml(session)
      res.writeHead(200, {
        ...SAFE_VIEWER_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Content-Security-Policy': runnerCsp(session.parentOrigin, session.nonce),
        'Permissions-Policy': PERMISSIONS_POLICY,
      })
      res.end(body)
    } catch (error) {
      fail(res, error)
    }
  }

  async function handleBundle(req, res) {
    try {
      ensureReady()
      check(req.method === 'GET', 'INVALID_REQUEST', 'Bundle requires GET')
      const requestHostValue = requestHost(req)
      check(runnerPool.some(origin => new URL(origin).host === requestHostValue), 'ORIGIN_REJECTED', 'Bundle Host mismatch')
      stats.bundleRequests++
      if (req.headers.cookie) stats.runnerCookieHeaders++
      const url = new URL(req.url, 'http://runner.invalid')
      const match = /^\/runner\/bundle\/([0-9a-f]{64})\.js$/.exec(url.pathname)
      check(match, 'NOT_FOUND', 'Unknown bundle')
      check([...url.searchParams.keys()].length === 1 && url.searchParams.has('session'), 'INVALID_REQUEST', 'Invalid bundle session')
      const session = sessionOf(url.searchParams.get('session'))
      check(requestHostValue === new URL(session.runnerOrigin).host, 'ORIGIN_REJECTED', 'Bundle Host mismatch')
      const digest = `sha256:${match[1]}`
      check(session.bundleDigest === digest, 'SESSION_EXPIRED', 'Bundle does not belong to this session')
      const bundle = compiler.cache.byDigest(digest)
      check(bundle, 'SESSION_EXPIRED', 'Bundle is no longer available')
      res.writeHead(200, {
        ...SAFE_VIEWER_HEADERS,
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': bundle.code.byteLength,
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(bundle.code)
    } catch (error) {
      fail(res, error)
    }
  }

  async function handleRetire(req, res) {
    try {
      ensureReady()
      check(req.method === 'POST', 'INVALID_REQUEST', 'Retire requires POST')
      const meta = requestMeta(req)
      check(contentIsJson(req), 'CONTENT_TYPE_REJECTED', 'Retire requires application/json')
      const input = await readJson(req, LIMITS.requestBytes)
      exactKeys(input, ['protocol', 'sessionId'])
      check(input.protocol === VIEWER_PROTOCOL, 'INVALID_PROTOCOL', 'Unknown viewer protocol')
      const session = sessionOf(input.sessionId)
      check(session.parentOrigin === meta.origin, 'ORIGIN_REJECTED', 'Session origin mismatch')
      quarantined.add(session.runnerOrigin)
      sessions.delete(session.id)
      stats.runnerRetired++
      json(res, 200, { retired: true })
    } catch (error) {
      fail(res, error)
    }
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://runner.invalid')
    if (url.pathname === '/api/safe-viewer/compile') return handleCompile(req, res)
    if (url.pathname === '/api/safe-viewer/retire') return handleRetire(req, res)
    if (url.pathname === '/runner') return handleRunner(req, res)
    if (url.pathname.startsWith('/runner/bundle/')) return handleBundle(req, res)
    return fail(res, new SafeViewerError('NOT_FOUND', 'Unknown safe viewer route'))
  }

  async function ready() {
    ensureReady()
    return true
  }

  return Object.freeze({
    enabled: () => enabled === true,
    // Trusted recovery must reuse this registry when replacing the service;
    // a fresh registry cannot prove that an old quarantined tree is retired.
    processRegistry,
    ready,
    compile,
    handleRequest,
    handleCompile,
    handleRunner,
    handleBundle,
    handleRetire,
    setOrigins({ parentOrigin, runnerOrigin, runnerOrigins }) {
      check(!disposed, 'VIEWER_DISPOSED', 'Viewer service disposed')
      const parent = normalizeOrigin(parentOrigin)
      const next = (runnerOrigins?.length ? runnerOrigins : runnerOrigin ? [runnerOrigin] : []).map(normalizeOrigin)
      check(next.length > 0 && new Set(next).size === next.length, 'ORIGIN_REJECTED', 'Runner origins must be unique')
      check(next.every(value => new URL(parent).hostname !== new URL(value).hostname), 'ORIGIN_REJECTED', 'Runner must not share a hostname with the app')
      parentSet.clear(); parentSet.add(parent)
      runnerPool = next
      sessions.clear()
      quarantined.clear()
      runnerCursor = 0
    },
    stats() {
      return Object.freeze({
        ...stats,
        sessions: sessions.size,
        runnerPool: runnerPool.length,
        quarantined: [...quarantined],
        availableRunners: runnerPool.filter(origin => !quarantined.has(origin)).length,
        compiler: compiler.stats(),
      })
    },
    dispose() {
      if (disposed) return Promise.resolve()
      disposed = true
      sessions.clear()
      quarantined.clear()
      return compiler.dispose()
    },
  })
}

export { LIMITS, hostCsp, runnerCsp, VIEWER_PROTOCOL }
