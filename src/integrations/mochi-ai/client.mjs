import { LIMITS, MochiError, check, object, projectContext, validateAdvice, binding, fingerprint, redact, validateRequest } from './protocol.mjs'
const errors = { AI_DISABLED: 'Mochi AI 尚未启用。', AI_NOT_CONFIGURED: 'Mochi AI 尚未配置。', AI_MODIFICATION_DISABLED: '目前只能解释和建议，修改计划尚未接通。',
  AI_TIMEOUT: 'Mochi 想得有点久，请稍后重试。', AI_BUSY: 'Mochi 正在思考。', THROTTLED: '先消化一下刚才的想法吧。', BUDGET_EXHAUSTED: '本次 AI 预算已用完。',
  PROACTIVE_DISABLED: '主动建议尚未开启。', DUPLICATE_EVENT: '这个变化已经分析过了。', CANCELLED: '已取消请求。' }
export function createMochiApi({ fetchImpl = globalThis.fetch, timeoutMs = 25_000 } = {}) {
  async function request(path, input, { signal } = {}) {
    const controller = new AbortController(); let timedOut = false
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort()
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      controller.signal.throwIfAborted()
      const response = await fetchImpl(`/api/mochi-ai/${path}`, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
        headers: input === undefined ? {} : { 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
      check(response.body && Number(response.headers.get('content-length')) <= LIMITS.responseBytes, 'AI_INVALID_RESPONSE', 'Mochi 返回了无效数据。', 502)
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let content = '', size = 0
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength
          check(size <= LIMITS.responseBytes, 'AI_INVALID_RESPONSE', 'Mochi 回复过大。', 502); content += decoder.decode(value, { stream: true }) }
        content += decoder.decode()
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      const result = JSON.parse(content)
      if (!response.ok) throw new MochiError(result?.error?.code in errors ? result.error.code : 'AI_UNAVAILABLE', errors[result?.error?.code] || 'Mochi 暂时无法回答，请稍后重试。', response.status)
      return result
    } catch (error) {
      if (timedOut) throw new MochiError('AI_TIMEOUT', errors.AI_TIMEOUT, 504)
      if (signal?.aborted) throw new MochiError('CANCELLED', errors.CANCELLED, 499)
      if (error instanceof MochiError) throw error
      throw new MochiError('AI_UNAVAILABLE', 'Mochi 暂时无法回答，请稍后重试。', 502)
    } finally { clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort) }
  }
  return { status: options => request('status', undefined, options), async analyze(input, options) { const safe = validateRequest(input); return validateReply(await request('analyze', safe, options), safe.context) },
    consent: enabled => request('consent', { enabled }), ignore: id => request('ignore', { id }) }
}
function validateReply(reply, context) {
  object(reply, ['version','source','capabilities','binding','message','suggestions'])
  object(reply.capabilities, ['modifications'])
  check(reply.version === 1 && reply.source === 'deepseek' && reply.capabilities.modifications === false, 'AI_INVALID_RESPONSE')
  const expected = binding(context)
  object(reply.binding, Object.keys(expected))
  check(Object.entries(expected).every(([key, value]) => reply.binding[key] === value), 'CONTEXT_CHANGED', '上下文已变化，请重新提问。', 409)
  check(Array.isArray(reply.suggestions) && reply.suggestions.length <= LIMITS.suggestions, 'AI_INVALID_RESPONSE')
  const ids = new Set()
  const suggestions = reply.suggestions.map(s => {
    object(s, ['id','text','reason','blockId','priority','requiresUserAction','kind'])
    check(typeof s.id === 'string' && /^ai-[a-f0-9]{32}$/.test(s.id) && !ids.has(s.id), 'AI_INVALID_RESPONSE'); ids.add(s.id)
    const { id, ...advice } = s; return advice
  })
  validateAdvice({ message: reply.message, suggestions }, context)
  return reply
}
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
/** Trusted adapter owns readContext/focusBlock. This module never receives Runtime/PlanProvider. */
export function createMochiConversation({ api = createMochiApi(), readContext, focusBlock, now = Date.now }) {
  let state = freeze({ enabled: false, proactiveEnabled: false, busy: false, modificationsEnabled: false, messages: [], suggestions: [], error: null })
  let disposed = false, pending = null, epoch = 0, signature = '', identity = '', prompts = [], lastProactive = -Infinity, consentSequence = 0, statusSequence = 0
  let consentTail = Promise.resolve()
  const listeners = new Set(), seen = new Map(), ignored = new Map(), events = new Map()
  const COOLDOWN = 600_000
  function emit(patch) { if (disposed) return; state = freeze({ ...state, ...patch }); listeners.forEach(fn => fn()) }
  function remember(map, key) { if (map.size >= 200) map.delete(map.keys().next().value); map.set(key, now() + COOLDOWN) }
  function purge() { for (const map of [seen, ignored, events]) for (const [k, expiry] of map) if (expiry <= now()) map.delete(k) }
  function cancel() { epoch++; pending?.abort(); pending = null; emit({ busy: false }) }
  function syncContext() {
    check(!disposed, 'DISPOSED', 'Mochi 会话已关闭。')
    const context = projectContext(readContext()), nextIdentity = `${context.appId}:${context.instanceId}`, next = JSON.stringify(context)
    if (next !== signature) {
      cancel(); signature = next
      if (identity !== nextIdentity) { prompts = []; seen.clear(); ignored.clear(); events.clear(); lastProactive = -Infinity; emit({ messages: [], suggestions: [], error: null }) }
      else emit({ suggestions: [], error: null })
      identity = nextIdentity
    }
    return context
  }
  async function refreshStatus() {
    check(!disposed, 'DISPOSED')
    const sequence = ++statusSequence, consentAtStart = consentSequence
    await consentTail.catch(() => {})
    const result = await api.status()
    if (disposed || sequence !== statusSequence) return state
    check(typeof result.enabled === 'boolean' && typeof result.proactiveEnabled === 'boolean' && result.modificationsEnabled === false, 'AI_INVALID_RESPONSE')
    if (!result.enabled) cancel()
    emit({ enabled: result.enabled, proactiveEnabled: result.enabled && (consentAtStart === consentSequence ? result.proactiveEnabled : state.proactiveEnabled), error: result.enabled ? null : { code: result.reason || 'AI_DISABLED', message: errors.AI_DISABLED } })
    return state
  }
  async function setProactive(enabled) {
    check(typeof enabled === 'boolean' && !disposed, 'INVALID_INPUT')
    const sequence = ++consentSequence
    // Serialize consent writes so rapid on/off cannot leave the server enabled.
    if (!enabled) { cancel(); emit({ proactiveEnabled: false }) }
    const write = consentTail.catch(() => {}).then(() => api.consent(enabled))
    consentTail = write
    try {
      const result = await write
      check(result.proactiveEnabled === enabled, 'AI_INVALID_RESPONSE')
      if (sequence === consentSequence) emit({ proactiveEnabled: enabled })
    } catch (error) { if (sequence === consentSequence) emit({ proactiveEnabled: false, error: { code: error.code || 'AI_UNAVAILABLE', message: '主动建议设置失败，请重试。' } }); throw error }
  }
  async function run(kind, prompt, event) {
    const context = syncContext(); purge()
    check(state.enabled, 'AI_DISABLED', errors.AI_DISABLED, 503)
    check(!pending, 'AI_BUSY', errors.AI_BUSY, 429)
    let eventKey
    if (kind === 'proactive') {
      check(state.proactiveEnabled, 'PROACTIVE_DISABLED', errors.PROACTIVE_DISABLED, 403)
      check(event && ['project-opened','structure-changed','selection-settled'].includes(event.type), 'INVALID_INPUT')
      const { revision: _revision, instanceId: _instance, ...structure } = context
      eventKey = JSON.stringify([event.type, structure])
      if (events.has(eventKey) || now() - lastProactive < 30_000) return null
      lastProactive = now(); remember(events, eventKey)
    } else check(typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= LIMITS.promptChars, 'INVALID_INPUT', '请简短说说你的问题。')
    const input = { version: 1, kind, context, history: kind === 'chat' ? prompts.slice(-LIMITS.history) : [],
      ...(kind === 'chat' ? { prompt: redact(prompt.trim()) } : { event: { type: event.type } }) }
    if (kind === 'chat') { prompts.push(input.prompt); prompts = prompts.slice(-LIMITS.history); emit({ messages: [...state.messages, { role: 'user', content: input.prompt }].slice(-40) }) }
    const controller = new AbortController(), owned = epoch
    pending = controller; emit({ busy: true, error: null })
    try {
      const reply = await api.analyze(input, { signal: controller.signal })
      check(!disposed && !controller.signal.aborted && owned === epoch && JSON.stringify(projectContext(readContext())) === signature, 'CONTEXT_CHANGED', '已丢弃过期回复。', 409)
      validateReply(reply, context)
      const suggestions = reply.suggestions.filter(s => {
        const key = fingerprint(s)
        if (seen.has(key) || ignored.has(key)) return false
        remember(seen, key); return true
      })
      emit({ messages: [...state.messages, { role: 'assistant', content: reply.message }].slice(-40), suggestions })
      return { ...reply, suggestions }
    } catch (error) {
      if (owned === epoch && !disposed) emit({ error: { code: error.code || 'AI_UNAVAILABLE', message: errors[error.code] || 'Mochi 暂时无法回答，请稍后重试。' } })
      throw error
    } finally { if (pending === controller) { pending = null; emit({ busy: false }) } }
  }
  function suggestion(id) {
    const item = state.suggestions.find(s => s.id === id)
    check(item, 'SUGGESTION_EXPIRED', '建议已过期。', 409)
    const context = projectContext(readContext())
    check(JSON.stringify(context) === signature && (item.blockId === null || context.blocks.some(b => b.id === item.blockId)), 'CONTEXT_CHANGED', '积木已变化，请重新分析。', 409)
    return item
  }
  return {
    getSnapshot: () => state,
    subscribe(fn) { check(!disposed, 'DISPOSED'); listeners.add(fn); return () => listeners.delete(fn) },
    syncContext, refreshStatus, setProactive, cancel,
    chat: prompt => run('chat', prompt), onEvent: event => run('proactive', undefined, event),
    focusSuggestion(id) { const item = suggestion(id); if (item.blockId !== null) focusBlock(item.blockId); return item },
    async continueSuggestion(id, question) { const item = suggestion(id); if (item.blockId !== null) focusBlock(item.blockId); return run('chat', question || `请解释这条建议：${item.text}`) },
    async ignore(id) { const item = suggestion(id); remember(ignored, fingerprint(item)); emit({ suggestions: state.suggestions.filter(s => s.id !== id) }); await api.ignore(id) },
    requestModification(id) { suggestion(id); throw new MochiError('AI_MODIFICATION_DISABLED', errors.AI_MODIFICATION_DISABLED, 503) },
    dispose() { cancel(); disposed = true; listeners.clear() },
  }
}
