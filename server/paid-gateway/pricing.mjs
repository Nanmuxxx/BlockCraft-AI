// Verified 2026-10-20 against the official CNY page. Always use PEAK, CACHE MISS.
// This short-lived snapshot is not automatically extended.
export const PRICING = Object.freeze({
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  verifiedDate: '2026-10-20', expiresAt: Date.parse('2026-10-21T00:00:00+08:00'),
  model: 'deepseek-flash', inputCnyPerMillion: 2, outputCnyPerMillion: 8,
  inputNanoPerToken: 2000, outputNanoPerToken: 8000,
})
export const POLICY = Object.freeze({
  id: 'OWNER-APPROVED-20-CNY-TEST-20261020',
  approval: 'OWNER-APPROVED-20-CNY-TEST-20261020',
  stopNano: 20_000_000_000, absoluteNano: 20_000_000_000,
  conservativeNano: 500_000_000, maxCalls: 3, maxOutputTokens: 2048,
  maxInputBytes: 65536, framingTokens: 8192, timeoutMs: 30000,
  maxResponseBytes: 262144, retries: 0, concurrency: 1,
})
// Isolated local smoke allowance. Its separate version/approval prevents a
// smoke ledger from being confused with the older production ledger.
export const SMOKE_POLICY = Object.freeze({
  id: 'OWNER-APPROVED-LOCAL-SMOKE-20261020', approval: 'OWNER-APPROVED-20-CNY-TEST-20261020',
  stopNano: 20_000_000_000, absoluteNano: 20_000_000_000,
  conservativeNano: 500_000_000, maxCalls: 3, maxOutputTokens: 2048,
  maxInputBytes: 65536, framingTokens: 8192, timeoutMs: 30000,
  maxResponseBytes: 262144, retries: 0, concurrency: 1,
})
export class GatewayError extends Error {
  constructor(code) { super(code); this.code = code }
}
export const ensure = (value, code) => { if (!value) throw new GatewayError(code) }
export const price = (prompt, completion) => prompt * PRICING.inputNanoPerToken + completion * PRICING.outputNanoPerToken
