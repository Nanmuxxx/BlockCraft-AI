import { requireControlledEgress } from '../paid-gateway/egress.mjs'
import { GenerationError, ensure, LIMITS } from './protocol.mjs'
import { buildMessages } from './contract.mjs'
import { defaultModelForTransport } from '../paid-gateway/provider.mjs'
import { abortable } from '../ai-abort.mjs'

const ENDPOINT = 'https://api.deepseek.com/chat/completions'

async function readEnvelope(response, controller) {
  ensure(response.ok, 'UPSTREAM_UNAVAILABLE')
  ensure(Number(response.headers.get('content-length')) <= LIMITS.upstreamBytes, 'UPSTREAM_LIMIT')
  ensure(response.body, 'UPSTREAM_INVALID')
  const reader = response.body.getReader()
  let bytes = 0
  const chunks = []
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), controller.signal)
      if (done) break
      bytes += value.byteLength
      ensure(bytes <= LIMITS.upstreamBytes, 'UPSTREAM_LIMIT')
      chunks.push(Buffer.from(value))
    }
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
    ensure(Array.isArray(envelope.choices) && envelope.choices.length === 1 && envelope.error === undefined, 'UPSTREAM_INVALID')
    const choice = envelope.choices[0]
    ensure(choice.finish_reason === 'stop' && choice.message?.role === 'assistant' &&
      typeof choice.message.content === 'string' && (choice.message.refusal === undefined || choice.message.refusal === null) &&
      choice.message.tool_calls === undefined && choice.message.function_call === undefined, 'UPSTREAM_INVALID')
    ensure(Buffer.byteLength(choice.message.content) <= LIMITS.outputBytes, 'OUTPUT_LIMIT')
    return choice.message.content
  } finally {
    controller.abort()
    // Do not await untrusted/failed stream cancellation indefinitely.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Server-only explicit paid-call boundary. Construction is default denied; no env read. */
export function createDeepSeekProvider({ allowPaid = false, apiKey, fetchImpl = globalThis.fetch, model = defaultModelForTransport(fetchImpl), timeoutMs = LIMITS.timeoutMs } = {}) {
  ensure(allowPaid === true, 'PAID_API_DISABLED')
  ensure(typeof apiKey === 'string' && apiKey.length > 0 && apiKey.length <= 512 && !/[\s\x00-\x1f]/u.test(apiKey), 'API_CONFIGURATION')
  ensure(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-chat'].includes(model) && typeof fetchImpl === 'function', 'API_CONFIGURATION')
  ensure(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= LIMITS.timeoutMs, 'API_CONFIGURATION')
  requireControlledEgress(fetchImpl)
  // No key on the public object, in prompts, persisted metadata, logs or errors.
  return Object.freeze({ kind: 'deepseek', async generate(request, { signal } = {}) {
    ensure(!signal?.aborted, 'CANCELLED')
    const messages = buildMessages(request)
    const controller = new AbortController()
    const abort = () => controller.abort(new GenerationError('CANCELLED'))
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new GenerationError('UPSTREAM_TIMEOUT')), timeoutMs)
    let received
    const operation = async () => {
      controller.signal.throwIfAborted()
      const fetching = Promise.resolve(fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, response_format: { type: 'json_object' }, max_tokens: 2048 }),
      }))
      void fetching.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}) }).catch(() => {})
      const response = received = await abortable(fetching, controller.signal)
      return readEnvelope(response, controller)
    }
    try { return await operation() }
    catch (error) {
      if (signal?.aborted) throw new GenerationError('CANCELLED')
      if (error instanceof GenerationError) throw error
      throw new GenerationError('UPSTREAM_INVALID')
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort()
      if (received?.body && !received.body.locked) void received.body.cancel().catch(() => {})
    }
  } })
}
