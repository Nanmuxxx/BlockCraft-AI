import { randomUUID } from 'node:crypto'
import { abortable } from './ai-abort.mjs'
import { buildInteractiveMessages, assertInteractiveSpec, createInteractiveGate } from './trusted-interactive.mjs'
import { createMochiIntegration } from './mochi-ai/index.mjs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
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

async function generate(idea, { apiKey, model, fetchImpl, aiTimeoutMs, interactive = false }, res) {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, aiTimeoutMs)
  const onClose = () => { if (!res.writableEnded) controller.abort() }
  res.on('close', onClose)
  if (res.destroyed) controller.abort()
  let received
  try {
    controller.signal.throwIfAborted()
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
        max_tokens: 8192,
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
    throw fail(502, 'AI_INVALID_RESPONSE', 'AI 服务返回无效响应或连接失败。')
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (received?.body && !received.body.locked) void received.body.cancel().catch(() => {})
    res.off('close', onClose)
  }
}

/** Dependency injection is for offline tests; the executable always uses official fetch. */
export function createAppServer({
  apiKey = process.env.DEEPSEEK_API_KEY?.trim(),
  model = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash',
  fetchImpl = globalThis.fetch,
  aiTimeoutMs = LIMITS.aiTimeoutMs,
  mochi,
  interactive,
} = {}) {
  // Trusted deployment injection only; CLI/env cannot manufacture access or
  // money authorization. Shared existing key/model/fetch; disabled by default.
  const mochiAi = createMochiIntegration({ ...mochi, apiKey, model, fetchImpl, timeoutMs: aiTimeoutMs })
  const admitInteractive = createInteractiveGate(interactive)
  const clients = new Map()
  let inFlight = 0
  const server = createServer(async (req, res) => {
    try {
      if (await mochiAi.handle(req, res)) return
      if (req.url === '/api/health' && req.method === 'GET') {
        send(res, 200, { status: 'ok' }); return
      }
      if (req.url !== '/api/ai/generate') throw fail(404, 'NOT_FOUND', '接口不存在。')
      if (req.method !== 'POST') throw fail(405, 'METHOD_NOT_ALLOWED', '此接口仅接受 POST。')
      // No CORS; reject browser cross-origin attempts even when they skip preflight.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
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
      if (++entry.count > LIMITS.requestsPerMinute) {
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
        // Close can occur at the end-of-input boundary, before generate has
        // attached its own listener. Never start a new paid call for that peer.
        if (res.destroyed) return
        if (!input || Array.isArray(input) || typeof input !== 'object' ||
            !Object.keys(input).every(key => key === 'idea' || key === 'protocol') ||
            (Object.hasOwn(input, 'protocol') && input.protocol !== 'trusted-interactive/1') || typeof input.idea !== 'string' ||
            !input.idea.trim() || input.idea.length > LIMITS.ideaChars) {
          throw fail(400, 'INVALID_INPUT', `请提供 1–${LIMITS.ideaChars} 个字符的软件创意（idea）。`)
        }
        const isInteractive = input.protocol === 'trusted-interactive/1'
        if (isInteractive) {
          const admission = new AbortController()
          const cancelAdmission = () => { if (!res.writableEnded) admission.abort() }
          res.once('close', cancelAdmission)
          if (res.destroyed) admission.abort()
          try { await admitInteractive(req, { model, requestId: randomUUID(), maxTokens: Buffer.byteLength(JSON.stringify(buildInteractiveMessages(input.idea.trim()))) + 8192, signal: admission.signal }) }
          catch (error) { throw fail(error.status ?? 503, error.code ?? 'AI_DISABLED', '可信交互生成未获授权或预算不可用。') }
          finally { res.off('close', cancelAdmission) }
          if (res.destroyed) return
        }
        if (!apiKey) throw fail(503, 'AI_NOT_CONFIGURED', 'AI 服务尚未配置。')
        const spec = await generate(input.idea.trim(), { apiKey, model, fetchImpl, aiTimeoutMs, interactive: isInteractive }, res)
        send(res, 200, isInteractive ? { protocol: 'trusted-interactive/1', spec, provenance: { source: fetchImpl === globalThis.fetch ? 'deepseek' : 'offline-fixture', model } } : spec)
      } finally { inFlight-- }
    } catch (error) {
      const safe = error instanceof HttpError ? error : fail(500, 'INTERNAL_ERROR', '服务暂时不可用。')
      send(res, safe.status, { error: { code: safe.code, message: safe.message } })
    }
  })
  server.requestTimeout = LIMITS.inputTimeoutMs + 1000
  server.headersTimeout = LIMITS.inputTimeoutMs
  server.timeout = LIMITS.inputTimeoutMs + aiTimeoutMs + 5000
  server.maxHeadersCount = 50
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  const server = createAppServer()
  server.on('error', () => { console.error('Backend failed to listen.'); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.info(`BlockCraft AI backend: http://127.0.0.1:${port}`))
}
