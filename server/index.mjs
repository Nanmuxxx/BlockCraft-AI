import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { abortable } from './ai-abort.mjs'
import { authorizeGeneration } from './paid-gateway/access.mjs'
import { requireControlledEgress } from './paid-gateway/egress.mjs'
import { isPaidTransport, defaultModelForTransport, maxOutputTokensForTransport } from './paid-gateway/provider.mjs'
import * as paidRuntimeModule from './paid-gateway/runtime.mjs'
import { buildInteractiveMessages, assertInteractiveSpec, createInteractiveGate } from './trusted-interactive.mjs'
import { createServer } from 'node:http'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createMochiPlanHandler } from './mochi-plan.mjs'
import { createMochiIntegration } from './mochi-ai/index.mjs'
import { assertAppSpec } from './.generated/appSpecValidation.js'
import { buildGenerationMessages } from './aiGenerationPrompt.mjs'
import { checkGeneratedApplication } from './aiGenerationQuality.mjs'

export const LIMITS = Object.freeze({
  ideaChars: 4000,
  requestBytes: 24 * 1024,
  upstreamBytes: 128 * 1024,
  outputBytes: 64 * 1024,
  inputTimeoutMs: 10_000,
  aiTimeoutMs: 30_000,
  requestsPerMinute: 10,
  concurrentRequests: 4,
  rateLimitEntries: 10_000,
})
const ENDPOINT = 'https://api.deepseek.com/chat/completions'
const GATEWAY_UNAVAILABLE = new Set([
  'API_CONFIGURATION', 'LEDGER_UNAVAILABLE', 'LEDGER_LOCKED', 'LEDGER_INVALID',
  'BUDGET_EXHAUSTED', 'BUDGET_HALTED', 'PRICING_EXPIRED', 'CONCURRENCY_LIMIT',
  'EGRESS_DENIED', 'IDENTITY_ADAPTER_REQUIRED',
])

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const fail = (status, code, message) => new HttpError(status, code, message)

function send(res, status, value, extra = {}) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Connection': 'close',
    ...extra,
  })
  res.end(JSON.stringify(value))
}

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
})
const PAGE_PATHS = new Set(['/', '/ai-create', '/app-renderer', '/demo'])

function requestPath(url) {
  const pathname = (url || '/').split('?')[0]
  let decoded
  try { decoded = decodeURIComponent(pathname) }
  catch { throw fail(400, 'INVALID_PATH', '资源路径无效。') }
  if (/%2f|%5c/i.test(pathname) || !decoded.startsWith('/') || decoded.includes('//') ||
      /[\\\x00-\x1f\x7f:%?#]/.test(decoded) ||
      decoded.split('/').some(part => part.startsWith('.') || /[. ]$/.test(part))) {
    throw fail(400, 'INVALID_PATH', '资源路径无效。')
  }
  return decoded
}

function staticPath(staticDir, pathname) {
  const root = resolve(staticDir)
  const candidate = resolve(root, `.${pathname}`)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null
  return candidate
}

async function serveStatic(req, res, staticDir, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const candidate = staticPath(staticDir, pathname)
  if (!candidate) {
    send(res, 400, { error: { code: 'INVALID_PATH', message: '资源路径无效。' } })
    return true
  }
  let filePath = candidate
  let fileInfo, contents
  try {
    if (PAGE_PATHS.has(pathname)) filePath = resolve(staticDir, 'index.html')
    const [root, target] = await Promise.all([realpath(staticDir), realpath(filePath)])
    const inside = relative(root, target)
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw fail(404, 'NOT_FOUND', '资源不存在。')
    }
    filePath = target
    fileInfo = await stat(filePath)
    if (!fileInfo.isFile()) throw fail(404, 'NOT_FOUND', '资源不存在。')
    if (req.method === 'GET') contents = await readFile(filePath)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw fail(404, 'NOT_FOUND', '资源不存在。')
    throw error
  }
  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
  const headers = {
    'Content-Type': contentType,
    'Content-Length': String(contents?.length ?? fileInfo.size),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Connection': 'close',
  }
  res.writeHead(200, headers)
  res.end(contents)
  return true
}

function readInput(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    const cleanup = () => {
      clearTimeout(timer)
      req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAborted)
    }
    const stop = error => { cleanup(); req.resume(); reject(error) }
    const onError = () => stop(fail(400, 'INVALID_INPUT', '无法读取请求。'))
    const onAborted = () => stop(fail(400, 'INVALID_INPUT', '请求已中断。'))
    const onData = chunk => {
      size += chunk.length
      if (size > LIMITS.requestBytes) stop(fail(413, 'INPUT_TOO_LARGE', '请求体过大。'))
      else chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))) }
      catch { reject(fail(400, 'INVALID_INPUT', '请求必须为有效 JSON。')) }
    }
    const timer = setTimeout(() => stop(fail(408, 'INPUT_TIMEOUT', '读取请求超时。')), LIMITS.inputTimeoutMs)
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAborted)
  })
}

async function readUpstream(response, controller) {
  if (Number(response.headers.get('content-length')) > LIMITS.upstreamBytes) {
    throw fail(502, 'AI_OUTPUT_TOO_LARGE', 'AI 响应超过大小限制。')
  }
  if (!response.body) throw fail(502, 'AI_INVALID_RESPONSE', 'AI 返回了无效响应。')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), controller.signal)
      if (done) break
      size += value.byteLength
      if (size > LIMITS.upstreamBytes) {
        controller.abort()
        throw fail(502, 'AI_OUTPUT_TOO_LARGE', 'AI 响应超过大小限制。')
      }
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}

async function generate(idea, { apiKey, model, fetchImpl, aiTimeoutMs, maxOutputTokens, interactive = false, principalMode = false }, res) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, aiTimeoutMs)
  const onClose = () => { if (!res.writableEnded) controller.abort() }
  res.on('close', onClose)
  if (res.destroyed) controller.abort()
  let received
  try {
    controller.signal.throwIfAborted()
    requireControlledEgress(fetchImpl)
    const fetching = Promise.resolve(fetchImpl(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: interactive ? buildInteractiveMessages(idea) : buildGenerationMessages(idea),
        response_format: { type: 'json_object' },
        stream: false,
        max_tokens: principalMode ? (interactive ? 2048 : maxOutputTokens ?? 4096) : maxOutputTokensForTransport(fetchImpl) ?? 8192,
      }),
    }))
    // A late response after timeout/disconnect must release its unused body.
    void fetching.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}) }).catch(() => {})
    const response = received = await abortable(fetching, controller.signal)
    if (!response.ok) throw fail(502, 'AI_UNAVAILABLE', 'AI 服务暂时不可用，请稍后重试。')
    const envelope = await readUpstream(response, controller)
    const choice = envelope?.choices?.[0]
    const content = choice?.message?.content
    // A successful JSON completion must be unambiguous. Never accept tool or
    // refusal envelopes merely because they also contain plausible AppSpec text.
    if (!Array.isArray(envelope?.choices) || envelope.choices.length !== 1
      || choice?.finish_reason !== 'stop' || typeof content !== 'string'
      || (choice.message.role !== undefined && choice.message.role !== 'assistant')
      || (choice.message.refusal !== undefined && choice.message.refusal !== null)
      || choice.message.tool_calls !== undefined || choice.message.function_call !== undefined
      || envelope.error !== undefined) {
      throw fail(502, 'AI_INVALID_RESPONSE', 'AI 未返回完整的 JSON 结果。')
    }
    if (Buffer.byteLength(content) > LIMITS.outputBytes) throw fail(502, 'AI_OUTPUT_TOO_LARGE', 'AI 结果超过大小限制。')
    let spec
    try { spec = JSON.parse(content); assertAppSpec(spec); if (interactive) assertInteractiveSpec(spec); else if (spec.version !== 1) throw new Error('Legacy generation requires v1') }
    catch { throw fail(502, 'AI_INVALID_SPEC', 'AI 结果不符合 AppSpec 协议，请重试。') }
    if (interactive) return spec
    const quality = checkGeneratedApplication(spec, { idea })
    if (!quality.completeness.valid) {
      throw fail(502, 'AI_INCOMPLETE_APP', 'AI 生成的应用不完整，缺少可操作的实体、字段或录入入口，请重试。')
    }
    // Acceptance here means runnable structure only. needs-review is not a
    // requirements-satisfied verdict; no independent semantic review is run.
    return spec
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (timedOut) throw fail(504, 'AI_TIMEOUT', 'AI 服务响应超时，请稍后重试。')
    if (principalMode) throw principalGatewayError(error)
    // The paid transport uses this code when its own bounded timer wins. A
    // client disconnect still destroys the response, so send() remains a no-op.
    if (error?.code === 'UPSTREAM_CANCELLED' || error?.code === 'UPSTREAM_TIMEOUT') {
      throw fail(504, 'AI_TIMEOUT', 'AI 服务响应超时，请稍后重试。')
    }
    // Paid transport failures are deliberately mapped to a stable service
    // status. Do not expose provider, ledger, or credential details.
    if (GATEWAY_UNAVAILABLE.has(error?.code)) throw fail(503, error.code, 'AI 生成服务当前不可用，请稍后重试。')
    throw fail(502, 'AI_INVALID_RESPONSE', 'AI 服务返回无效响应或连接失败。')
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (received?.body && !received.body.locked) void received.body.cancel().catch(() => {})
    res.off('close', onClose)
  }
}

// Identity comes exclusively from a server-owned adapter, never headers or IP.
export async function resolveGenerationPrincipal(req, res, resolver, timeoutMs = 2000) {
  if (typeof resolver !== 'function') return null
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, timeoutMs)
  res.once('close', abort)
  try {
    if (res.destroyed) return null
    const value = await abortable(Promise.resolve().then(() => resolver(req, { signal: controller.signal })), controller.signal)
    return !controller.signal.aborted && !res.destroyed && typeof value === 'string'
      && value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= 256
      && !/[\u0000-\u001f\u007f]/.test(value) ? value : null
  } catch { return null }
  finally { clearTimeout(timer); res.off('close', abort); controller.abort() }
}

function requestIdempotencyKey(req) {
  const values = []
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === 'idempotency-key') values.push(req.rawHeaders[i + 1])
  }
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{32,128}$/.test(values[0])) {
    throw fail(400, 'IDEMPOTENCY_KEY_INVALID', '请提供有效的生成请求标识。')
  }
  return values[0]
}

const SESSION_COOKIE = '__Host-bc_session'
export const OPAQUE_SESSION_COOKIE_POLICY = Object.freeze({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' })

function opaqueSessionDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** Resolve only server-provisioned bearer sessions; this module never mints them. */
export function createOpaqueSessionPrincipalResolver({ sessions, now = Date.now } = {}) {
  if (!Array.isArray(sessions) || sessions.length < 1 || sessions.length > 256) throw new Error('Invalid opaque session allowlist')
  const entries = sessions.map(entry => {
    if (!entry || typeof entry !== 'object' || !/^[a-f0-9]{64}$/.test(entry.sessionHash) ||
        typeof entry.principal !== 'string' || Buffer.byteLength(entry.principal, 'utf8') < 1 || Buffer.byteLength(entry.principal, 'utf8') > 256 ||
        !Number.isSafeInteger(entry.expiresAt) || typeof entry.revoked !== 'boolean') throw new Error('Invalid opaque session entry')
    return Object.freeze({ digest: Buffer.from(entry.sessionHash, 'hex'), principal: entry.principal, expiresAt: entry.expiresAt, revoked: entry.revoked })
  })
  if (new Set(sessions.map(entry => entry.sessionHash)).size !== entries.length) throw new Error('Duplicate opaque session hash')
  return req => {
    const cookies = []
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (req.rawHeaders[index].toLowerCase() === 'cookie') cookies.push(req.rawHeaders[index + 1])
    }
    if (cookies.length !== 1) return null
    const values = cookies[0].split(';').map(part => part.trim()).filter(part => part.startsWith(`${SESSION_COOKIE}=`))
    if (values.length !== 1) return null
    const token = values[0].slice(SESSION_COOKIE.length + 1)
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null
    const supplied = opaqueSessionDigest(token)
    const match = entries.find(entry => timingSafeEqual(entry.digest, supplied))
    if (!match || match.revoked || match.expiresAt <= now()) return null
    return match.principal
  }
}

async function cliPrincipalResolver(env) {
  const mode = env.AI_GENERATION_IDENTITY_MODE?.trim()
  if (!mode || mode === 'disabled') return undefined
  if (mode !== 'opaque-session') throw new Error('Unsupported AI_GENERATION_IDENTITY_MODE')
  const path = env.AI_GENERATION_SESSION_ALLOWLIST_PATH?.trim()
  if (!path || !isAbsolute(path)) throw new Error('Opaque session allowlist must use an absolute path')
  const info = await stat(path)
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 64 * 1024) throw new Error('Opaque session allowlist must be a private file (0600 or stricter)')
  const parsed = JSON.parse(await readFile(path, 'utf8'))
  if (!parsed || !Array.isArray(parsed.sessions)) throw new Error('Invalid opaque session allowlist')
  return createOpaqueSessionPrincipalResolver({ sessions: parsed.sessions })
}

function cliPrincipalBindingKey(env) {
  const encoded = env.AI_GENERATION_BINDING_KEY?.trim()
  if (!encoded) return undefined
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('AI_GENERATION_BINDING_KEY must be canonical base64')
  }
  const key = Buffer.from(encoded, 'base64')
  if (key.length < 32 || key.toString('base64') !== encoded) {
    key.fill(0)
    throw new Error('AI_GENERATION_BINDING_KEY must encode at least 32 bytes')
  }
  return key
}

function principalGatewayError(error) {
  if (error?.code === 'BUDGET_EXHAUSTED') return fail(429, 'BUDGET_EXHAUSTED', '共用 AI 余额或测试次数不足以支付本次请求。')
  if (error?.code === 'BUDGET_HALTED') return fail(503, 'BUDGET_HALTED', '共用 AI 账本校验异常，调用已安全暂停。')
  if (error?.code === 'PRICING_UNVERIFIED') return fail(503, 'PRICING_UNVERIFIED', '模型价格暂时无法复核，未发起付费请求。')
  const status = paidRuntimeModule.paidGatewayHttpStatus?.(error) ?? 503
  const safeStatus = [400, 401, 409, 504].includes(status) ? status : 503
  return fail(safeStatus, safeStatus === 409 ? 'GENERATION_CONFLICT' : safeStatus === 401 ? 'UNAUTHORIZED' : safeStatus === 400 ? 'INVALID_INPUT' : safeStatus === 504 ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', '生成请求未完成，请检查授权或稍后重试。')
}

/** Dependency injection is for offline tests; the executable always uses official fetch. */
export function createAppServer({
  apiKey = process.env.DEEPSEEK_API_KEY?.trim(),
  fetchImpl = globalThis.fetch,
  model = process.env.DEEPSEEK_MODEL?.trim() || defaultModelForTransport(fetchImpl),
  aiTimeoutMs = LIMITS.aiTimeoutMs,
  requestsPerMinute = LIMITS.requestsPerMinute,
  staticDir = resolve(fileURLToPath(new URL('../dist/', import.meta.url))),
  publicOrigin = process.env.PUBLIC_ORIGIN?.trim() || '',
  mochi,
  interactive,
  generationAccess,
  resolvePrincipal,
  principalRuntime,
  fieldPlanning,
} = {}) {
  if (publicOrigin) {
    const origin = new URL(publicOrigin)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== publicOrigin) {
      throw new Error('PUBLIC_ORIGIN must be an exact HTTP(S) origin without a path')
    }
  }
  // Trusted deployment injection only; CLI/env cannot manufacture access or
  // money authorization. Shared existing key/model/fetch; disabled by default.
  const mochiAi = createMochiIntegration({ ...mochi, apiKey, model, fetchImpl, timeoutMs: aiTimeoutMs })
  const handleFieldPlan = createMochiPlanHandler({ ...fieldPlanning, apiKey, model, fetchImpl, timeoutMs: aiTimeoutMs,
    ...(principalRuntime ? {
      enabled: true, allowedOrigin: publicOrigin,
      resolveAccess: async (req, context) => typeof await resolvePrincipal?.(req, context) === 'string',
      resolveRequest: async (req, input, signal) => {
        const principal = await abortable(Promise.resolve(resolvePrincipal?.(req, { signal })), signal)
        return principalRuntime.forFieldPlan({ principal, idempotencyKey: requestIdempotencyKey(req), input })
      },
    } : {}),
  })
  const admitInteractive = createInteractiveGate(interactive)
  const clients = new Map()
  let inFlight = 0
  let accepting = true
  let activeHandlers = 0
  const idleWaiters = new Set()
  const server = createServer(async (req, res) => {
    activeHandlers++
    try {
      if (!accepting) {
        send(res, 503, { error: { code: 'SERVER_SHUTTING_DOWN', message: '服务正在关闭，请稍后重试。' } })
        return
      }
      if (await handleFieldPlan(req, res)) return
      if (await mochiAi.handle(req, res)) return
      const pathname = requestPath(req.url)
      if (pathname === '/api/health' && req.method === 'GET') {
        send(res, 200, { status: 'ok' }); return
      }
      if (pathname !== '/api/ai/generate') {
        if (/^\/api(?:\/|$)/i.test(pathname)) throw fail(404, 'NOT_FOUND', '接口不存在。')
        if (await serveStatic(req, res, staticDir, pathname)) return
        throw fail(404, 'NOT_FOUND', '资源不存在。')
      }
      if (req.method !== 'POST') throw fail(405, 'METHOD_NOT_ALLOWED', '此接口仅接受 POST。')
      // Identity is checked for BOTH v1 and v2, before parsing or Provider work.
      // Origin remains defense in depth; it never grants authorization.
      const principalMode = principalRuntime !== undefined
      const principal = principalMode ? await resolveGenerationPrincipal(req, res, resolvePrincipal) : null
      if (principalMode ? principal === null : !await authorizeGeneration(req, res, generationAccess)) throw fail(401, 'UNAUTHORIZED', '生成接口需要服务端授权。')
      const idempotencyKey = principalMode ? requestIdempotencyKey(req) : null
      // No CORS; reject browser cross-origin attempts even when they skip preflight.
      if (req.headers.origin && req.headers.origin !== (publicOrigin || `http://${req.headers.host}`)) {
        throw fail(403, 'ORIGIN_REJECTED', '不允许跨来源请求。')
      }
      const now = Date.now()
      for (const [ip, entry] of clients) if (entry.reset <= now) clients.delete(ip)
      // Use the socket address, never caller-controlled X-Forwarded-For.
      const ip = req.socket.remoteAddress
      let entry = clients.get(ip)
      if (!entry) {
        if (clients.size >= LIMITS.rateLimitEntries) throw fail(503, 'SERVER_BUSY', '服务繁忙，请稍后重试。')
        entry = { count: 0, reset: now + 60_000 }; clients.set(ip, entry)
      }
      if (++entry.count > requestsPerMinute) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.reset - now) / 1000))))
        throw fail(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试。')
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        throw fail(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用 application/json。')
      }
      if (Number(req.headers['content-length']) > LIMITS.requestBytes) throw fail(413, 'INPUT_TOO_LARGE', '请求体过大。')
      if (inFlight >= LIMITS.concurrentRequests) throw fail(503, 'SERVER_BUSY', '服务繁忙，请稍后重试。')
      inFlight++
      try {
        const input = await readInput(req)
        if (res.destroyed) return
        if (!input || Array.isArray(input) || typeof input !== 'object' ||
            !Object.keys(input).every(key => key === 'idea' || key === 'protocol') ||
            (Object.hasOwn(input, 'protocol') && input.protocol !== 'trusted-interactive/1') ||
            typeof input.idea !== 'string' || !input.idea.trim() || input.idea.length > LIMITS.ideaChars) {
          throw fail(400, 'INVALID_INPUT', `请提供 1–${LIMITS.ideaChars} 个字符的软件创意（idea）。`)
        }
        const isInteractive = input.protocol === 'trusted-interactive/1'
        if (isInteractive) {
          const admission = new AbortController()
          const cancelAdmission = () => { if (!res.writableEnded) admission.abort() }
          res.once('close', cancelAdmission)
          if (res.destroyed) admission.abort()
          try { await admitInteractive(req, { model, requestId: randomUUID(), maxTokens: principalMode ? 2048 : Buffer.byteLength(JSON.stringify(buildInteractiveMessages(input.idea.trim()))) + 8192, signal: admission.signal, principal }) }
          catch (error) { throw fail(error.status ?? 503, error.code ?? 'AI_DISABLED', '可信交互生成未获授权或预算不可用。') }
          finally { res.off('close', cancelAdmission) }
          if (res.destroyed) return
        }
        let requestOptions = { apiKey, model, fetchImpl }
        if (principalMode) {
          try {
            requestOptions = principalRuntime.forRequest({ principal, idempotencyKey, payload: { idea: input.idea.trim(), ...(isInteractive ? { protocol: input.protocol } : {}) } })
          } catch (error) { throw principalGatewayError(error) }
        }
        if (!requestOptions.apiKey) throw fail(503, 'AI_NOT_CONFIGURED', 'AI 服务尚未配置。')
        const spec = await generate(input.idea.trim(), { ...requestOptions, maxOutputTokens: principalRuntime?.policy?.maxOutputTokens,
          aiTimeoutMs, interactive: isInteractive, principalMode }, res)
        const provenance = {
          source: isPaidTransport(requestOptions.fetchImpl) ? 'deepseek' : 'offline-fixture',
          model: requestOptions.model,
        }
        send(res, 200, isInteractive ? { protocol: 'trusted-interactive/1', spec, provenance } : spec)
      } finally { inFlight-- }
    } catch (error) {
      const safe = error instanceof HttpError ? error : fail(500, 'INTERNAL_ERROR', '服务暂时不可用。')
      send(res, safe.status, { error: { code: safe.code, message: safe.message } })
    } finally {
      activeHandlers--
      if (activeHandlers === 0) {
        for (const resolveIdle of idleWaiters) resolveIdle(true)
        idleWaiters.clear()
      }
    }
  })
  server.beginShutdown = () => { accepting = false }
  server.waitForRequests = ({ timeoutMs } = {}) => {
    if (activeHandlers === 0) return Promise.resolve(true)
    return new Promise(resolve => {
      let timer
      let settled = false
      const onIdle = () => finish(true)
      const finish = idle => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        idleWaiters.delete(onIdle)
        resolve(idle)
      }
      idleWaiters.add(onIdle)
      if (Number.isSafeInteger(timeoutMs) && timeoutMs >= 0) timer = setTimeout(() => finish(false), timeoutMs)
    })
  }
  server.requestTimeout = LIMITS.inputTimeoutMs + 1000
  server.headersTimeout = LIMITS.inputTimeoutMs
  server.timeout = LIMITS.inputTimeoutMs + aiTimeoutMs + 5000
  server.maxHeadersCount = 128
  return server
}

/** Start closed by default. A paid runtime is composed only when a trusted
 * identity resolver is explicitly injected by the embedding server process.
 */
export async function startServer({
  host = '127.0.0.1',
  port = 3001,
  env = process.env,
  resolveIdentity,
  resolvePrincipal,
  interactive,
  bindingKey,
  principalRuntimeFactory = paidRuntimeModule.createPrincipalPaidGenerationRuntime,
  paidRuntimeFactory,
  appServerFactory = createAppServer,
  drainTimeoutMs = LIMITS.aiTimeoutMs + LIMITS.inputTimeoutMs + 5_000,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT')
  if (!Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs < 0 || drainTimeoutMs > 60_000) throw new Error('Invalid shutdown drain timeout')

  let paidRuntime = null
  let server
  try {
    let appServerOptions
    const principalResolver = resolvePrincipal ?? await cliPrincipalResolver(env)
    if (typeof principalResolver === 'function') {
      if (typeof principalRuntimeFactory !== 'function') throw new Error('Principal runtime unavailable')
      paidRuntime = principalRuntimeFactory({ env, bindingKey: bindingKey ?? cliPrincipalBindingKey(env) })
      appServerOptions = {
        resolvePrincipal: principalResolver,
        principalRuntime: paidRuntime,
        interactive: interactive ? { ...interactive, principalManagedBudget: true } : undefined,
      }
    } else if (typeof resolveIdentity === 'function' && typeof paidRuntimeFactory === 'function') {
      // Compatibility injection for existing offline lifecycle tests only.
      // A boolean resolver alone never selects a production runtime.
      paidRuntime = paidRuntimeFactory({ env, resolveIdentity })
      appServerOptions = { ...paidRuntime.appServerOptions, interactive }
    }
    server = appServerOptions ? appServerFactory(appServerOptions) : appServerFactory()
    await new Promise((resolve, reject) => {
      const onError = error => { server.off('listening', onListening); reject(error) }
      const onListening = () => { server.off('error', onError); resolve() }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })
  } catch (error) {
    try { paidRuntime?.close() } catch { /* preserve the startup failure */ }
    throw error
  }

  let shutdownTask
  const shutdown = () => {
    if (shutdownTask) return shutdownTask
    shutdownTask = (async () => {
      server.beginShutdown()
      const closed = new Promise((resolve, reject) => {
        try { server.close(error => error ? reject(error) : resolve()) }
        catch (error) { reject(error) }
      })
      const drained = await server.waitForRequests({ timeoutMs: drainTimeoutMs })
      if (!drained) server.closeAllConnections()
      await server.waitForRequests()
      await closed
      paidRuntime?.close()
    })()
    return shutdownTask
  }
  return Object.freeze({ server, shutdown })
}

/** Install idempotent signal hooks without forcing an abrupt process exit. */
export function installShutdownHandlers(shutdown, processLike = process) {
  if (typeof shutdown !== 'function' || typeof processLike.on !== 'function' || typeof processLike.off !== 'function') {
    throw new TypeError('Invalid shutdown handler configuration')
  }
  let task
  const onSignal = () => {
    if (task) return
    task = Promise.resolve().then(shutdown).catch(() => { processLike.exitCode = 1 }).finally(() => {
      processLike.off('SIGINT', onSignal)
      processLike.off('SIGTERM', onSignal)
    })
  }
  processLike.on('SIGINT', onSignal)
  processLike.on('SIGTERM', onSignal)
  return () => {
    processLike.off('SIGINT', onSignal)
    processLike.off('SIGTERM', onSignal)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const production = process.env.NODE_ENV === 'production'
  const port = Number(process.env.PORT || (production ? 7860 : 3001))
  const host = production ? '0.0.0.0' : '127.0.0.1'
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  startServer({ host, port }).then(({ server, shutdown }) => {
    installShutdownHandlers(shutdown)
    server.on('error', () => { console.error('Backend server error.') })
    console.info(`BlockCraft AI backend: http://${host}:${port}`)
  }).catch(() => {
    console.error('Backend failed to start.')
    process.exitCode = 1
  })
}
