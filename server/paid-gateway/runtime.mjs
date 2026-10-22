import { dirname, isAbsolute } from 'node:path'
import { openLedger } from './ledger.mjs'
import { openMochiBudget } from './mochi-budget.mjs'
import { openStudioBudget } from './studio-budget.mjs'
import { createPaidTransport } from './provider.mjs'
import { openIdempotencySidecar } from './idempotency-sidecar.mjs'
import { PRICING, STUDIO_PRICING, POLICY, SMOKE_POLICY, STUDIO_MVP_POLICY, ensure } from './pricing.mjs'

function configuration({ env, policy, profile, allowMountedDirectory = false, pricingGuard }) {
  const apiKey = env.DEEPSEEK_API_KEY?.trim()
  const ledgerPath = env.DEEPSEEK_BUDGET_LEDGER_PATH?.trim()
  ensure(policy === POLICY && profile === 'production' || policy === SMOKE_POLICY && profile === 'local-smoke' ||
    policy === STUDIO_MVP_POLICY && profile === 'studio-mvp', 'LEDGER_PROFILE')
  ensure(typeof apiKey === 'string' && apiKey.length >= 16 && apiKey.length <= 512 && !/\s/.test(apiKey), 'API_CONFIGURATION')
  ensure(typeof ledgerPath === 'string' && isAbsolute(ledgerPath), 'LEDGER_PATH_REQUIRED')
  const pricing = profile === 'production' ? PRICING : STUDIO_PRICING
  return { apiKey, ledgerPath, pricing, ledger: openLedger(ledgerPath, { pricing, policy, profile, allowMountedDirectory, pricingGuard }) }
}

export function paidGatewayHttpStatus(error) {
  if (error?.code === 'PRINCIPAL_INVALID') return 401
  if (['IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_PAYLOAD_INVALID'].includes(error?.code)) return 400
  if (['IDEMPOTENCY_REPLAY', 'IDEMPOTENCY_CONFLICT', 'REQUEST_CONTEXT_USED'].includes(error?.code)) return 409
  if (['UPSTREAM_CANCELLED', 'CANCELLED'].includes(error?.code)) return 504
  return 503
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}

function semanticPayload(payload) {
  ensure(payload && typeof payload === 'object' && !Array.isArray(payload)
    && Object.keys(payload).every(k => ['idea', 'protocol', 'fieldInput'].includes(k))
    && typeof payload.idea === 'string' && payload.idea.trim().length > 0
    && Buffer.byteLength(payload.idea) <= 65536
    && (payload.protocol === undefined || ['v1', 'trusted-interactive/1', 'mochi-field-plan/1', 'mochi-advice/1'].includes(payload.protocol))
    && (payload.fieldInput === undefined || payload.protocol === 'mochi-field-plan/1' && Buffer.byteLength(JSON.stringify(payload.fieldInput)) <= 65536), 'IDEMPOTENCY_PAYLOAD_INVALID')
  return Object.freeze({ idea: payload.idea, protocol: payload.protocol ?? 'v1', ...(payload.fieldInput === undefined ? {} : { fieldInput: payload.fieldInput }) })
}

/** Principal-bound paid runtime; identity resolution remains Core-owned. */
export function createPrincipalPaidGenerationRuntime({ env = process.env, bindingKey, fetchImpl, timeoutMs, policy = POLICY, profile = 'production', allowMountedDirectory = false, mochiEnabled = false, studioAuthorization = false, historicalDebit, verifyPricing, pricingGuard } = {}) {
  ensure(Buffer.isBuffer(bindingKey) && bindingKey.length >= 32, 'IDEMPOTENCY_KEY_REQUIRED')
  ensure(!studioAuthorization || policy === STUDIO_MVP_POLICY && profile === 'studio-mvp'
    && typeof verifyPricing === 'function' && typeof pricingGuard === 'function', 'STUDIO_AUTHORIZATION_INVALID')
  const guard = studioAuthorization ? pricingGuard : undefined
  const { apiKey, ledgerPath, ledger, pricing } = configuration({ env, policy, profile, allowMountedDirectory, pricingGuard: guard })
  let sidecar, mochiBudget, studioBudget
  const gate = { active: false }
  let closed = false
  try {
    sidecar = openIdempotencySidecar({ ledger, directory: dirname(ledgerPath), bindingKey, allowMountedDirectory })
    if (studioAuthorization) studioBudget = openStudioBudget({ ledger, directory: dirname(ledgerPath), bindingKey, pricingGuard: guard, allowMountedDirectory, historicalDebit })
    if (mochiEnabled) mochiBudget = openMochiBudget({ ledger, directory: dirname(ledgerPath), bindingKey, allowMountedDirectory, pricingGuard: guard })
    createPaidTransport({ apiKey, ledger, fetchImpl, timeoutMs, pricing, policy })
  } catch (error) {
    sidecar?.close(); ledger.close(); throw error
  }
  return Object.freeze({
    policy,
    model: pricing.model,
    forRequest({ principal, idempotencyKey, payload } = {}) {
      ensure(!closed, 'LEDGER_UNAVAILABLE')
      ensure(typeof principal === 'string' && Buffer.byteLength(principal) > 0 && Buffer.byteLength(principal) <= 256, 'PRINCIPAL_INVALID')
      ensure(typeof idempotencyKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(idempotencyKey), 'IDEMPOTENCY_KEY_INVALID')
      const semantic = semanticPayload(payload)
      let used = false
      const context = body => ({ principal, idempotencyKey, payload: Buffer.from(JSON.stringify(canonical({ semantic, request: body }))) })
      const reservationStore = {
        check(body) { ensure(!closed && !used, closed ? 'LEDGER_UNAVAILABLE' : 'REQUEST_CONTEXT_USED'); sidecar.check(context(body)) },
        reserve(body, inputBound, outputBound, requestHash) {
          // One global owner allowance covers generation, custom generation,
          // field plans and Mochi advice, without a protocol-based bypass.
          studioBudget?.reserve(inputBound, outputBound, requestHash)
          // Both advice and accepted-suggestion plans consume the same durable
          // feature allowance, in addition to the existing Studio Gateway ledger.
          if (['mochi-advice/1', 'mochi-field-plan/1'].includes(semantic.protocol) && mochiBudget) mochiBudget.reserve(inputBound, outputBound, requestHash)
          const id = sidecar.reserve({ ...context(body), inputBound, outputBound, requestHash })
          used = true
          return id
        },
      }
      return Object.freeze({ apiKey, model: pricing.model,
        fetchImpl: createPaidTransport({ apiKey, ledger, fetchImpl, timeoutMs, pricing, policy, reservationStore,
          beforeReserve: studioAuthorization ? verifyPricing : undefined, concurrencyGate: gate }) })
    },
    forMochi({ principal, idempotencyKey, input } = {}) {
      ensure(mochiBudget, 'MOCHI_BUDGET_UNAVAILABLE')
      return this.forRequest({ principal, idempotencyKey, payload: { idea: JSON.stringify(input), protocol: 'mochi-advice/1' } })
    },
    mochiBudgetStatus() { ensure(mochiBudget && !closed, 'MOCHI_BUDGET_UNAVAILABLE'); return studioBudget ? studioBudget.snapshot() : mochiBudget.snapshot() },
    forFieldPlan({ principal, idempotencyKey, input } = {}) {
      return this.forRequest({ principal, idempotencyKey, payload: { idea: input.prompt, protocol: 'mochi-field-plan/1', fieldInput: input } })
    },
    close() {
      if (closed) return
      ensure(!gate.active, 'RUNTIME_BUSY')
      closed = true; sidecar.close(); ledger.close()
    },
  })
}

/** Isolated local mock/smoke composition; the owner-controlled caller supplies environment. */
export function createPaidGenerationRuntime({ env = process.env, fetchImpl, onResponse, timeoutMs } = {}) {
  const { apiKey, ledger, pricing } = configuration({ env, policy: SMOKE_POLICY, profile: 'local-smoke' })
  try {
    const fetch = createPaidTransport({ apiKey, ledger, fetchImpl, onResponse, timeoutMs, pricing, policy: SMOKE_POLICY })
    return Object.freeze({ fetch, ledger, policy: SMOKE_POLICY, model: pricing.model, close: () => ledger.close() })
  } catch (error) { ledger.close(); throw error }
}
