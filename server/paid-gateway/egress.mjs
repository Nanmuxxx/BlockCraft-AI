// Native production egress must use the audited gateway. Injected transports are
// trusted server code (offline tests or the controlled adapter), never HTTP data.
const nativeFetch = globalThis.fetch
export function requireControlledEgress(fetchImpl) {
  if (fetchImpl === nativeFetch || typeof fetchImpl !== 'function') {
    const error = new Error('PAID_GATEWAY_REQUIRED')
    error.code = 'PAID_GATEWAY_REQUIRED'
    throw error
  }
}
