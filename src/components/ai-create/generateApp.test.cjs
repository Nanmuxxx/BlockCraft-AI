const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { initializeGeneratedProject, generateProject } = require('./generateApp.ts')
const { readingLogSpec } = require('../../model/appSpecExamples.ts')
const { createAppRuntime, metricValue } = require('../../model/appRuntime.ts')

test('validated generated spec starts empty, isolated, with complete normalized layout and interactive runtime', () => {
  const state = initializeGeneratedProject(readingLogSpec)
  assert.equal(state.revision, 0)
  assert.ok(Object.values(state.records).every(rows => rows.length === 0))
  assert.equal(Object.keys(state.blockPositions).length, state.spec.blocks.length)
  assert.ok(Object.values(state.blockPositions).every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1))
  assert.notStrictEqual(state.spec, readingLogSpec)
  const runtime = createAppRuntime(state)
  runtime.dispatch({ type: 'create', entityId: 'reading-sessions', record: { id: 'test-record', values: { 'reading-date': '2026-10-17', minutes: 12 } } })
  assert.equal(metricValue(runtime.getSnapshot(), state.spec.blocks[3]), 12)
  assert.equal(state.records['reading-sessions'].length, 0)
})

test('Mock API uses same-origin POST and validates success; errors never become applications', async t => {
  const original = global.fetch
  t.after(() => { global.fetch = original })
  let calls = 0
  global.fetch = async (url, options) => {
    calls++
    assert.equal(url, '/api/ai/generate')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(options.body), { idea: '任意创意 <script>纯文本</script>' })
    return Response.json(readingLogSpec)
  }
  const idea = ' 任意创意 <script>纯文本</script> '
  assert.equal((await generateProject(idea)).spec.id, readingLogSpec.id)
  await assert.rejects(generateProject('  '), /1–4000/)
  await assert.rejects(generateProject('x'.repeat(4001)), /1–4000/)
  assert.equal(calls, 1)
  for (const invalid of [null, { ...readingLogSpec, code: 'alert(1)' }, { ...readingLogSpec, relations: [] }]) {
    global.fetch = async () => Response.json(invalid)
    await assert.rejects(generateProject(idea), /AppSpec 校验/)
  }
  global.fetch = async () => Response.json({ error: { code: 'AI_NOT_CONFIGURED' } }, { status: 503 })
  await assert.rejects(generateProject(idea), /尚未配置/)
  global.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 })
  await assert.rejects(generateProject(idea), /有效 JSON/)
  global.fetch = async () => { throw new TypeError('network') }
  await assert.rejects(generateProject(idea), /无法连接/)
  const controller = new AbortController()
  controller.abort()
  global.fetch = async (_url, { signal }) => { signal.throwIfAborted() }
  await assert.rejects(generateProject(idea, controller.signal), /取消或超时/)
})
