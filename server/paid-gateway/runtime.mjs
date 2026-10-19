import { openLedger } from './ledger.mjs'
import { createPaidTransport } from './provider.mjs'
import { PRICING, ensure } from './pricing.mjs'
import { dirname, isAbsolute } from 'node:path'
import { openIdempotencySidecar } from './idempotency-sidecar.mjs'

/** Build an explicitly enabled, single-instance paid generation composition.
 * The caller owns identity verification and must close this runtime on shutdown.
 */
export function createPaidGenerationRuntime({
  env = process.env,
  resolveIdentity,
  fetchImpl,
  timeoutMs,
} = {}) {
  ensure(typeof resolveIdentity === 'function', 'IDENTITY_ADAPTER_REQUIRED')
  const apiKey = env.DEEPSEEK_API_KEY?.trim()
  const ledgerPath = env.DEEPSEEK_BUDGET_LEDGER_PATH?.trim()
  ensure(typeof apiKey === 'string' && apiKey.length >= 16 && apiKey.length <= 512 && !/\s/.test(apiKey), 'API_CONFIGURATION')
  ensure(typeof ledgerPath === 'string' && isAbsolute(ledgerPath), 'LEDGER_PATH_REQUIRED')

  const ledger = openLedger(ledgerPath)
  try {
    const transport = createPaidTransport({ apiKey, ledger, fetchImpl, timeoutMs })
    return Object.freeze({
      appServerOptions: Object.freeze({
        apiKey,
        fetchImpl: transport,
        model: PRICING.model,
        generationAccess: resolveIdentity,
      }),
      close: () => ledger.close(),
    })
  } catch (error) {
    ledger.close()
    throw error
  }
}

export function paidGatewayHttpStatus(error) {
  if (error?.code === 'PRINCIPAL_INVALID') return 401
  if (['IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_PAYLOAD_INVALID'].includes(error?.code)) return 400
  if (['IDEMPOTENCY_REPLAY', 'IDEMPOTENCY_CONFLICT', 'REQUEST_CONTEXT_USED'].includes(error?.code)) return 409
  if (error?.code === 'UPSTREAM_CANCELLED') return 504
  return 503
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]))
  return value
}

function semanticPayload(payload) {
  ensure(payload && typeof payload === 'object' && !Array.isArray(payload)
    && Object.keys(payload).every(k => ['idea', 'protocol'].includes(k))
    && typeof payload.idea === 'string' && payload.idea.trim().length > 0
    && Buffer.byteLength(payload.idea) <= 65536
    && (payload.protocol === undefined || ['v1', 'trusted-interactive/1'].includes(payload.protocol)), 'IDEMPOTENCY_PAYLOAD_INVALID')
  return Object.freeze({ idea: payload.idea, protocol: payload.protocol ?? 'v1' })
}

/** Explicit opt-in. HTTP owner authenticates first and drains before close.
 * Each returned transport holds its own immutable principal/request binding. */
export function createPrincipalPaidGenerationRuntime({ env = process.env, bindingKey, fetchImpl, timeoutMs } = {}) {
  const apiKey = env.DEEPSEEK_API_KEY?.trim()
  const ledgerPath = env.DEEPSEEK_BUDGET_LEDGER_PATH?.trim()
  ensure(typeof apiKey === 'string' && apiKey.length >= 16 && apiKey.length <= 512 && !/\s/.test(apiKey), 'API_CONFIGURATION')
  ensure(typeof ledgerPath === 'string' && isAbsolute(ledgerPath), 'LEDGER_PATH_REQUIRED')
  ensure(Buffer.isBuffer(bindingKey) && bindingKey.length >= 32, 'IDEMPOTENCY_KEY_REQUIRED')
  const ledger = openLedger(ledgerPath)
  let sidecar
  const gate = { active: false }
  let closed = false
  try {
    sidecar = openIdempotencySidecar({ ledger, directory: dirname(ledgerPath), bindingKey })
    createPaidTransport({ apiKey, ledger, fetchImpl, timeoutMs })
  } catch (error) {
    sidecar?.close()
    ledger.close()
    throw error
  }
  return Object.freeze({
    forRequest({ principal, idempotencyKey, payload } = {}) {
      ensure(!closed, 'LEDGER_UNAVAILABLE')
      ensure(typeof principal === 'string' && Buffer.byteLength(principal) > 0 && Buffer.byteLength(principal) <= 256, 'PRINCIPAL_INVALID')
      ensure(typeof idempotencyKey === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(idempotencyKey), 'IDEMPOTENCY_KEY_INVALID')
      const semantic = semanticPayload(payload)
      let used = false
      const context = body => ({ principal, idempotencyKey, payload: Buffer.from(JSON.stringify(canonical({ semantic, request: body }))) })
      const reservationStore = {
        check(body) {
          ensure(!closed, 'LEDGER_UNAVAILABLE')
          ensure(!used, 'REQUEST_CONTEXT_USED')
          sidecar.check(context(body))
        },
        reserve(body, inputBound, outputBound, requestHash) {
          const id = sidecar.reserve({ ...context(body), inputBound, outputBound, requestHash })
          used = true
          return id
        },
      }
      return Object.freeze({ apiKey, model: PRICING.model, fetchImpl: createPaidTransport({ apiKey, ledger, fetchImpl, timeoutMs, reservationStore, concurrencyGate: gate }) })
    },
    close() {
      if (closed) return
      ensure(!gate.active, 'RUNTIME_BUSY')
      closed = true
      sidecar.close()
      ledger.close()
    },
  })
}
