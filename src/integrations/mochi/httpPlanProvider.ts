import { AppSpecError } from '../../model/appSpecValidation'
import type { PlanProvider } from './host'
import { createModelPlanProvider } from './modelPlanProvider'
import { unavailablePlanProvider } from './planning'

/** Default off. Same-origin, session-authenticated endpoint only. The host's
 * snapshot, records, owner tokens and model configuration never leave the client.
 * Deployment must supply real authenticated project binding; no fixture fallback.
 */
export function createHttpPlanProvider({ enabled = false, fetchImpl = globalThis.fetch, timeoutMs = 20000 }: {
  enabled?: boolean; fetchImpl?: typeof fetch; timeoutMs?: number
} = {}): PlanProvider {
  if (!enabled) return unavailablePlanProvider
  return request => createModelPlanProvider(async ({ signal }) => {
    const fetching = fetchImpl('/api/mochi-plan', {
      method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ appId: request.context.appId, instanceId: request.context.instanceId,
        selectedBlockId: request.context.selectedBlockId, revision: request.context.revision,
        requestId: request.requestId, prompt: request.prompt }),
    })
    void fetching.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}) }).catch(() => {})
    const response = await fetching
    signal.throwIfAborted()
    if (!response.ok || !response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      void response.body?.cancel().catch(() => {})
      throw new AppSpecError('PLAN_UNAVAILABLE', '修改计划暂不可用，请重试。')
    }
    const reader = response.body.getReader(); let size = 0
    const cancel = () => { void reader.cancel().catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    const chunks: Uint8Array[] = []
    try {
      for (;;) {
        const part = await reader.read()
        signal.throwIfAborted()
        if (part.done) break
        size += part.value.byteLength
        if (size > 65536) throw new AppSpecError('INVALID_MODEL_RESPONSE', '修改计划超出响应限制。')
        chunks.push(part.value)
      }
      const bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); reader.releaseLock() }
  }, { timeoutMs })(request)
}
