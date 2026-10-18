const test = require('node:test')
const assert = require('node:assert/strict')
const { api, copy, setup } = require('./fixtures.cjs')

test('all message variants validate exact payload shapes and return independent snapshots', async () => {
  const { message } = await setup()
  const cases = [
    ['ready', { sdkVersion: '1.0.0' }],
    ['state.compareAndSet', { baseRevision: 7, stateRevision: 2, value: { remainingSeconds: 500, status: 'running' } }],
    ['event.emit', { eventId: 'completed', value: { durationSeconds: 600 } }],
    ['command.request', { command: 'records.create', baseRevision: 7, entityId: 'books', record: { id: 'record-1', values: { title: '书', score: 3, done: false } } }],
    ['result', { ok: true, committedRevision: 8 }], ['result', { ok: false, code: 'DENIED' }],
    ['error', { code: 'RENDER_ERROR', message: '组件错误' }],
  ]
  for (const [type, payload] of cases) {
    const input = { ...message, type, payload }
    const output = api.parseSandboxMessage(input)
    assert.deepEqual(output, input); assert.notStrictEqual(output.payload, payload)
    assert.throws(() => api.parseSandboxMessage({ ...input, payload: { ...payload, extra: true } }))
  }
})
const invalidMessages = {
  'wrong protocol': m => { m.protocol = 'custom-block/2' },
  'unknown type': m => { m.type = 'executeJavaScript' },
  'extra envelope field': m => { m.origin = 'https://trusted' },
  'missing requestId': m => { delete m.requestId },
  'empty requestId': m => { m.requestId = '' },
  'overlong requestId': m => { m.requestId = 'a'.repeat(129) },
  'invalid channel': m => { m.channelId = 'bad channel' },
  'invalid session': m => { m.sessionId = null },
  'invalid instance': m => { m.instanceId = 'constructor' },
  'missing version': m => { delete m.versionDigest },
  'floating version': m => { m.versionDigest = 'latest' },
  'uppercase digest': m => { m.versionDigest = `sha256:${'F'.repeat(64)}` },
  'zero seq': m => { m.seq = 0 },
  'negative seq': m => { m.seq = -1 },
  'fractional seq': m => { m.seq = 1.5 },
  'unsafe seq': m => { m.seq = Number.MAX_SAFE_INTEGER + 1 },
  'array payload': m => { m.payload = [] },
  'null payload': m => { m.payload = null },
  'unknown SDK': m => { m.payload.sdkVersion = 'latest' },
  'functions': m => { m.payload.sdkVersion = () => '1.0.0' },
  'undefined': m => { m.payload.sdkVersion = undefined },
  'bigint': m => { m.seq = 1n },
  'symbol': m => { m[Symbol('secret')] = true },
  'nonfinite': m => { m.seq = Infinity },
  'cycle': m => { m.payload.self = m },
  'class instance': m => { m.payload = new Date() },
}
for (const [name, mutate] of Object.entries(invalidMessages)) test(`message rejects ${name}`, async () => {
  const { message } = await setup(); mutate(message); assert.throws(() => api.parseSandboxMessage(message))
})
test('command/state/result payloads reject hidden commands and illegal data types', async () => {
  const { message } = await setup()
  const invalid = [
    ['command.request', { command: 'undo', baseRevision: 0, entityId: 'books', record: { id: 'row', values: {} } }],
    ['command.request', { command: 'records.create', baseRevision: 0, entityId: 'books', record: { id: 'row', values: { field: {} } } }],
    ['command.request', { command: 'records.create', baseRevision: -1, entityId: 'books', record: { id: 'row', values: {} } }],
    ['command.request', { command: 'records.create', baseRevision: 0, entityId: 'books', record: { id: 'row', values: {}, extra: true } }],
    ['state.compareAndSet', { baseRevision: 0, stateRevision: -1, value: {} }],
    ['state.compareAndSet', { baseRevision: 0, stateRevision: 0, value: 'not object' }],
    ['event.emit', { eventId: 'missing-id?', value: {} }],
    ['result', { ok: 'true', committedRevision: 1 }],
    ['result', { ok: false, committedRevision: 1, code: 'NO' }],
    ['error', { code: 'ERROR', message: 'x'.repeat(1025) }],
  ]
  for (const [type, payload] of invalid) assert.throws(() => api.parseSandboxMessage({ ...message, type, payload }))
})
test('semantic pass validates declared events and state, while neither pass authenticates messages', async () => {
  const { message, source } = await setup()
  const state = { ...message, type: 'state.compareAndSet', payload: { baseRevision: 0, stateRevision: 0, value: { remainingSeconds: 100, status: 'paused' } } }
  const event = { ...message, type: 'event.emit', payload: { eventId: 'completed', value: { durationSeconds: 600 } } }
  for (const input of [state, event]) api.validateMessageData(input, source.manifest)
  const wrong = copy(state); wrong.payload.value.remainingSeconds = '100'
  api.parseSandboxMessage(wrong)
  assert.throws(() => api.validateMessageData(wrong, source.manifest))
  event.payload.eventId = 'undeclared'; assert.throws(() => api.validateMessageData(event, source.manifest))
  // Intentional: structural parser has no browser/session authority or replay database.
  const replay = api.parseSandboxMessage(message)
  assert.deepEqual(api.parseSandboxMessage(message), replay)
  const unbound = api.parseSandboxMessage({ ...message, instanceId: 'someone-else', sessionId: 'new-session' })
  assert.equal(unbound.instanceId, 'someone-else')
})
test('message limits cover lengths, aggregate count, JSON depth, UTF-8 bytes and accessor rejection', async () => {
  const { message } = await setup()
  const state = value => ({ ...message, type: 'state.compareAndSet', payload: { baseRevision: 0, stateRevision: 0, value } })
  const parsed = api.parseSandboxMessage({ ...message, requestId: 'a'.repeat(128), seq: Number.MAX_SAFE_INTEGER })
  assert.equal(parsed.seq, Number.MAX_SAFE_INTEGER)
  api.parseSandboxMessage(state({ text: 'x'.repeat(4096), array: Array(128).fill(0) }))
  assert.throws(() => api.parseSandboxMessage(state({ text: 'x'.repeat(4097) })), { code: 'LIMIT' })
  assert.throws(() => api.parseSandboxMessage(state({ array: Array(129).fill(0) })), { code: 'LIMIT' })
  const broad = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i}`, 0]))
  api.parseSandboxMessage(state(broad)); broad.overflow = 0
  assert.throws(() => api.parseSandboxMessage(state(broad)), { code: 'LIMIT' })
  // value is at depth 2; leaf after ten object links is exactly depth 12.
  let deep = 0
  for (let i = 0; i < 10; i++) deep = { child: deep }
  api.parseSandboxMessage(state(deep))
  assert.throws(() => api.parseSandboxMessage(state({ child: deep })), { code: 'LIMIT' })
  const tooMany = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, Array(128).fill(0)]))
  assert.throws(() => api.parseSandboxMessage(state(tooMany)), { code: 'LIMIT' })
  assert.throws(() => api.parseSandboxMessage(state({ a: 'x'.repeat(4096), b: 'x'.repeat(4096), c: 'x'.repeat(4096), d: 'x'.repeat(4096) })), { code: 'LIMIT' })
  assert.throws(() => api.parseSandboxMessage(state({ a: '中'.repeat(4000), b: '中'.repeat(4000), c: '中'.repeat(4000) })), { code: 'LIMIT' })
  let calls = 0
  Object.defineProperty(message, 'payload', { enumerable: true, get() { calls++; throw Error('must not read') } })
  assert.throws(() => api.parseSandboxMessage(message)); assert.equal(calls, 0)
})
