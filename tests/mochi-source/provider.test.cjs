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
