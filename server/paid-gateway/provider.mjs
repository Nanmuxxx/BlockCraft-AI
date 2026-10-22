import { createHash } from 'node:crypto'
import { PRICING, POLICY, ensure, GatewayError } from './pricing.mjs'

const ENDPOINT = 'https://api.deepseek.com/chat/completions'
const nativeFetch = globalThis.fetch
const paidTransports = new WeakMap()
export const isPaidTransport = value => paidTransports.has(value)
export const defaultModelForTransport = value => paidTransports.get(value) ?? 'deepseek-v4-flash'
async function abortable(work, signal) {
  signal.throwIfAborted()
  let abort
  const stopped = new Promise((_, reject) => { abort = () => reject(new GatewayError('UPSTREAM_CANCELLED')); signal.addEventListener('abort', abort, { once: true }) })
  try { return await Promise.race([work, stopped]) }
  finally { signal.removeEventListener('abort', abort) }
}
async function read(response, signal, policy) {
  ensure(response.body && Number(response.headers.get('content-length')) <= policy.maxResponseBytes, 'UPSTREAM_INVALID')
  const reader = response.body.getReader(), chunks = []; let bytes = 0
  try {
    for (;;) {
      const { value, done } = await abortable(reader.read(), signal)
      if (done) break
      bytes += value.byteLength; ensure(bytes <= policy.maxResponseBytes, 'UPSTREAM_LIMIT'); chunks.push(Buffer.from(value))
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Sole production egress. No retries, redirects, tools, browser-provided URL,
 * key or model. Call reservation is synchronous and durable before fetch. */
export function createPaidTransport({ apiKey, ledger, fetchImpl = nativeFetch, timeoutMs = POLICY.timeoutMs, onResponse, pricing = PRICING, policy = POLICY } = {}) {
  pricing = Object.freeze({ ...pricing }); policy = Object.freeze({ ...policy })
  ensure(typeof apiKey === 'string' && apiKey.length >= 16 && apiKey.length <= 512 && !/\s/.test(apiKey), 'API_CONFIGURATION')
  ensure(ledger && typeof ledger.reserve === 'function' && typeof ledger.snapshot === 'function', 'LEDGER_UNAVAILABLE')
  ensure(JSON.stringify(ledger.snapshot().pricing) === JSON.stringify(pricing), 'PRICING_MISMATCH')
  ensure(['maxInputBytes', 'framingTokens', 'maxOutputTokens', 'maxResponseBytes', 'timeoutMs'].every(k =>
    Number.isSafeInteger(policy[k]) && policy[k] > 0 && policy[k] <= POLICY[k]), 'POLICY_INVALID')
  ensure(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= policy.timeoutMs, 'TIMEOUT_CONFIGURATION')
  let active = false
  const transport = async (url, init) => {
    ensure(!active, 'CONCURRENCY_LIMIT')
    ensure(url === ENDPOINT && init?.method === 'POST', 'EGRESS_DENIED')
    ensure(!init.signal?.aborted, 'CANCELLED')
    let body
    try { body = JSON.parse(init.body) } catch { throw new GatewayError('REQUEST_INVALID') }
    ensure(body && Object.keys(body).every(k => ['model', 'messages', 'stream', 'response_format', 'max_tokens'].includes(k)), 'REQUEST_INVALID')
    ensure(Array.isArray(body.messages) && body.messages.length === 2 && body.messages[0].role === 'system' && body.messages[1].role === 'user'
      && body.messages.every(m => typeof m.content === 'string' && Object.keys(m).every(k => ['role', 'content'].includes(k))), 'REQUEST_INVALID')
    ensure(body.stream === false && body.response_format?.type === 'json_object' && Object.keys(body.response_format).length === 1, 'REQUEST_INVALID')
    ensure(body.model === pricing.model && Number.isSafeInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= policy.maxOutputTokens, 'REQUEST_INVALID')
    const inputBytes = Buffer.byteLength(JSON.stringify(body.messages))
    ensure(inputBytes <= policy.maxInputBytes, 'INPUT_LIMIT')
    const inputBound = inputBytes + policy.framingTokens
    const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    const id = ledger.reserve(inputBound, body.max_tokens, requestHash)
    active = true
    const controller = new AbortController()
    const cancel = () => controller.abort()
    init.signal?.addEventListener('abort', cancel, { once: true })
    if (init.signal?.aborted) cancel()
    const timer = setTimeout(cancel, timeoutMs)
    let response
    try {
      controller.signal.throwIfAborted()
      const wire = { ...body, thinking: { type: 'disabled' } }
      const fetching = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(wire),
      }) })
      void fetching.then(r => { if (controller.signal.aborted) void r.body?.cancel().catch(() => {}) }).catch(() => {})
      response = await abortable(fetching, controller.signal)
      ensure(response.ok, 'UPSTREAM_UNAVAILABLE')
      const envelope = await read(response, controller.signal, policy)
      controller.signal.throwIfAborted()
      ledger.settle(id, envelope?.usage)
      // An allowlisted copy only: do not persist upstream headers or credentials.
      const choice = envelope?.choices?.[0]
      ensure(Array.isArray(envelope.choices) && envelope.choices.length === 1 && choice?.finish_reason === 'stop'
        && choice.message?.role === 'assistant' && typeof choice.message.content === 'string'
        && !choice.message.tool_calls && !choice.message.function_call && !choice.message.refusal && !envelope.error, 'UPSTREAM_INVALID')
      ensure(!choice.message.content.includes(apiKey), 'PRIVATE_RESPONSE')
      // Upstream metadata is untrusted too. Emit our approved request model,
      // never a provider-controlled label that could echo private material.
      const safe = { model: pricing.model,
        choices: [{ finish_reason: choice.finish_reason, message: { role: 'assistant', content: choice.message.content } }],
        usage: ledger.snapshot().entries.find(e => e.id === id).usage }
      if (onResponse) {
        const auditing = Promise.resolve().then(() => {
          controller.signal.throwIfAborted()
          return onResponse(structuredClone(safe), { id, requestHash, signal: controller.signal })
        })
        // The same connection/body deadline includes asynchronous auditing.
        // A trusted callback may ignore the signal; its late result is ignored.
        await abortable(auditing, controller.signal)
      }
      controller.signal.throwIfAborted()
      return Response.json(safe)
    } catch (error) {
      ledger.uncertain(id) // Completed trustworthy usage stays settled; unknown usage halts all calls.
      throw new GatewayError(error instanceof GatewayError ? error.code : 'UPSTREAM_FAILED')
    } finally {
      clearTimeout(timer); controller.abort(); init.signal?.removeEventListener('abort', cancel)
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {})
      active = false
    }
  }
  paidTransports.set(transport, pricing.model)
  return transport
}
