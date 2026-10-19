import { createRequire } from 'node:module'
import { types } from 'node:util'
import { isPaidTransport, supportsPaidAdmission } from '../paid-gateway/provider.mjs'
import { PRICING } from '../paid-gateway/pricing.mjs'
import { abortable } from '../ai-abort.mjs'
const { APP_SPEC_EDIT_INSTRUCTION, validatePlan, assertProjectState } = createRequire(import.meta.url)('./.generated/server/mochi-plan/trusted.js')
const PATH = '/api/mochi-plan'
const ENDPOINT = 'https://api.deepseek.com/chat/completions'
const LIMIT = 16 * 1024
const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,199}$/.test(value)
class PlanError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status } }
const check = (value, code = 'INVALID_INPUT', status = 400) => { if (!value) throw new PlanError(code, status) }
const exact = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)))
function input(raw) {
  exact(raw, ['appId', 'instanceId', 'selectedBlockId', 'revision', 'requestId', 'prompt'])
  check(['appId', 'instanceId', 'selectedBlockId', 'requestId'].every(k => id(raw[k])))
  check(Number.isSafeInteger(raw.revision) && raw.revision >= 0)
  check(typeof raw.prompt === 'string' && raw.prompt.trim().length > 0 && raw.prompt.length <= 2000)
  return Object.freeze({ ...raw })
}
function project(raw, access, binding) {
  // Trusted adapter output is copied before awaits, and must match authenticated
  // ownership + the entire generation binding. Client context is never authority.
  check(raw && raw.readOnly === false && raw.ownerId === access.subjectId, 'FORBIDDEN', 403)
  check(raw.appId === binding.appId && raw.instanceId === binding.instanceId && raw.revision === binding.revision
    && raw.selectedBlockId === binding.selectedBlockId && raw.snapshot?.spec?.id === binding.appId
    && raw.snapshot?.revision === binding.revision, 'STALE_CONTEXT', 409)
  const snapshot = structuredClone(raw.snapshot)
  check(Buffer.byteLength(JSON.stringify(snapshot)) <= 2 * 1024 * 1024, 'CONTEXT_LIMIT', 413)
  try { assertProjectState(snapshot) } catch { throw new PlanError('INVALID_CONTEXT') }
  const block = snapshot.spec.blocks.find(b => b.id === binding.selectedBlockId)
  const relations = snapshot.spec.relations.filter(r => r.blockId === block?.id)
  const entity = snapshot.spec.entities.find(e => e.id === relations[0]?.entityId)
  check(block && ['form', 'list', 'metric'].includes(block.type) && relations.length === 1 && entity, 'INVALID_SELECTION')
  return { snapshot, ownerId: raw.ownerId, minimal: {
    requestId: binding.requestId, baseRevision: binding.revision, prompt: binding.prompt,
    block: { id: block.id, name: block.name, type: block.type, fieldIds: [...(block.fieldIds ?? [])] },
    entity: { id: entity.id, name: entity.name, fields: entity.fields.map(({ id, name, type }) => ({ id, name, type })) },
  } }
}
async function read(stream, signal, limit) {
  const chunks = []; let size = 0
  const reader = stream.getReader()
  try {
    for (;;) {
      const { value, done } = await abortable(reader.read(), signal)
      if (done) break
      size += value.byteLength; check(size <= limit, 'BODY_LIMIT', 413); chunks.push(Buffer.from(value))
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
function send(res, status, value) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' })
  res.end(JSON.stringify(value))
}
/** Explicit default-off mount seam. No listener, env activation, key, alternate
 * fetch, Runtime or Confirm route. Transport MUST be the shared gateway object.
 * authenticate and resolveProject are server-owned, independently audited adapters.
 */
export function createMochiPlanHandler({ enabled = false, approval, transport, authenticate, resolveProject, acquireAdmission, allowedOrigin,
  timeoutMs = 20_000, now = Date.now } = {}) {
  check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30_000, 'CONFIGURATION')
  approval = approval && Object.freeze({ ...approval })
  let active = false, calls = 0
  const seen = new Set()
  // A hard process cap complements the durable shared gateway ledger. Rotating
  // sessions/projects cannot reset this counter; failures are never refunded.
  function gate() {
    check(enabled === true && approval?.providerVerified === true && approval?.permissionsVerified === true
      && typeof approval.reference === 'string' && approval.reference.length > 0
      && Number.isSafeInteger(approval.expiresAt) && approval.expiresAt > now()
      && Number.isSafeInteger(approval.maxCalls) && approval.maxCalls > 0 && approval.maxCalls <= 6,
    'PLAN_DISABLED', 503)
    check(isPaidTransport(transport) && supportsPaidAdmission(transport) && typeof authenticate === 'function' && typeof resolveProject === 'function' && typeof acquireAdmission === 'function'
      && typeof allowedOrigin === 'string' && /^https?:\/\//.test(allowedOrigin), 'PLAN_DISABLED', 503)
  }
  return async (req, res) => {
    if (req.url !== PATH) return false
    const controller = new AbortController(); let timedOut = false, authTimedOut = false, acquired = false, lease, uploadComplete = false
    const abort = () => controller.abort()
    const close = () => { if (!res.writableEnded) abort() }
    res.once('close', close); req.once('aborted', abort)
    const timer = setTimeout(() => { timedOut = true; abort() }, timeoutMs)
    if (req.aborted || res.destroyed) abort()
    try {
      gate()
      check(req.method === 'POST', 'METHOD_NOT_ALLOWED', 405)
      check(req.headers.origin === allowedOrigin, 'ORIGIN_REJECTED', 403)
      check(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''), 'UNSUPPORTED_MEDIA_TYPE', 415)
      check(!req.headers['content-encoding'] || req.headers['content-encoding'] === 'identity', 'UNSUPPORTED_MEDIA_TYPE', 415)
      check(!active, 'PLAN_BUSY', 429); active = acquired = true
      controller.signal.throwIfAborted()
      const authenticateCurrent = async () => {
        controller.signal.throwIfAborted()
        const authTimer = setTimeout(() => { authTimedOut = true; abort() }, 2000)
        try {
          const current = await abortable(Promise.resolve().then(() => authenticate(req, { signal: controller.signal })), controller.signal)
          controller.signal.throwIfAborted()
          check(current && id(current.sessionId) && id(current.subjectId), 'UNAUTHORIZED', 401)
          return Object.freeze({ sessionId: current.sessionId, subjectId: current.subjectId })
        } finally { clearTimeout(authTimer) }
      }
      const access = await authenticateCurrent()
      const reauthorize = async () => {
        const current = await authenticateCurrent()
        check(current.sessionId === access.sessionId && current.subjectId === access.subjectId, 'UNAUTHORIZED', 401)
      }
      check(Number(req.headers['content-length'] || 0) <= LIMIT, 'BODY_LIMIT', 413)
      // Async iterator completion/error is bounded even for an unfinished upload.
      const reading = (async () => {
        const chunks = []; let size = 0
        for await (const chunk of req) { size += chunk.length; check(size <= LIMIT, 'BODY_LIMIT', 413); chunks.push(chunk) }
        uploadComplete = true
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      })()
      const binding = input(await abortable(reading, controller.signal))
      const requestKey = JSON.stringify([access.sessionId, binding.requestId])
      check(!seen.has(requestKey), 'DUPLICATE_REQUEST', 409)
      const resolve = async () => {
        controller.signal.throwIfAborted()
        const raw = await abortable(Promise.resolve().then(() => resolveProject(access, binding, { signal: controller.signal })), controller.signal)
        controller.signal.throwIfAborted(); return project(raw, access, binding)
      }
      const before = await resolve()
      await reauthorize()
      // This lease must observe live server-owned session/project epochs. A
      // cached auth snapshot is insufficient. Late acquisition is retired too.
      const acquiring = Promise.resolve().then(() => acquireAdmission(access, binding, { signal: controller.signal }))
      void acquiring.then(value => { if (controller.signal.aborted) value?.release?.() }).catch(() => {})
      lease = await abortable(acquiring, controller.signal)
      check(lease && typeof lease.assertCurrent === 'function' && typeof lease.release === 'function', 'ADMISSION_UNAVAILABLE', 503)
      const leaseGuard = lease.assertCurrent.bind(lease)
      const assertCurrent = () => {
        controller.signal.throwIfAborted(); gate()
        const current = leaseGuard()
        if (types.isPromise(current)) void current.catch(() => {})
        check(current === true, 'AUTHORIZATION_REVOKED', 403)
        return true
      }
      assertCurrent()
      const messages = [{ role: 'system', content: APP_SPEC_EDIT_INSTRUCTION }, { role: 'user', content: JSON.stringify(before.minimal) }]
      check(Buffer.byteLength(JSON.stringify(messages)) <= 65536, 'INPUT_LIMIT', 413)
      gate(); check(calls < approval.maxCalls, 'BUDGET_EXHAUSTED', 429)
      controller.signal.throwIfAborted(); calls++; seen.add(requestKey)
      let response
      try {
        const fetching = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return transport(ENDPOINT, {
          method: 'POST', signal: controller.signal, body: JSON.stringify({ model: PRICING.model, messages,
            response_format: { type: 'json_object' }, stream: false, max_tokens: 2048 }),
        }, { assertCurrent }) })
        void fetching.then(r => { if (controller.signal.aborted) void r.body?.cancel().catch(() => {}) }).catch(() => {})
        response = await abortable(fetching, controller.signal)
        check(response.ok && response.body, 'MODEL_UNAVAILABLE', 502)
        const envelope = await read(response.body, controller.signal, 262144)
        const choice = envelope?.choices?.[0]
        check(envelope.model === PRICING.model && envelope.choices?.length === 1 && choice?.finish_reason === 'stop'
          && choice.message?.role === 'assistant' && typeof choice.message.content === 'string'
          && !choice.message.tool_calls && !choice.message.refusal, 'INVALID_PLAN', 502)
        check(Buffer.byteLength(choice.message.content) <= 65536, 'INVALID_PLAN', 502)
        let candidate
        try {
          candidate = JSON.parse(choice.message.content)
          check(candidate?.request?.requestId === binding.requestId && candidate.request.baseRevision === binding.revision, 'INVALID_PLAN', 502)
          candidate = validatePlan(candidate, before.snapshot, binding.selectedBlockId)
        } catch { throw new PlanError('INVALID_PLAN', 502) }
        await reauthorize()
        const after = await resolve()
        check(before.ownerId === after.ownerId && JSON.stringify(before.snapshot) === JSON.stringify(after.snapshot), 'STALE_CONTEXT', 409)
        assertCurrent()
        send(res, 200, candidate)
      } finally { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {}) }
    } catch (error) {
      const safe = error instanceof PlanError ? error : new PlanError(authTimedOut ? 'AUTH_TIMEOUT' : timedOut ? 'PLAN_TIMEOUT' : controller.signal.aborted ? 'CANCELLED' : 'PLAN_UNAVAILABLE', authTimedOut || timedOut ? 504 : controller.signal.aborted ? 499 : 503)
      send(res, safe.status, { error: { code: safe.code } })
    } finally {
      clearTimeout(timer); controller.abort()
      try { lease?.release?.() } catch { /* retiring cannot authorize another call */ }
      // End pending upload iteration; only destroy after the error response is
      // flushed so an unfinished body cannot retain a socket/iterator forever.
      if (!uploadComplete && !req.destroyed) {
        if (res.writableFinished || res.destroyed) req.destroy()
        else { res.once('finish', () => req.destroy()); res.once('close', () => req.destroy()) }
      }
      res.off('close', close); req.off('aborted', abort)
      if (acquired) active = false
    }
    return true
  }
}
