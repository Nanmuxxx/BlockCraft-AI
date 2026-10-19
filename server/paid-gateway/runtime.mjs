import { openLedger } from './ledger.mjs'
import { createPaidTransport } from './provider.mjs'
import { SMOKE_POLICY, PRICING } from './pricing.mjs'

/** Build the owner-approved local smoke gateway without exposing the key. */
export function createPaidGenerationRuntime({ ledgerPath, fetchImpl, onResponse, timeoutMs } = {}) {
  if (typeof ledgerPath !== 'string' || ledgerPath.length === 0) throw Object.assign(new Error('LEDGER_CONFIGURATION'), { code: 'LEDGER_CONFIGURATION' })
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (typeof apiKey !== 'string' || !apiKey) throw Object.assign(new Error('API_CONFIGURATION'), { code: 'API_CONFIGURATION' })
  const ledger = openLedger(ledgerPath, { policy: SMOKE_POLICY, profile: 'local-smoke' })
  try {
    const fetch = createPaidTransport({ apiKey, ledger, fetchImpl, onResponse, timeoutMs, policy: SMOKE_POLICY })
    return Object.freeze({ fetch, ledger, policy: SMOKE_POLICY, model: PRICING.model, close: () => ledger.close() })
  } catch (error) {
    ledger.close()
    throw error
  }
}
