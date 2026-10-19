const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setImmediate: tick } = require('node:timers/promises')
const ts = require(path.join(process.env.QA_SOURCE_ROOT, 'node_modules/typescript'))
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { generateProject } = require(path.join(process.env.QA_SOURCE_ROOT, 'src/components/ai-create/generateApp.ts'))

test('pre-cancelled generation performs zero transport calls', async t => {
  const original = global.fetch
  t.after(() => { global.fetch = original })
  let calls = 0
  global.fetch = async () => { calls++; throw Error('unexpected') }
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(generateProject('记录阅读时间', controller.signal), /取消或超时/)
  assert.equal(calls, 0)
})

test('cancellation wins over ignored abort and cancels a late response body', { timeout: 3000 }, async t => {
  const original = global.fetch
  t.after(() => { global.fetch = original })
  let resolveFetch, suppliedSignal, cancelled = 0, calls = 0
  global.fetch = (_url, options) => {
    calls++
    assert.match(options.headers['Idempotency-Key'], /^[A-Za-z0-9_-]{32,128}$/)
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.redirect, 'error')
    suppliedSignal = options.signal
    return new Promise(resolve => { resolveFetch = resolve })
  }
  const controller = new AbortController()
  const pending = generateProject('记录阅读时间', controller.signal)
  const rejected = assert.rejects(pending, /取消或超时/)
  controller.abort()
  await rejected
  assert.equal(suppliedSignal.aborted, true)
  resolveFetch(new Response(new ReadableStream({ cancel() { cancelled++ } })))
  await tick()
  assert.equal(cancelled, 1)
  assert.equal(calls, 1)
})

test('cancellation interrupts a stalled response body and releases its reader', { timeout: 3000 }, async t => {
  const original = global.fetch
  t.after(() => { global.fetch = original })
  let cancelled = 0
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, cancel() { cancelled++ } })
  global.fetch = async () => new Response(body)
  const controller = new AbortController()
  const pending = generateProject('记录阅读时间', controller.signal)
  const rejected = assert.rejects(pending, /取消或超时/)
  await tick()
  controller.abort()
  await rejected
  await tick()
  assert.equal(cancelled, 1)
  assert.equal(body.locked, false)
})
