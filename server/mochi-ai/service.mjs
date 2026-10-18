import { createHash, randomUUID } from 'node:crypto'
import { MochiError, check, validateRequest, validateAdvice, binding, fingerprint, object } from '../../src/integrations/mochi-ai/protocol.mjs'
import { tokenReservation } from './provider.mjs'
export const POLICY = Object.freeze({ sessionMs: 3_600_000, sessionCalls: 8, sessionTokens: 100_000,
  chatIntervalMs: 2000, proactiveIntervalMs: 30_000, cooldownMs: 600_000, concurrency: 2, sessions: 1000, seen: 200 })
const denied = (code, message, status = 429) => { throw new MochiError(code, message, status) }
/** One service per approved process. Counters reserve before egress and never refund failures.
 * resolveAccess is a trusted authenticated host adapter, never a body/header sessionId.
 */
export function createMochiService({ provider, enabled = false, approval, reserveBudget, now = Date.now } = {}) {
  approval = approval && Object.freeze({ ...approval })
  const sessions = new Map(); let calls = 0, tokens = 0, inFlight = 0
  function gate() {
    if (!enabled || approval?.providerVerified !== true || approval?.permissionsVerified !== true || !approval?.reference ||
      !Number.isSafeInteger(approval.maxCalls) || approval.maxCalls <= 0 ||
      !Number.isSafeInteger(approval.maxTotalTokens) || approval.maxTotalTokens <= 0 ||
      !Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= now()) denied('AI_DISABLED', 'Mochi AI 尚未启用，可继续手动编辑。', 503)
    if (typeof reserveBudget !== 'function') denied('BUDGET_UNAVAILABLE', 'Mochi AI 尚未配置可信持久费用控制。', 503)
    if (!provider?.configured) denied('AI_NOT_CONFIGURED', 'Mochi AI 尚未配置。', 503)
  }
  function session(access) {
    check(access && typeof access.sessionId === 'string' && access.sessionId.length > 0 && access.sessionId.length <= 200 && typeof access.appId === 'string', 'UNAUTHORIZED', '请先建立可信应用会话。', 401)
    // A session's cost allowance is shared across apps; changing projects cannot reset it.
    for (const [key, value] of sessions) if (value.expiresAt <= now() && !value.busy) sessions.delete(key)
    let state = sessions.get(access.sessionId)
    if (!state) {
      if (sessions.size >= POLICY.sessions) denied('SERVER_BUSY', 'Mochi 暂时忙碌，请稍后重试。', 503)
      state = { expiresAt: now() + POLICY.sessionMs, calls: 0, tokens: 0, lastChat: -Infinity, lastProactive: -Infinity, busy: false, consent: false, seen: new Map(), events: new Map(), consentEpoch: 0 }
      sessions.set(access.sessionId, state)
    }
    for (const map of [state.seen, state.events]) for (const [key, expiry] of map) if (expiry <= now()) map.delete(key)
    return state
  }
  function remember(map, key) {
    if (map.size >= POLICY.seen) map.delete(map.keys().next().value)
    map.set(key, now() + POLICY.cooldownMs)
  }
  function scope(access, block = '') { return `${access.appId}:${block}` }
  return {
    status(access) {
      const state = session(access)
      try { gate(); return { enabled: true, proactiveEnabled: state.consent, modificationsEnabled: false } }
      catch (e) { return { enabled: false, proactiveEnabled: false, modificationsEnabled: false, reason: e.code } }
    },
    consent(access, input) {
      object(input, ['enabled']); check(typeof input.enabled === 'boolean')
      const state = session(access)
      // Revocation always works, even if the provider was disabled meanwhile.
      if (input.enabled) gate()
      state.consent = input.enabled; state.consentEpoch++
      if (!input.enabled) state.controller?.abort()
      return { proactiveEnabled: state.consent, modificationsEnabled: false }
    },
    ignore(access, input) {
      object(input, ['id']); check(typeof input.id === 'string' && /^ai-[a-f0-9]{32}$/.test(input.id))
      const state = session(access); remember(state.seen, scope(access, input.id))
      return { ignored: true, cooldownMs: POLICY.cooldownMs }
    },
    async analyze(access, raw, { signal } = {}) {
      gate()
      const state = session(access), input = validateRequest(raw)
      check(input.context.mode === 'blocks', 'MODE_UNAVAILABLE', '请回到 B 模式再提问。', 409)
      check(input.context.appId === access.appId, 'CONTEXT_MISMATCH', '应用上下文已变化。', 409)
      if (input.kind === 'proactive' && !state.consent) denied('PROACTIVE_DISABLED', '主动建议尚未开启。', 403)
      if (state.busy || inFlight >= POLICY.concurrency) denied('AI_BUSY', 'Mochi 正在思考，请稍候。')
      const proactive = input.kind === 'proactive', timeKey = proactive ? 'lastProactive' : 'lastChat'
      const interval = proactive ? POLICY.proactiveIntervalMs : POLICY.chatIntervalMs
      if (now() - state[timeKey] < interval) denied('THROTTLED', '先消化一下刚才的想法吧。')
      const { revision: _revision, instanceId: _instance, ...eventContext } = input.context
      const eventKey = JSON.stringify([scope(access), input.event?.type, eventContext])
      if (proactive && state.events.has(eventKey)) denied('DUPLICATE_EVENT', '这个变化已经分析过了。')
      const reservation = tokenReservation(input)
      if (calls >= approval.maxCalls || tokens + reservation > approval.maxTotalTokens || state.calls >= POLICY.sessionCalls || state.tokens + reservation > POLICY.sessionTokens) denied('BUDGET_EXHAUSTED', '本次 AI 预算已用完。')
      signal?.throwIfAborted()
      state.calls++; calls++; state.tokens += reservation; tokens += reservation
      state[timeKey] = now(); state.busy = true; inFlight++
      if (proactive) remember(state.events, eventKey)
      const epoch = state.consentEpoch
      const controller = new AbortController(); state.controller = proactive ? controller : undefined
      const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true })
      let budgetTimer, budgetAbort
      try {
        // Deployment adapter atomically reserves a monetary allowance in its
        // durable shared ledger, using approved model pricing. No prompt/data.
        // Memory counters above are additional limits, never a currency cap.
        let admitted
        try {
          admitted = await Promise.race([
            reserveBudget(Object.freeze({ requestId: randomUUID(), sessionId: access.sessionId, appId: access.appId,
              approvalReference: approval.reference, model: provider.model, maxTokens: reservation, signal: controller.signal })),
            new Promise((_, reject) => { budgetTimer = setTimeout(() => { reject(new Error('Budget timeout')); controller.abort() }, 5000) }),
            new Promise((_, reject) => {
              budgetAbort = () => reject(new MochiError('CANCELLED', '已取消本次请求。', 499))
              controller.signal.addEventListener('abort', budgetAbort, { once: true })
              if (controller.signal.aborted) budgetAbort()
            }),
          ])
        } catch (error) {
          if (error instanceof MochiError && error.code === 'CANCELLED') throw error
          denied('BUDGET_UNAVAILABLE', '费用控制暂不可用，未调用模型。', 503)
        } finally { clearTimeout(budgetTimer); controller.signal.removeEventListener('abort', budgetAbort) }
        if (admitted !== true) denied('BUDGET_EXHAUSTED', '费用额度不足，未调用模型。')
        if (controller.signal.aborted) denied('CANCELLED', '已取消本次请求。', 499)
        gate()
        const advice = validateAdvice(await provider.analyze(input, { signal: controller.signal }), input.context)
        if (controller.signal.aborted || (proactive && (!state.consent || epoch !== state.consentEpoch))) denied('CANCELLED', '已取消本次请求。', 499)
        const suggestions = []
        for (const s of advice.suggestions) {
          const id = `ai-${createHash('sha256').update(fingerprint(s)).digest('hex').slice(0,32)}`
          const key = scope(access, id)
          if (state.seen.has(key)) continue
          remember(state.seen, key); suggestions.push({ ...s, id })
        }
        return { version: 1, source: 'deepseek', capabilities: { modifications: false }, binding: binding(input.context), message: advice.message, suggestions }
      } finally {
        signal?.removeEventListener('abort', abort); controller.abort()
        state.busy = false; state.controller = undefined; inFlight--
      }
    },
    // Only trusted server telemetry; never expose approval details, prompts or keys over HTTP.
    usage: () => ({ calls, reservedTokens: tokens, inFlight }),
  }
}
