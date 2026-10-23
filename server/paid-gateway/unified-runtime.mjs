import { createHash } from 'node:crypto'
import { openUnifiedLedger, UNIFIED_PRICING, UNIFIED_CUSTOMER_POLICY, UNIFIED_TEST_POLICY } from './unified-ledger.mjs'
import { createPaidTransport } from './provider.mjs'
import { ensure } from './pricing.mjs'

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

/** Only the authenticated launcher supplies account identities. No request field
 * or header selects an allowance; all protocols use the same persistent book. */
export function createUnifiedPaidRuntime({ env = process.env, ledgerPath, testPrincipal, testSessionHash,
  fetchImpl, verifyPricing, pricingGuard, allowMountedDirectory = false } = {}) {
  ensure(typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.trim().length >= 16, 'API_CONFIGURATION')
  ensure(typeof verifyPricing === 'function' && typeof pricingGuard === 'function', 'PRICING_UNVERIFIED')
  ensure(typeof testPrincipal === 'string' && testPrincipal.length > 0 && /^[a-f0-9]{64}$/.test(testSessionHash), 'PRINCIPAL_INVALID')
  const book = openUnifiedLedger(ledgerPath, { pricing: UNIFIED_PRICING, pricingGuard, allowMountedDirectory })
  const gate = { active: false }
  let closed = false
  const accountFor = principal => principal === testPrincipal || principal === testSessionHash ? 'agent-test' : 'customer'
  function budgetStatus(account = 'customer') {
    ensure(!closed && ['customer', 'agent-test'].includes(account), 'LEDGER_UNAVAILABLE')
    const state = book.forAccount(account).snapshot()
    const policy = account === 'customer' ? UNIFIED_CUSTOMER_POLICY : UNIFIED_TEST_POLICY
    const used = state.entries.reduce((sum, e) => sum + (e.status === 'settled' ? e.estimatedNano : e.reserveNano), 0)
    const known = state.entries.reduce((sum, e) => sum + (e.status === 'settled' ? e.estimatedNano : 0), 0)
    return { account, calls: state.entries.length, maxCalls: policy.maxCalls, capCny: policy.stopNano / 1e9,
      reservedCny: used / 1e9, estimatedCny: known / 1e9, remainingNano: policy.stopNano - used,
      remainingCny: (policy.stopNano - used) / 1e9,
      remainingCalls: policy.maxCalls === null ? null : policy.maxCalls - state.entries.length, halted: state.halted }
  }
  return Object.freeze({
    policy: UNIFIED_CUSTOMER_POLICY, model: UNIFIED_PRICING.model, budgetStatus,
    forRequest({ principal, idempotencyKey, payload } = {}) {
      ensure(!closed, 'LEDGER_UNAVAILABLE')
      ensure(typeof principal === 'string' && principal.length > 0 && Buffer.byteLength(principal) <= 256, 'PRINCIPAL_INVALID')
      ensure(typeof idempotencyKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(idempotencyKey), 'IDEMPOTENCY_KEY_INVALID')
      ensure(payload && typeof payload === 'object' && !Array.isArray(payload)
        && Object.keys(payload).every(k => ['idea', 'protocol', 'fieldInput'].includes(k))
        && typeof payload.idea === 'string' && payload.idea.trim().length > 0 && Buffer.byteLength(JSON.stringify(payload)) <= 131072
        && ['v1', 'trusted-interactive/1', 'mochi-field-plan/1', 'mochi-advice/1'].includes(payload.protocol ?? 'v1')
        && (payload.fieldInput === undefined || payload.protocol === 'mochi-field-plan/1'), 'IDEMPOTENCY_PAYLOAD_INVALID')
      const account = accountFor(principal), ledger = book.forAccount(account)
      const policy = account === 'customer' ? UNIFIED_CUSTOMER_POLICY : UNIFIED_TEST_POLICY
      const semantic = structuredClone(payload)
      let used = false, store
      const context = body => ({ principal, key: idempotencyKey, payloadHash: hash({ semantic, request: body }) })
      const reservationStore = {
        check(body) {
          ensure(!closed && !used, closed ? 'LEDGER_UNAVAILABLE' : 'REQUEST_CONTEXT_USED')
          store = ledger.reservationStore(context(body)); store.check()
        },
        reserve(body, inputBound, outputBound, requestHash) {
          ensure(!used && store, 'REQUEST_CONTEXT_USED')
          const id = store.reserve(body, inputBound, outputBound, requestHash)
          used = true
          return id
        },
      }
      return Object.freeze({ apiKey: env.DEEPSEEK_API_KEY.trim(), model: UNIFIED_PRICING.model,
        fetchImpl: createPaidTransport({ apiKey: env.DEEPSEEK_API_KEY.trim(), ledger, pricing: UNIFIED_PRICING,
          policy, fetchImpl, reservationStore, beforeReserve: verifyPricing, concurrencyGate: gate }) })
    },
    forMochi({ principal, idempotencyKey, input } = {}) {
      return this.forRequest({ principal, idempotencyKey, payload: { idea: JSON.stringify(input), protocol: 'mochi-advice/1' } })
    },
    forFieldPlan({ principal, idempotencyKey, input } = {}) {
      return this.forRequest({ principal, idempotencyKey, payload: { idea: input.prompt, protocol: 'mochi-field-plan/1', fieldInput: input } })
    },
    mochiBudgetStatus(principal) { return budgetStatus(accountFor(principal)) },
    close() { if (closed) return; ensure(!gate.active, 'RUNTIME_BUSY'); closed = true; book.close() },
  })
}
