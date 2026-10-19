import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'
import { buildGenerationMessages } from '../../server/aiGenerationPrompt.mjs'
import { cases } from './fixtures.mjs'

test('existing route accepts variable offline AppSpecs unchanged, keeps response shape, and recovers after failure', async t => {
  let candidate
  let upstreamCalls = 0
  const server = createAppServer({ requestsPerMinute: 20, generationAccess: () => true, apiKey: 'offline-test-key', fetchImpl: async (url, options) => {
    upstreamCalls++
    // This fake fetch NEVER makes an upstream request.
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    const request = JSON.parse(options.body)
    assert.deepEqual(request.response_format, { type: 'json_object' })
    assert.equal(request.stream, false)
    assert.equal(request.max_tokens, 8192)
    assert.equal(request.messages[1].content, candidate.idea)
    assert.deepEqual(request.messages, buildGenerationMessages(candidate.idea))
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
  const empty = await post()
  assert.equal(empty.status, 502)
  assert.deepEqual(await empty.json(), { error: { code: 'AI_INCOMPLETE_APP', message: 'AI 生成的应用不完整，缺少可操作的实体、字段或录入入口，请重试。' } })
  candidate = { idea: '非法结果', spec: { version: 999 } }
  const failed = await post()
  assert.equal(failed.status, 502)
  assert.deepEqual(await failed.json(), { error: { code: 'AI_INVALID_SPEC', message: 'AI 结果不符合 AppSpec 协议，请重试。' } })
  candidate = cases.find(c => c.id === 'movie-log')
  assert.deepEqual(await (await post()).json(), candidate.spec)
  assert.equal(upstreamCalls, 11)
})

for (const [name, mutate] of [
  ['metric-only app without input', spec => { spec.blocks = [{ id: spec.blocks[0].id, name: '条数', type: 'metric', aggregation: 'count' }] }],
  ['unbound empty entity', spec => { spec.entities.push({ id: 'orphan', name: '空对象', fields: [] }) }],
  ['hidden optional field', spec => { spec.entities[0].fields.push({ id: 'hidden', name: '无法录入', type: 'text', required: false }) }],
]) test(`route rejects structurally legal but incomplete ${name}, then recovers`, async t => {
  const spec = structuredClone(cases.at(-1).spec)
  mutate(spec)
  let candidate = spec
  let calls = 0
  const server = createAppServer({ generationAccess: () => true, apiKey: 'offline-test-key', fetchImpl: async () => {
    calls++
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidate) } }] })
  } })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/api/ai/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '任意新需求' }),
  })
  const response = await post()
  assert.equal(response.status, 502)
  const error = await response.json()
  assert.deepEqual(Object.keys(error), ['error'])
  assert.equal(error.error.code, 'AI_INCOMPLETE_APP')
  assert.equal(typeof error.error.message, 'string')
  assert.ok(!JSON.stringify(error).includes('offline-test-key'))
  candidate = cases.at(-1).spec
  const recovered = await post()
  assert.equal(recovered.status, 200)
  assert.deepEqual(await recovered.json(), candidate)
  assert.equal(calls, 2, 'one upstream attempt per request, no repair/review call')
})
