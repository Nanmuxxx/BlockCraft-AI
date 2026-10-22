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
  // eight attempts, including one acceptance rerun on the SAME ledger.
  // An uncertain request halts all automatic calls immediately.
  conservativeNano: 1_000_000_000, maxCalls: 8, maxOutputTokens: 8192,
  maxInputBytes: 65536, framingTokens: 8192, timeoutMs: 30000,
  maxResponseBytes: 262144, retries: 0, concurrency: 1,
})
export class GatewayError extends Error {
  constructor(code) { super(code); this.code = code }
}
export const ensure = (value, code) => { if (!value) throw new GatewayError(code) }
export const price = (prompt, completion) => prompt * PRICING.inputNanoPerToken + completion * PRICING.outputNanoPerToken

// Isolated historical deployment profiles; defaults above remain unchanged.
export const STUDIO_PRICING = Object.freeze({
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  verifiedDate: '2026-10-22', expiresAt: Date.parse('2026-10-23T00:00:00+08:00'),
  model: 'deepseek-flash', inputCnyPerMillion: 2, outputCnyPerMillion: 8,
  inputNanoPerToken: 2000, outputNanoPerToken: 8000,
})
export const STUDIO_MVP_POLICY = Object.freeze({
  ...POLICY, id: 'OWNER-APPROVED-STUDIO-MVP-15-CNY-20261022',
  approval: 'OWNER-APPROVED-STUDIO-MVP-15-CNY-20261022',
  stopNano: 15_000_000_000, absoluteNano: 15_000_000_000,
  conservativeNano: 15_000_000_000, maxCalls: 500, maxOutputTokens: 8192,
})
export const LEGACY_STUDIO_MVP_POLICY = Object.freeze({
  id: 'OWNER-APPROVED-STUDIO-MVP-5-CNY-20261022',
  approval: 'OWNER-APPROVED-STUDIO-MVP-5-CNY-20261022',
  maxCalls: 8, conservativeNano: 5_000_000_000,
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

export const STUDIO_AUTHORIZATION = Object.freeze({
  id: 'OWNER-APPROVED-CUMULATIVE-5-CNY-20261023',
  maxCalls: 100, maxNano: 5_000_000_000, expiresAt: Number.MAX_SAFE_INTEGER,
  knownHistoricalCalls: 8, knownHistoricalNano: 280_314_000,
})
