import { modificationErrors } from '../mochi-ai/errors.mjs'
import { resolvePlanIntent, assertPlanIntent } from './intent.mjs'
import { AppSpecError } from '../../model/appSpecValidation'
import type { PlanProvider } from './host'
import { toMinimalPlanInput } from './planning'

const maxBytes = 64 * 1024
async function read(response: Response) {
  if (!response.body || Number(response.headers.get('content-length')) > maxBytes) throw new AppSpecError('AI_INVALID_RESPONSE', '计划响应过大。')
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength
      if (size > maxBytes) throw new AppSpecError('AI_INVALID_RESPONSE', '计划响应过大。'); chunks.push(value) }
    const data = new Uint8Array(size); let offset = 0
    chunks.forEach(chunk => { data.set(chunk, offset); offset += chunk.byteLength })
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) }
    catch { throw new AppSpecError('AI_INVALID_RESPONSE', modificationErrors.AI_INVALID_RESPONSE) }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
export async function fieldPlanningStatus(signal: AbortSignal) {
  const response = await fetch('/api/mochi-plan/status', { credentials: 'same-origin', redirect: 'error', signal })
  const status = await read(response)
  return response.ok && status.enabled === true
}
/** Sends selected schema only. The existing host owns scope, preview and confirmation. */
export function createHttpPlanProvider(fetchImpl: typeof fetch = globalThis.fetch): PlanProvider {
  return async request => {
    const input = toMinimalPlanInput(request)
    if (!['form', 'list', 'gallery', 'metric'].includes(input.block.type)) throw new AppSpecError('FORM_REQUIRED', '请先选择表单、列表、图库或统计积木。')
    try { resolvePlanIntent(input) } catch { throw new AppSpecError('INTENT_CLARIFICATION_REQUIRED', modificationErrors.INTENT_CLARIFICATION_REQUIRED) }
    const body = JSON.stringify(input)
    if (new TextEncoder().encode(body).byteLength > maxBytes) throw new AppSpecError('MODEL_REQUEST_TOO_LARGE', '积木结构超出计划请求限制。')
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(35000)])
    let response: Response
    try { response = await fetchImpl('/api/mochi-plan', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json' }, body }) }
    catch (error) {
      if (request.signal.aborted) throw error
      const code = signal.aborted ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE'
      throw new AppSpecError(code, modificationErrors[code])
    }
    let result
    try { result = await read(response); signal.throwIfAborted() }
    catch (error) {
      if (request.signal.aborted || error instanceof AppSpecError) throw error
      const code = signal.aborted ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE'
      throw new AppSpecError(code, modificationErrors[code])
    }
    if (!response.ok) {
      const code = typeof result?.error?.code === 'string' && Object.prototype.hasOwnProperty.call(modificationErrors, result.error.code) ? result.error.code : 'AI_UNAVAILABLE'
      throw new AppSpecError(code, modificationErrors[code])
    }
    if (!result || !['deepseek', 'offline-fixture'].includes(result.source) || typeof result.model !== 'string' || !result.candidate) throw new AppSpecError('AI_INVALID_RESPONSE', '计划响应无效。')
    try { assertPlanIntent(result.candidate, input) }
    catch (error) { const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'AI_INVALID_RESPONSE'; throw new AppSpecError(code, modificationErrors[code] || modificationErrors.AI_INVALID_RESPONSE) }
    return result.candidate
  }
}
