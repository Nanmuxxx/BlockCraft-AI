/** Enum-only diagnostics. Never accept messages, model text, prompts, IDs or payloads. */
const stages = new Set(['body', 'envelope', 'content', 'advice', 'candidate'])
const reasons = new Set(['size', 'encoding', 'json', 'shape', 'finish', 'role', 'refusal', 'tools', 'schema', 'reference', 'action', 'binding', 'command_schema', 'command_constraints', 'capabilities', 'no_change', 'intent'])
const finishes = new Set(['stop', 'length', 'content_filter', 'tool_calls', 'function_call', 'insufficient_system_resource', 'unavailable', 'unknown'])
export function invalidResponse(stage, reason, finishReason) {
  return Object.assign(new Error('Mochi 回复格式无效，项目未修改。请调整描述后手动重试。'), {
    code: 'AI_INVALID_RESPONSE', status: 502,
    diagnostic: Object.freeze({ stage: stages.has(stage) ? stage : 'envelope', reason: reasons.has(reason) ? reason : 'schema',
      finishReason: finishes.has(finishReason) ? finishReason : finishReason == null ? 'unavailable' : 'unknown' }),
  })
}
export function reportModelFailure(channel, error, sink = event => console.warn(JSON.stringify(event))) {
  if (!error?.diagnostic || !['advice', 'plan'].includes(channel)) return
  const safe = invalidResponse(error.diagnostic.stage, error.diagnostic.reason, error.diagnostic.finishReason).diagnostic
  // Observability must never break a failed request's safe response.
  try { sink(Object.freeze({ event: 'mochi_model_rejected', channel, ...safe })) } catch { /* no payload fallback */ }
}
export function parseModelJson(text, stage, finishReason) {
  try { return JSON.parse(text) } catch { throw invalidResponse(stage, 'json', finishReason) }
}
export function modelContent(envelope, { requireRole = true } = {}) {
  const choice = envelope?.choices?.[0], finish = choice?.finish_reason
  const reject = reason => { throw invalidResponse('envelope', reason, finish) }
  if (!Array.isArray(envelope?.choices) || envelope.choices.length !== 1 || envelope.error !== undefined) reject('shape')
  if (finish !== 'stop') reject('finish')
  const message = choice.message
  if (!message || typeof message.content !== 'string') reject('shape')
  if ((requireRole || message.role !== undefined) && message.role !== 'assistant') reject('role')
  if (message.refusal !== undefined && message.refusal !== null) reject('refusal')
  if (message.tool_calls !== undefined || message.function_call !== undefined) reject('tools')
  return message.content
}
