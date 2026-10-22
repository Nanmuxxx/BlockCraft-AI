import { POLICY as base } from '../../server/paid-gateway/pricing.mjs'
// Official CNY peak/cache-miss rates verified 2026-10-22. Never auto-refresh.
export const pricing = Object.freeze({
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  verifiedDate: '2026-10-22', expiresAt: Date.parse('2026-10-23T00:00:00+08:00'),
  model: 'deepseek-flash', inputCnyPerMillion: 2, outputCnyPerMillion: 8,
  inputNanoPerToken: 2000, outputNanoPerToken: 8000,
})
export const policy = Object.freeze({ ...base, approval: 'MOCHI-PROACTIVE-V1-USER-20261022',
  maxCalls: 8, conservativeNano: 1_000_000_000 })
