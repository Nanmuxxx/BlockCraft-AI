const test = require('node:test')
const assert = require('node:assert/strict')
const { createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { generateProject, generateInteractiveProject } = require('../../src/components/ai-create/generateApp.ts')
const timerSpec = require('../trusted-interactive/pomodoro.json')
const spec = () => createClubRegistrationExample().spec
const interactive = () => ({ protocol: 'trusted-interactive/1', spec: timerSpec, provenance: { source: 'offline-fixture', model: 'fixed-json' } })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }

for (const [name, generate, result] of [['v1', generateProject, spec], ['v2', generateInteractiveProject, interactive]]) {
  test(`${name}: deadline terminates uncooperative fetch without retry`, async t => {
    const original = global.fetch; t.after(() => { global.fetch = original })
    t.mock.timers.enable({ apis: ['setTimeout'] })
    let calls = 0
    global.fetch = () => { calls++; return new Promise(() => {}) }
    const pending = generate('离线需求')
    const rejected = assert.rejects(pending, /取消或超时/)
    t.mock.timers.tick(45000)
    await rejected
    assert.equal(calls, 1)
  })

  test(`${name}: abort before fetch, while fetch ignores abort, and while body ignores abort`, async t => {
    const original = global.fetch; t.after(() => { global.fetch = original })
    let calls = 0
    global.fetch = async () => { calls++; return Response.json(result()) }
    const before = new AbortController(); before.abort()
    await assert.rejects(generate('离线需求', before.signal), /取消或超时/)
    assert.equal(calls, 0)
    const slow = deferred(), controller = new AbortController()
    global.fetch = () => slow.promise
    const pending = generate('离线需求', controller.signal)
    controller.abort()
    await assert.rejects(pending, /取消或超时/)
    slow.resolve(Response.json(result())) // obsolete transport cannot return a project
    const body = deferred(), reading = new AbortController()
    global.fetch = async () => new Response(new ReadableStream({ pull: () => body.promise }))
    const parsing = generate('离线需求', reading.signal)
    await new Promise(resolve => setImmediate(resolve))
    reading.abort()
    await assert.rejects(parsing, /取消或超时/)
    body.resolve()
    global.fetch = async () => Response.json(result())
    assert.ok(await generate('恢复请求'))
  })

  test(`${name}: byte bounds apply to declared and chunked bodies; malformed data never installs`, async t => {
    const original = global.fetch; t.after(() => { global.fetch = original })
    for (const response of [
      new Response('{}', { headers: { 'content-length': String(128 * 1024 + 1) } }),
      new Response(' '.repeat(128 * 1024 + 1)),
      new Response(new Uint8Array([0xff, 0xfe])),
      new Response('<html>bad gateway</html>'),
      Response.json({ error: { code: 'AI_NOT_CONFIGURED' } }),
    ]) {
      global.fetch = async () => response
      await assert.rejects(generate('离线需求'))
    }
    global.fetch = async () => Response.json(result())
    assert.ok(await generate('恢复请求'))
  })
}

test('v1 cannot accept raw v2 or trusted envelope; v2 cannot accept v1 or oversized provenance', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original })
  for (const output of [timerSpec, interactive()]) {
    global.fetch = async () => Response.json(output)
    await assert.rejects(generateProject('v1'), /AppSpec 校验/)
  }
  for (const output of [spec(), { ...interactive(), provenance: { source: 'offline-fixture', model: 'x'.repeat(201) } }]) {
    global.fetch = async () => Response.json(output)
    await assert.rejects(generateInteractiveProject('v2'))
  }
  global.fetch = async () => Response.json({ error: { code: 'SECRET_RAW_UPSTREAM' } }, { status: 502 })
  await assert.rejects(generateInteractiveProject('v2'), error => !error.message.includes('SECRET_RAW_UPSTREAM'))
})
