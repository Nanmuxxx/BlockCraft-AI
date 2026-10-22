import test from 'node:test'
import assert from 'node:assert/strict'
import { createLivePricingVerifier } from '../../server/paid-gateway/live-pricing.mjs'

const html = '<table><tr><td>模型</td><td>deepseek-flash</td><td>deepseek-v4-pro</td></tr><tr><td>高峰时段</td><td>x</td></tr><tr><td>百万tokens输入缓存未命中</td></tr><tr><td>高峰时段</td><td>2元</td><td>x</td></tr><tr><td>百万tokens输出</td></tr><tr><td>高峰时段</td><td>8元</td><td>x</td></tr></table>'
const response = (body = html) => new Response(body, { headers: { 'Content-Type': 'text/html' } })

test('concurrent cold and expired verification share one official fetch; freshness is never extended by cache hits', async () => {
  let now = 1000, requests = 0, release
  const verify = createLivePricingVerifier({ now: () => now, fetchImpl: async () => {
    requests++; await new Promise(resolve => { release = resolve }); return response()
  } })
  for (let round = 0; round < 2; round++) {
    assert.throws(() => verify.assertCurrent(), { code: 'PRICING_UNVERIFIED' })
    const first = verify(), rest = Array.from({ length: 12 }, () => verify())
    for (const pending of rest) assert.equal(pending, first)
    assert.equal(requests, round + 1)
    release(); await Promise.all([first, ...rest]); verify.assertCurrent()
    now += 899_999; await verify(); assert.equal(requests, round + 1)
    now++; assert.throws(() => verify.assertCurrent(), { code: 'PRICING_UNVERIFIED' })
  }
})

test('failed refresh rejects all waiters, keeps the quote expired, and allows verified retry', async () => {
  let now = 1000, invalid = false, requests = 0
  const verify = createLivePricingVerifier({ now: () => now, fetchImpl: async () => {
    requests++; return response(invalid ? html.replace('2元', '3元') : html)
  } })
  await verify(); now += 900_000; invalid = true
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => verify()))
  assert.equal(requests, 2)
  for (const result of results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'PRICING_CHANGED') }
  assert.throws(() => verify.assertCurrent(), { code: 'PRICING_UNVERIFIED' })
  invalid = false; await verify(); verify.assertCurrent(); assert.equal(requests, 3)
  now--; assert.throws(() => verify.assertCurrent(), { code: 'PRICING_UNVERIFIED' })
})

test('timeout bounds a non-cooperative fetch and its late response cannot revive quote freshness', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release, signal
  const verify = createLivePricingVerifier({ fetchImpl: async (_, init) => {
    signal = init.signal; return new Promise(resolve => { release = resolve })
  } })
  const pending = verify(), rejected = assert.rejects(pending, { code: 'PRICING_UNVERIFIED' })
  t.mock.timers.tick(8000); await rejected; assert.equal(signal.aborted, true)
  release(response()); await new Promise(resolve => setImmediate(resolve))
  assert.throws(() => verify.assertCurrent(), { code: 'PRICING_UNVERIFIED' })
})

test('timeout also bounds a stalled body read without marking the quote verified', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let stream
  const verify = createLivePricingVerifier({ fetchImpl: async () => response(new ReadableStream({ start(controller) { stream = controller } })) })
  const pending = verify(), rejected = assert.rejects(pending, { code: 'PRICING_UNVERIFIED' })
  await Promise.resolve(); t.mock.timers.tick(8000); await rejected
  stream.enqueue(new TextEncoder().encode(html)); stream.close()
  await new Promise(resolve => setImmediate(resolve))
  assert.throws(() => verify.assertCurrent(), { code: 'PRICING_UNVERIFIED' })
})

test('timed out cleanup cannot mark a late quote current while a retry verifies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release, requests = 0
  const verify = createLivePricingVerifier({ fetchImpl: async () => {
    requests++
    if (requests > 1) return response()
    const chunks = [new TextEncoder().encode(html)]
    return { ok: true, headers: new Headers({ 'Content-Type': 'text/html' }), body: { getReader() { return {
      async read() { return chunks.length ? { value: chunks.shift(), done: false } : { done: true } },
      cancel() { return new Promise(resolve => { release = resolve }) }, releaseLock() {},
    } } } }
  } })
  const pending = verify(), rejected = assert.rejects(pending, { code: 'PRICING_UNVERIFIED' })
  for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
  assert.equal(typeof release, 'function')
  t.mock.timers.tick(8000); await rejected
  assert.throws(() => verify.assertCurrent(), { code: 'PRICING_UNVERIFIED' })
  await verify(); verify.assertCurrent(); assert.equal(requests, 2)
  release(); await new Promise(resolve => setImmediate(resolve)); verify.assertCurrent()
})
