import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'
import { buildGenerationMessages } from '../../server/aiGenerationPrompt.mjs'
import { cases } from './fixtures.mjs'

test('existing route accepts variable offline AppSpecs unchanged, keeps response shape, and recovers after failure', async t => {
  let candidate
  let upstreamCalls = 0
  const server = createAppServer({ apiKey: 'offline-test-key', fetchImpl: async (url, options) => {
    upstreamCalls++
    // This fake fetch NEVER makes an upstream request.
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    const request = JSON.parse(options.body)
    assert.deepEqual(request.response_format, { type: 'json_object' })
    assert.equal(request.stream, false)
    assert.equal(request.max_tokens, 8192)
    assert.equal(request.messages[1].content, candidate.idea)
    // Future replacement changes only messages; same protocol and user slot.
    const future = buildGenerationMessages(candidate.idea)
    assert.equal(future[1].content, request.messages[1].content)
    assert.ok(future[0].content.includes('export interface AppSpec'))
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidate.spec) } }] })
  } })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/api/ai/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: candidate.idea }),
  })
  for (candidate of cases) {
    const response = await post()
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), candidate.spec, 'raw AppSpec, without report/spec wrapper')
  }
  candidate = { idea: '旧接口结果', spec: { version: 1, id: 'legacy', name: '旧的合法空应用', entities: [], blocks: [], relations: [] } }
  assert.deepEqual(await (await post()).json(), candidate.spec) // independent G1 policy has not altered old route.
  candidate = { idea: '非法结果', spec: { version: 999 } }
  const failed = await post()
  assert.equal(failed.status, 502)
  assert.deepEqual(await failed.json(), { error: { code: 'AI_INVALID_SPEC', message: 'AI 结果不符合 AppSpec 协议，请重试。' } })
  candidate = cases.find(c => c.id === 'movie-log')
  assert.deepEqual(await (await post()).json(), candidate.spec)
  assert.equal(upstreamCalls, 10)
})
