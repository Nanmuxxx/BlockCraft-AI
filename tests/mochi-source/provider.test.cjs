const test = require('node:test')
const assert = require('node:assert/strict')
const { copy, artifact } = require('../custom-block/fixtures.cjs')
const { createModelSourcePlanProvider, SOURCE_EDIT_INSTRUCTION } = require('../../src/integrations/mochi-source/providers.ts')
const request = () => ({ contractVersion: 1, requestId: 'source-fixture', projectId: 'test-project', baseRevision: 1, intent: '修改选中的源文件', target: { id: 'target', definitionId: 'test-countdown', versionDigest: 'sha256:' + '0'.repeat(64), props: { durationSeconds: 600 } }, current: { versionDigest: 'sha256:' + '0'.repeat(64), artifact: artifact() } })

test('pre-cancelled source completion never reaches the separately supplied transport', async () => {
  let calls = 0; const controller = new AbortController(), reason = Error('cancelled before egress')
  controller.abort(reason)
  const provider = createModelSourcePlanProvider(async () => { calls++; return '{}' })
  await assert.rejects(provider.generate(request(), controller.signal), error => error === reason)
  assert.equal(calls, 0)
})

test('outbound source context bounds actual UTF-8 JSON including instruction and escaped source', async () => {
  let calls = 0
  const provider = createModelSourcePlanProvider(async () => { calls++; return '{}' })
  for (const text of ['汉'.repeat(180000), '\\'.repeat(270000)]) {
    const input = request(); input.current.artifact.sources['src/Counter.tsx'] = text
    assert.ok(new TextEncoder().encode(JSON.stringify({ instruction: SOURCE_EDIT_INSTRUCTION, request: input })).length > 524288)
    await assert.rejects(provider.generate(input, new AbortController().signal), { code: 'MODEL_REQUEST_TOO_LARGE' })
  }
  assert.equal(calls, 0)
  assert.deepEqual(await provider.generate(request(), new AbortController().signal), {})
  assert.equal(calls, 1)
})

test('cancel during completion rejects its late output before decoding it', async () => {
  const controller = new AbortController(), reason = Error('late output cancelled')
  const provider = createModelSourcePlanProvider(async () => { controller.abort(reason); return 'invalid JSON' })
  await assert.rejects(provider.generate(request(), controller.signal), error => error === reason)
})

test('source model seam rejects oversized or non-text completion without a fallback', async () => {
  for (const output of ['汉'.repeat(180000), copy({ advice: 'not protocol text' })]) {
    let calls = 0
    const provider = createModelSourcePlanProvider(async () => { calls++; return output })
    await assert.rejects(provider.generate(request(), new AbortController().signal), /INVALID_MODEL_RESPONSE/)
    assert.equal(calls, 1)
  }
})

test('source model completion has a bounded deadline even when transport ignores abort', async () => {
  let captured, calls = 0, rejectLate
  const provider = createModelSourcePlanProvider(async ({ signal }) => {
    calls++; captured = signal
    return new Promise((_, reject) => { rejectLate = reject })
  }, { timeoutMs: 15 })
  const controller = new AbortController()
  let guard
  try {
    await assert.rejects(Promise.race([
      provider.generate(request(), controller.signal),
      new Promise(resolve => { guard = setTimeout(resolve, 150) }),
    ]), { code: 'MODEL_TIMEOUT' })
    assert.equal(calls, 1); assert.equal(captured.aborted, true)
  } finally { clearTimeout(guard); controller.abort(); rejectLate?.(Error('late completion private detail')) }
  await new Promise(resolve => setImmediate(resolve))
})

test('source model seam itself retires caller cancellation and forwards its reason', async () => {
  let captured
  const provider = createModelSourcePlanProvider(async ({ signal }) => { captured = signal; return new Promise(() => {}) })
  const controller = new AbortController(), reason = Error('caller cancelled')
  const output = provider.generate(request(), controller.signal)
  await Promise.resolve()
  controller.abort(reason)
  let guard
  try {
    await assert.rejects(Promise.race([output, new Promise(resolve => { guard = setTimeout(resolve, 150) })]), error => error === reason)
    assert.equal(captured.aborted, true)
  } finally { clearTimeout(guard) }
})

test('source model deadline configuration fails closed', () => {
  for (const timeoutMs of [0, -1, 45001, Infinity, 0.5, '15', null]) {
    assert.throws(() => createModelSourcePlanProvider(async () => '{}', { timeoutMs }), { code: 'MODEL_CONFIGURATION' })
  }
})

test('synchronous completion abort plus throw is consumed and cannot replace cancellation', async () => {
  const controller = new AbortController(), reason = Error('cancel during synchronous transport')
  const provider = createModelSourcePlanProvider(() => {
    controller.abort(reason)
    throw Error('private synchronous transport failure')
  })
  await assert.rejects(provider.generate(request(), controller.signal), error => error === reason)
  await new Promise(resolve => setImmediate(resolve))
})

test('success releases its completion signal and caller listener without aborting caller', async () => {
  let captured
  const controller = new AbortController()
  const provider = createModelSourcePlanProvider(async ({ signal }) => { captured = signal; return '{}' }, { timeoutMs: 15 })
  assert.deepEqual(await provider.generate(request(), controller.signal), {})
  assert.equal(captured.aborted, true); assert.equal(controller.signal.aborted, false)
  controller.abort()
})
