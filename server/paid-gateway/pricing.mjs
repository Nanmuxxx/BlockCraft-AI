// Verified 2026-10-21 against the official CNY page. Always use PEAK, CACHE MISS.
// Reverify before a later run; no automatic conversion from USD or cheap cache.
export const PRICING = Object.freeze({
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  verifiedDate: '2026-10-21', expiresAt: Date.parse('2026-10-22T00:00:00+08:00'),
  model: 'deepseek-flash', inputCnyPerMillion: 2, outputCnyPerMillion: 8,
  inputNanoPerToken: 2000, outputNanoPerToken: 8000,
})
export const POLICY = Object.freeze({
  approval: 'MVP-FIELDS-USER-5-CNY-20261021',
  stopNano: 5_000_000_000, absoluteNano: 5_000_000_000,
  // Deliberately stricter than the authorized CNY 5 stop: at most CNY 1 reserved and
  // six attempts. An uncertain request halts all automatic calls immediately.
  conservativeNano: 1_000_000_000, maxCalls: 6, maxOutputTokens: 8192,
  maxInputBytes: 65536, framingTokens: 8192, timeoutMs: 30000,
  maxResponseBytes: 262144, retries: 0, concurrency: 1,
})
export class GatewayError extends Error {
  constructor(code) { super(code); this.code = code }
}
export const ensure = (value, code) => { if (!value) throw new GatewayError(code) }
export const price = (prompt, completion) => prompt * PRICING.inputNanoPerToken + completion * PRICING.outputNanoPerToken
