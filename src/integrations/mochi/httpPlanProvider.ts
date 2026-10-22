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
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data))
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
    if (!['form', 'list', 'gallery'].includes(input.block.type)) throw new AppSpecError('FORM_REQUIRED', '请先选择已绑定实体的表单、列表或画廊积木。')
    const body = JSON.stringify(input)
    if (new TextEncoder().encode(body).byteLength > maxBytes) throw new AppSpecError('MODEL_REQUEST_TOO_LARGE', '积木结构超出计划请求限制。')
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(35000)])
    const response = await fetchImpl('/api/mochi-plan', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json' }, body })
    const result = await read(response)
    signal.throwIfAborted()
    if (!response.ok) throw new AppSpecError('FIELD_PLAN_FAILED', '积木计划生成失败，请检查服务连接或预算后重试。')
    if (!result || !['deepseek', 'offline-fixture'].includes(result.source) || typeof result.model !== 'string' || !result.candidate) throw new AppSpecError('AI_INVALID_RESPONSE', '计划响应无效。')
    return result.candidate
  }
}
