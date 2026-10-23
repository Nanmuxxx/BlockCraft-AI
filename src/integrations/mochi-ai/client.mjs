import { modificationErrors } from './errors.mjs'
import { LIMITS, MochiError, check, object, id, projectContext, validateAdvice, binding, fingerprint, redact, validateRequest } from './protocol.mjs'
const errors = { ...modificationErrors, UNAUTHORIZED: 'Mochi AI 尚未启用：需要可信会话认证和项目访问权限。', ORIGIN_REJECTED: 'Mochi AI 请求来源未获允许。', CONTEXT_MISMATCH: '当前项目与可信访问范围不一致，请重新打开项目。', MODE_UNAVAILABLE: '请回到 B 模式再和 Mochi 聊聊。', ACCESS_UNAVAILABLE: 'Mochi AI 尚未启用：可信会话认证与项目权限尚未配置。', BUDGET_UNAVAILABLE: 'Mochi AI 尚未启用：持久费用预算控制尚未配置或不可用。', CONTEXT_PENDING: '正在读取积木结构…', CONTEXT_UNAVAILABLE: '积木结构暂不可用，请重新载入。', CONTEXT_TOO_LARGE: '当前结构超出分析范围，请减少积木或字段后重试。', INVALID_INPUT: '当前积木结构暂不支持分析。', AI_DISABLED: 'Mochi AI 尚未启用。', AI_NOT_CONFIGURED: 'Mochi AI 尚未配置。', AI_MODIFICATION_DISABLED: '目前只能解释和建议，修改计划尚未接通。',
  AI_TIMEOUT: 'Mochi 想得有点久，请稍后重试。', AI_BUSY: 'Mochi 正在思考。', THROTTLED: '先消化一下刚才的想法吧。', BUDGET_EXHAUSTED: '本次 AI 预算已用完。',
  PROACTIVE_DISABLED: '主动建议尚未开启。', DUPLICATE_EVENT: '这个变化已经分析过了。', CANCELLED: '已取消请求。' }
async function abortable(operation, signal) {
  let abort
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try { return await Promise.race([operation, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}
export function createMochiApi({ fetchImpl = globalThis.fetch, timeoutMs = 25_000 } = {}) {
  async function request(path, input, { signal } = {}) {
    const controller = new AbortController(); let timedOut = false
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort()
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    let received
    try {
      controller.signal.throwIfAborted()
      const fetching = Promise.resolve(fetchImpl(`/api/mochi-ai/${path}`, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
        headers: input === undefined ? {} : { 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }))
      void fetching.then(response => { if (controller.signal.aborted) void response.body?.cancel().catch(() => {}) }).catch(() => {})
      const response = received = await abortable(fetching, controller.signal)
      check(response.body && Number(response.headers.get('content-length')) <= LIMITS.responseBytes, 'AI_INVALID_RESPONSE', 'Mochi 返回了无效数据。', 502)
      const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let content = '', size = 0
      try {
        for (;;) { controller.signal.throwIfAborted(); const { done, value } = await abortable(reader.read(), controller.signal); if (done) break; size += value.byteLength
          check(size <= LIMITS.responseBytes, 'AI_INVALID_RESPONSE', 'Mochi 回复过大。', 502); content += decoder.decode(value, { stream: true }) }
        controller.signal.throwIfAborted(); content += decoder.decode()
      } catch (error) {
        if (controller.signal.aborted || error instanceof MochiError) throw error
        throw new MochiError('AI_INVALID_RESPONSE', 'Mochi 返回了无效数据。', 502)
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
      let result
      try { result = JSON.parse(content) }
      catch { throw new MochiError('AI_INVALID_RESPONSE', 'Mochi 返回了无效数据。', 502) }
      if (!response.ok) {
        const code = result?.error?.code
        const known = typeof code === 'string' && Object.hasOwn(errors, code)
        throw new MochiError(known ? code : 'AI_UNAVAILABLE', known ? errors[code] : 'Mochi 暂时无法回答，请稍后重试。', response.status)
      }
      return result
    } catch (error) {
      if (timedOut) throw new MochiError('AI_TIMEOUT', errors.AI_TIMEOUT, 504)
      if (signal?.aborted) throw new MochiError('CANCELLED', errors.CANCELLED, 499)
      if (error instanceof MochiError) throw error
      throw new MochiError('AI_UNAVAILABLE', 'Mochi 暂时无法回答，请稍后重试。', 502)
    } finally {
      clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort)
      if (received?.body && !received.body.locked) void received.body.cancel().catch(() => {})
    }
  }
  return { status: options => request('status', undefined, options), async analyze(input, options) { const safe = validateRequest(input); return validateReply(await request('analyze', safe, options), safe.context) },
    consent: (enabled, { appId, instanceId } = {}) => request('consent', { enabled, ...(appId === undefined ? {} : { appId }), ...(instanceId === undefined ? {} : { instanceId }) }), ignore: id => request('ignore', { id }) }
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
export function createMochiConversation({ api = createMochiApi(), readContext, focusBlock, requestPlan, planningEnabled = true, suggestionTtlMs = 600_000, now = Date.now }) {
  check(Number.isSafeInteger(suggestionTtlMs) && suggestionTtlMs > 0 && suggestionTtlMs <= 600_000, 'INVALID_INPUT')
  const canPlan = planningEnabled && typeof requestPlan === 'function'
  let state = freeze({ contextAvailable: true, enabled: false, disabledReason: '正在检查 Mochi AI 状态…', proactiveEnabled: false, busy: false, modificationsEnabled: false, planningEnabled: canPlan, messages: [], suggestions: [], deferredSuggestions: [], error: null })
  let disposed = false, pending = null, epoch = 0, actionEpoch = 0, signature = '', identity = '', prompts = [], lastProactive = -Infinity, consentSequence = 0, statusSequence = 0
  let consentTail = Promise.resolve()
  let projectTransitions = 0, firstStatusIdentity = ''
  const messageFor = (code, fallback) => typeof code === 'string' && Object.hasOwn(errors, code) ? errors[code] : fallback
  const codeFor = (error, fallback) => typeof error?.code === 'string' && Object.hasOwn(errors, error.code) ? error.code : fallback
  const listeners = new Set(), seen = new Map(), ignored = new Map(), events = new Map(), provenance = new WeakMap(), rejected = new WeakSet(), planning = new Set()
  const COOLDOWN = 600_000
  function emit(patch) {
    if (disposed) return
    state = freeze({ ...state, ...patch })
    // Observers cannot undo publication or prevent retired transports aborting.
    listeners.forEach(fn => { try { fn() } catch { /* Isolate observer failures. */ } })
  }
  function remember(map, key) { if (map.size >= 200) map.delete(map.keys().next().value); map.set(key, now() + COOLDOWN) }
  function purge() { for (const map of [seen, ignored, events]) for (const [k, expiry] of map) if (expiry <= now()) map.delete(k) }
  function refreshSuggestions() {
    if (disposed) return
    purge()
    const active = state.suggestions.filter(s => s.expiresAt > now())
    const deferred = state.deferredSuggestions.filter(s => s.expiresAt > now())
    const awakened = deferred.filter(s => s.snoozedUntil <= now())
    if (active.length !== state.suggestions.length || deferred.length !== state.deferredSuggestions.length || awakened.length) {
      emit({ suggestions: [...active, ...awakened], deferredSuggestions: deferred.filter(s => s.snoozedUntil > now()) })
    }
  }
  function retire(patch = {}, selectionOnly = false) {
    epoch++
    if (!selectionOnly) actionEpoch++
    const previous = pending
    pending = null
    emit({ ...patch, busy: false })
    // Abort callbacks may synchronously start a new request. Detach the retired
    // controller and publish its idle state before invoking those callbacks.
    previous?.abort()
  }
  function cancel() { retire() }
  function syncContext() {
    check(!disposed, 'DISPOSED', 'Mochi 会话已关闭。')
    let context
    try { context = projectContext(readContext()) }
    catch (error) {
      const changed = signature !== '' || state.contextAvailable
      signature = ''
      if (changed) retire({ contextAvailable: false, suggestions: [], deferredSuggestions: [], error: { code: codeFor(error, 'CONTEXT_UNAVAILABLE'), message: messageFor(error?.code, errors.CONTEXT_UNAVAILABLE) } })
      throw error
    }
    const nextIdentity = `${context.appId}:${context.instanceId}`, next = JSON.stringify(context)
    if (next !== signature) {
      const newProject = identity !== nextIdentity
      const selectionOnly = signature !== '' && JSON.stringify({ ...JSON.parse(signature), selectedBlockId: context.selectedBlockId }) === next
      // Publish a coherent identity/history before notifying or aborting. Both
      // callbacks may synchronously synchronize or enter a newer project.
      const changedProject = newProject && (identity !== '' || firstStatusIdentity !== '' && firstStatusIdentity !== nextIdentity)
      signature = next; identity = nextIdentity
      if (changedProject) { projectTransitions++; consentSequence++; statusSequence++ }
      if (newProject) { prompts = []; seen.clear(); ignored.clear(); events.clear(); lastProactive = -Infinity }
      retire({ contextAvailable: true, ...(newProject ? { messages: [] } : {}), ...(changedProject ? { proactiveEnabled: false } : {}), suggestions: [], deferredSuggestions: [], error: null }, selectionOnly)
    } else if (!state.contextAvailable) emit({ contextAvailable: true, error: null })
    return context
  }
  async function refreshStatus() {
    check(!disposed, 'DISPOSED')
    const sequence = ++statusSequence, consentAtStart = consentSequence
    const projectAtStart = projectTransitions
    let statusContext
    try { statusContext = projectContext(readContext()) } catch { /* A pending projection cannot restore project consent. */ }
    if (statusContext && firstStatusIdentity === '') firstStatusIdentity = `${statusContext.appId}:${statusContext.instanceId}`
    await consentTail.catch(() => {})
    if (disposed || sequence !== statusSequence) return state
    let result
    try {
      result = await api.status()
      if (disposed || sequence !== statusSequence) return state
      check(result && typeof result === 'object' && !Array.isArray(result) && typeof result.enabled === 'boolean' && typeof result.proactiveEnabled === 'boolean' && result.modificationsEnabled === false, 'AI_INVALID_RESPONSE')
      check(result.proactiveAppId === undefined || id(result.proactiveAppId), 'AI_INVALID_RESPONSE')
      check(result.proactiveInstanceId === undefined || id(result.proactiveInstanceId) && result.proactiveAppId !== undefined, 'AI_INVALID_RESPONSE')
    }
    catch (error) {
      if (!disposed && sequence === statusSequence) retire({ enabled: false, proactiveEnabled: false, suggestions: [], deferredSuggestions: [], disabledReason: messageFor(error?.code, 'Mochi 暂时无法连接，请稍后检查连接。') })
      throw error
    }
    if (disposed || sequence !== statusSequence) return state
    let sameStatusProject = false
    try { const current = projectContext(readContext()); sameStatusProject = statusContext?.appId === current.appId && statusContext?.instanceId === current.instanceId } catch { /* No current project grant. */ }
    // Old single-project adapters omit instance scope. Their initial status is
    // compatible, but cannot restore consent after any project replacement.
    const scopedConsent = sameStatusProject && projectAtStart === projectTransitions && (result.proactiveInstanceId === undefined
      ? projectTransitions === 0 && firstStatusIdentity === `${statusContext?.appId}:${statusContext?.instanceId}`
        && (result.proactiveAppId === undefined || result.proactiveAppId === statusContext?.appId)
      : result.proactiveAppId === statusContext?.appId && result.proactiveInstanceId === statusContext?.instanceId)
    const patch = { enabled: result.enabled, disabledReason: result.enabled ? null : messageFor(result.reason, errors.AI_DISABLED), proactiveEnabled: result.enabled && (consentAtStart === consentSequence ? result.proactiveEnabled && scopedConsent : state.proactiveEnabled) }
    if (!result.enabled || (state.proactiveEnabled && !patch.proactiveEnabled)) retire({ ...patch, suggestions: [], deferredSuggestions: [] })
    else emit(patch)
    return state
  }
  async function setProactive(enabled) {
    check(typeof enabled === 'boolean' && !disposed, 'INVALID_INPUT')
    let context
    if (enabled) context = syncContext()
    else { try { context = projectContext(readContext()) } catch { /* A global opt-out must still work without context. */ } }
    const projectAtStart = projectTransitions
    const ownsProject = () => {
      if (projectAtStart !== projectTransitions) return false
      try { const current = projectContext(readContext()); return context?.appId === current.appId && context?.instanceId === current.instanceId } catch { return false }
    }
    const sequence = ++consentSequence
    // Serialize consent writes so rapid on/off cannot leave the server enabled.
    const write = consentTail.catch(() => {}).then(() => {
      // Never send a queued opt-in from a closed conversation. An explicit
      // opt-out must still follow an already sent opt-in to preserve revocation.
      if (enabled) {
        check(!disposed, 'DISPOSED', 'Mochi 会话已关闭。')
        check(ownsProject(), 'CONTEXT_CHANGED', '项目已变化，请重新开启主动建议。', 409)
      }
      return api.consent(enabled, context ? { appId: context.appId, instanceId: context.instanceId } : undefined)
    })
    consentTail = write
    // Reserve queue order before observers can synchronously change consent.
    if (!enabled) retire({ proactiveEnabled: false, suggestions: [], deferredSuggestions: [] })
    try {
      const result = await write
      check(result.proactiveEnabled === enabled, 'AI_INVALID_RESPONSE')
      if (sequence === consentSequence && (!enabled || ownsProject())) emit({ proactiveEnabled: enabled && state.enabled })
    } catch (error) { if (sequence === consentSequence) emit({ proactiveEnabled: false, error: { code: codeFor(error, 'AI_UNAVAILABLE'), message: '主动建议设置失败，请重试。' } }); throw error }
  }
  async function run(kind, prompt, event) {
    const context = syncContext(); purge()
    const requestSignature = JSON.stringify(context)
    const contextCurrent = () => signature === requestSignature && JSON.stringify(projectContext(readContext())) === requestSignature
    check(!disposed && contextCurrent(), 'CONTEXT_CHANGED', '项目已变化，请重新提问。', 409)
    check(context.mode === 'blocks', 'MODE_UNAVAILABLE', '请回到 B 模式再和 Mochi 聊聊。', 409)
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
    const controller = new AbortController(), owned = epoch
    pending = controller
    try {
      // Reserve ownership before notifying subscribers. They can synchronously
      // cancel, dispose or start a replacement while this state is published.
      let messages = state.messages
      if (kind === 'chat') { prompts.push(input.prompt); prompts = prompts.slice(-LIMITS.history); messages = [...messages, { role: 'user', content: input.prompt }].slice(-40) }
      emit({ busy: true, error: null, messages })
      check(!disposed && !controller.signal.aborted && pending === controller && owned === epoch && contextCurrent(), 'CONTEXT_CHANGED', '已丢弃过期请求。', 409)
      const reply = await abortable(Promise.resolve(api.analyze(input, { signal: controller.signal })), controller.signal)
      check(!disposed && !controller.signal.aborted && owned === epoch && contextCurrent(), 'CONTEXT_CHANGED', '已丢弃过期回复。', 409)
      validateReply(reply, context)
      const createdAt = now()
      const suggestions = reply.suggestions.filter(s => {
        const key = fingerprint(s)
        if (seen.has(key) || ignored.has(key)) return false
        remember(seen, key); return true
      }).map(s => { const item = { ...s, createdAt, expiresAt: createdAt + suggestionTtlMs }; provenance.set(item, kind); return item })
      emit({ messages: [...state.messages, { role: 'assistant', content: reply.message }].slice(-40), suggestions })
      return { ...reply, suggestions }
    } catch (error) {
      if (controller.signal.aborted || disposed || owned !== epoch) throw new MochiError('CONTEXT_CHANGED', '已丢弃过期回复。', 409)
      if (owned === epoch && !disposed) emit({ error: { code: codeFor(error, 'AI_UNAVAILABLE'), message: messageFor(error?.code, 'Mochi 暂时无法回答，请稍后重试。') } })
      throw error
    } finally { if (pending === controller) { pending = null; emit({ busy: false }) } }
  }
  function suggestion(id, deferred = false) {
    check(!disposed, 'DISPOSED', 'Mochi 会话已关闭。')
    refreshSuggestions()
    check(!disposed, 'DISPOSED', 'Mochi 会话已关闭。')
    const item = (deferred ? [...state.suggestions, ...state.deferredSuggestions] : state.suggestions).find(s => s.id === id)
    check(item, 'SUGGESTION_EXPIRED', '建议已过期。', 409)
    const context = projectContext(readContext())
    check(JSON.stringify(context) === signature && (item.blockId === null || context.blocks.some(b => b.id === item.blockId)), 'CONTEXT_CHANGED', '积木已变化，请重新分析。', 409)
    return item
  }
  function focusForAction(item) {
    const before = projectContext(readContext()), owned = actionEpoch, contextEpoch = epoch
    if (item.blockId !== null) focusBlock(item.blockId)
    check(!disposed, 'DISPOSED', 'Mochi 会话已关闭。')
    const after = projectContext(readContext())
    check(actionEpoch === owned && (epoch === contextEpoch || (epoch === contextEpoch + 1 && before.selectedBlockId !== after.selectedBlockId && after.selectedBlockId === item.blockId))
      && JSON.stringify({ ...before, selectedBlockId: after.selectedBlockId }) === JSON.stringify(after)
      && (after.selectedBlockId === before.selectedBlockId || after.selectedBlockId === item.blockId), 'CONTEXT_CHANGED', '项目已变化，请重新提问。', 409)
    return after
  }
  return {
    getSnapshot: () => state,
    subscribe(fn) { check(!disposed, 'DISPOSED'); listeners.add(fn); return () => listeners.delete(fn) },
    syncContext, refreshStatus, refreshSuggestions, setProactive, cancel,
    chat: prompt => run('chat', prompt), onEvent: event => run('proactive', undefined, event),
    focusSuggestion(id) { const item = suggestion(id); if (item.blockId !== null) focusBlock(item.blockId); return item },
    async continueSuggestion(id, question) {
      const item = suggestion(id)
      focusForAction(item)
      return run('chat', question || `请解释这条建议：${item.text}`)
    },
    async ignore(id) {
      const item = suggestion(id, true), owned = signature, ownedEpoch = epoch
      rejected.add(item)
      remember(ignored, fingerprint(item))
      emit({ suggestions: state.suggestions.filter(s => s.id !== id), deferredSuggestions: state.deferredSuggestions.filter(s => s.id !== id) })
      // Publication can synchronously close the panel or replace its project.
      // Do not dispatch the retired action into the host's new access scope.
      check(!disposed, 'DISPOSED', 'Mochi 会话已关闭。')
      check(epoch === ownedEpoch && signature === owned && JSON.stringify(projectContext(readContext())) === owned, 'CONTEXT_CHANGED', '项目已变化，请重新提问。', 409)
      await api.ignore(id)
    },
    reject(id) { return this.ignore(id) },
    snooze(id, delayMs = 60_000) {
      check(Number.isSafeInteger(delayMs) && delayMs > 0 && delayMs <= 600_000, 'INVALID_INPUT')
      const item = suggestion(id)
      const deferred = { ...item, snoozedUntil: Math.min(now() + delayMs, item.expiresAt) }
      provenance.set(deferred, provenance.get(item)); rejected.add(item)
      emit({ suggestions: state.suggestions.filter(s => s.id !== id), deferredSuggestions: [...state.deferredSuggestions, deferred] })
    },
    resume(id) {
      const item = suggestion(id, true)
      if (state.suggestions.includes(item)) return
      emit({ suggestions: [...state.suggestions, item], deferredSuggestions: state.deferredSuggestions.filter(s => s.id !== id) })
    },
    requestModification(id) {
      // Keep the legacy synchronous refusal when no trusted preview bridge exists.
      const item = suggestion(id)
      check(canPlan, 'AI_MODIFICATION_DISABLED', errors.AI_MODIFICATION_DISABLED, 503)
      return (async () => {
        check(item.kind === 'design-change' && item.requiresUserAction && item.blockId !== null, 'SUGGESTION_NOT_EXECUTABLE', '这条建议不能生成修改计划。', 409)
        check(!planning.has(id), 'AI_BUSY', errors.AI_BUSY, 429)
        const after = focusForAction(item), owned = actionEpoch, expected = JSON.stringify(after)
        const validate = () => {
          check(!disposed, 'DISPOSED', 'Mochi 会话已关闭。')
          check(now() < item.expiresAt && !rejected.has(item), 'SUGGESTION_EXPIRED', '建议已过期或已处理，请重新分析。', 409)
          check(state.enabled && (provenance.get(item) !== 'proactive' || state.proactiveEnabled), 'PROACTIVE_DISABLED', errors.PROACTIVE_DISABLED, 403)
          check(actionEpoch === owned && JSON.stringify(projectContext(readContext())) === expected, 'CONTEXT_CHANGED', '积木已变化，请重新分析。', 409)
        }
        validate(); planning.add(id)
        try { return await requestPlan(item, freeze({ validate, expiresAt: item.expiresAt })) }
        finally { planning.delete(id) }
      })()
    },
    dispose() { disposed = true; cancel(); listeners.clear() },
  }
}
