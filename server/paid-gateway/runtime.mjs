import { openLedger } from './ledger.mjs'
import { createPaidTransport } from './provider.mjs'
import { PRICING, ensure } from './pricing.mjs'
import { isAbsolute } from 'node:path'

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
