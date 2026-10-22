'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename)
}
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { mockAddOptionalField } = require('../../src/integrations/mochi/mockPlanner.ts')
const { createAppRuntime } = require('../../src/model/appRuntime.ts')
const { createClubRegistrationExample } = require('../../src/model/appSpecExamples.ts')
const { AppSpecError } = require('../../src/model/appSpecValidation.ts')

function setup(t, provider = mockAddOptionalField) {
  const runtime = createAppRuntime(createClubRegistrationExample())
  let writes = 0, calls = 0
  const execute = runtime.executeCommand
  runtime.executeCommand = (...args) => { writes++; return execute(...args) }
  const host = createMochiHost(runtime, input => { calls++; return provider(input) })
  host.setSelection('registration-form')
  t.after(() => host.dispose())
  return { runtime, host, writes: () => writes, calls: () => calls }
}
function guardFixture() {
  let time = 0, consent = true
  const guard = Object.freeze({ expiresAt: 600_000, validate() {
    if (time >= this.expiresAt) throw new AppSpecError('SUGGESTION_EXPIRED', '建议已过期。')
    if (!consent) throw new AppSpecError('PROACTIVE_DISABLED', '主动建议授权已撤销。')
  } })
  return { guard, expire() { time = 600_000 }, revoke() { consent = false } }
}
const request = (host, guard) => host.callbacks.onRequestPlan('新增一个可选备注字段', undefined, guard)
const rejection = (operation, code) => assert.rejects(operation, error => error.code === code)

for (const reason of ['TTL', 'consent']) test(`guard rejects ${reason} at entry without calling the provider`, async t => {
  const s = setup(t), g = guardFixture(), before = s.runtime.getSnapshot()
  if (reason === 'TTL') g.expire(); else g.revoke()
  await rejection(request(s.host, g.guard), reason === 'TTL' ? 'SUGGESTION_EXPIRED' : 'PROACTIVE_DISABLED')
  assert.equal(s.calls(), 0); assert.equal(s.writes(), 0)
  assert.strictEqual(s.runtime.getSnapshot(), before)
  assert.equal(s.host.getSnapshot().preview, null)
})

test('a guard invalidated by REQUESTING publication blocks provider egress', async t => {
  const s = setup(t), g = guardFixture(), before = s.runtime.getSnapshot()
  s.host.subscribe(() => { if (s.host.getSnapshot().phase === 'REQUESTING') g.revoke() })
  await rejection(request(s.host, g.guard), 'PROACTIVE_DISABLED')
  assert.equal(s.calls(), 0); assert.equal(s.writes(), 0)
  assert.strictEqual(s.runtime.getSnapshot(), before)
  assert.equal(s.host.getSnapshot().preview, null)
})

for (const reason of ['TTL', 'consent']) test(`guard invalidation during provider wait rejects ${reason} without publishing preview`, async t => {
  let resolve, captured
  const delayed = new Promise(done => { resolve = done })
  const s = setup(t, input => { captured = input; return delayed }), g = guardFixture(), before = s.runtime.getSnapshot()
  const pending = request(s.host, g.guard)
  assert.equal(s.host.getSnapshot().phase, 'REQUESTING'); assert.equal(s.calls(), 1)
  if (reason === 'TTL') g.expire(); else g.revoke()
  resolve(mockAddOptionalField(captured))
  await rejection(pending, reason === 'TTL' ? 'SUGGESTION_EXPIRED' : 'PROACTIVE_DISABLED')
  assert.equal(s.host.getSnapshot().preview, null); assert.equal(s.host.getSnapshot().busy, false)
  assert.equal(s.writes(), 0); assert.strictEqual(s.runtime.getSnapshot(), before)
})

for (const reason of ['TTL', 'consent']) test(`preview confirmation rejects ${reason} with no writes`, async t => {
  const s = setup(t), g = guardFixture(), before = s.runtime.getSnapshot()
  await request(s.host, g.guard)
  const planId = s.host.getSnapshot().preview.planId
  assert.equal(s.writes(), 0); assert.strictEqual(s.runtime.getSnapshot(), before)
  if (reason === 'TTL') g.expire(); else g.revoke()
  await rejection(s.host.callbacks.onConfirm(planId), reason === 'TTL' ? 'SUGGESTION_EXPIRED' : 'PROACTIVE_DISABLED')
  assert.equal(s.host.getSnapshot().preview, null)
  assert.equal(s.writes(), 0); assert.strictEqual(s.runtime.getSnapshot(), before)
  await rejection(s.host.callbacks.onConfirm(planId), 'PLAN_NOT_PENDING')
})

for (const reason of ['TTL', 'consent']) test(`CONFIRMING observer invalidating ${reason} prevents the Runtime transaction`, async t => {
  const s = setup(t), g = guardFixture(), before = s.runtime.getSnapshot()
  await request(s.host, g.guard)
  const planId = s.host.getSnapshot().preview.planId
  let observed = 0
  s.host.subscribe(() => {
    if (s.host.getSnapshot().phase !== 'CONFIRMING') return
    observed++
    if (reason === 'TTL') g.expire(); else g.revoke()
  })
  await rejection(s.host.callbacks.onConfirm(planId), reason === 'TTL' ? 'SUGGESTION_EXPIRED' : 'PROACTIVE_DISABLED')
  assert.equal(observed, 1); assert.equal(s.writes(), 0)
  assert.strictEqual(s.runtime.getSnapshot(), before)
  assert.equal(s.host.getSnapshot().preview, null)
  await rejection(s.host.callbacks.onConfirm(planId), 'PLAN_NOT_PENDING')
})

test('a valid guarded preview executes exactly once and retains records', async t => {
  const s = setup(t), g = guardFixture(), before = s.runtime.getSnapshot()
  await request(s.host, g.guard)
  assert.equal(s.writes(), 0); assert.strictEqual(s.runtime.getSnapshot(), before)
  const planId = s.host.getSnapshot().preview.planId
  await Promise.all([s.host.callbacks.onConfirm(planId), s.host.callbacks.onConfirm(planId)])
  await s.host.callbacks.onConfirm(planId)
  assert.equal(s.writes(), 1); assert.equal(s.calls(), 1)
  assert.equal(s.runtime.getSnapshot().revision, before.revision + 1)
  assert.deepEqual(s.runtime.getSnapshot().records, before.records)
  assert.deepEqual(s.runtime.getSnapshot().blockPositions, before.blockPositions)
  assert.equal(s.host.getSnapshot().phase, 'APPLIED')
  assert.equal(s.host.getSnapshot().preview, null)
  assert.ok(s.runtime.getSnapshot().spec.entities.flatMap(entity => entity.fields).some(field => field.name === 'Mock 备注'))
})
