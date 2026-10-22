import { STUDIO_PRICING as PRICING, GatewayError, ensure } from './pricing.mjs'

// Fixed public HTTPS destination. Never sends model credentials or user input.
// Any changed/ambiguous table or unavailable verification fails closed.
export function assertPublishedPricing(html) {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[1])
  const table = tables.find(t => /deepseek-flash/.test(t))
  ensure(table, 'PRICING_UNVERIFIED')
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m =>
    [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => c[1].replace(/<[^>]*>/g, '').replace(/\s+/g, '')))
  ensure(rows[0]?.length === 3 && rows[0][0] === '模型' && /^deepseek-flash(?:\(1\))?$/.test(rows[0][1]) && rows[0][2] === 'deepseek-v4-pro', 'PRICING_UNVERIFIED')
  const peaks = rows.filter(r => r[0] === '高峰时段')
  const inputs = rows.filter(r => r.some(c => c.includes('百万tokens输入') && c.includes('缓存未命中')))
  const outputs = rows.filter(r => r.some(c => c === '百万tokens输出'))
  ensure(inputs.length === 1 && outputs.length === 1 && peaks.length === 3 &&
    rows[rows.indexOf(inputs[0]) + 1] === peaks[1] && rows[rows.indexOf(outputs[0]) + 1] === peaks[2] &&
    peaks[1].length === 3 && peaks[1][1] === `${PRICING.inputCnyPerMillion}元` &&
    peaks[2].length === 3 && peaks[2][1] === `${PRICING.outputCnyPerMillion}元`, 'PRICING_CHANGED')
  return true
}

export function createLivePricingVerifier({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let verifiedAt = null, inFlight = null
  const current = () => verifiedAt !== null && now() >= verifiedAt && now() - verifiedAt < 15 * 60_000
  const refresh = async signal => {
    const response = await fetchImpl(PRICING.source, { redirect: 'error', signal,
      headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' } })
    ensure(response.ok && /text\/html/i.test(response.headers.get('content-type') || '') && response.body, 'PRICING_UNVERIFIED')
    const reader = response.body.getReader(), chunks = []
    let size = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        ensure(size <= 256 * 1024, 'PRICING_UNVERIFIED')
        chunks.push(Buffer.from(value))
      }
      assertPublishedPricing(Buffer.concat(chunks).toString('utf8'))
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    // A late or non-cooperative response cannot refresh an expired quote.
    ensure(!signal.aborted, 'PRICING_UNVERIFIED')
    verifiedAt = now()
  }
  const verify = () => {
    if (current()) return Promise.resolve()
    if (inFlight) return inFlight
    const controller = new AbortController()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new GatewayError('PRICING_UNVERIFIED'))
      }, 8000)
    })
    inFlight = Promise.race([refresh(controller.signal), timeout]).finally(() => { clearTimeout(timer); inFlight = null })
    return inFlight
  }
  verify.assertCurrent = () => {
    ensure(current(), 'PRICING_UNVERIFIED')
  }
  return verify
}
