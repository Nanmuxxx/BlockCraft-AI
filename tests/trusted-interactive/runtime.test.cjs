const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { assertAppSpec, assertProjectState } = require('../../src/model/appSpecValidation.ts')
const { initializeGeneratedProject } = require('../../src/components/ai-create/generateApp.ts')
const { timerRemaining } = require('../../src/model/appRuntime.ts')
const { migrateProjectState, exportProjectState } = require('../../src/custom-block/project.ts')
const { captureExport } = require('../../src/integrations/project-export/capture.ts')
const fixture = require('./pomodoro.json')
const copy = () => structuredClone(fixture)
test('strict v2 config accepts boundaries and rejects executable/unknown/malformed fields', () => {
  for (const duration of [1, 1500, 7200]) { const spec = copy(); spec.blocks[0].durationSeconds = duration; assertAppSpec(spec) }
  for (const mutate of [
    s => { s.version = 1 }, s => { s.version = 3 }, s => { s.script = 'alert(1)' },
    s => { s.blocks[0].onClick = 'alert(1)' }, s => { s.blocks[0].protocolVersion = 2 },
    s => { s.blocks[0].durationSeconds = 0 }, s => { s.blocks[0].durationSeconds = 7201 },
    s => { s.blocks[0].durationSeconds = '25' }, s => { s.blocks[0].durationSeconds = 1.5 },
    s => { s.blocks[0].name = ' ' }, s => { s.blocks[0].name = 'a'.repeat(121) },
    s => { s.blocks[0].durationSeconds = Infinity }, s => { delete s.blocks[0].protocolVersion },
    s => { s.blocks[0].id = s.id }, s => { s.blocks[0].type = 'tsx' },
    s => { s.blocks[0].expression = { type: 'call', name: 'eval' } },
  ]) { const spec = copy(); mutate(spec); assert.throws(() => assertAppSpec(spec)) }
})
test('timer anchors survive mode-like remounts, pause/resume/reset, completion and backwards wall clock', () => {
  const runtime = createAppRuntime(initializeGeneratedProject(copy()))
  const original = Date.now
  let now = 10000; Date.now = () => now
  try {
    assert.equal(runtime.timerAction('focus-timer', 'start').ok, true)
    now += 2300
    assert.equal(timerRemaining(runtime.getSnapshot().timers['focus-timer'], now), 1497700)
    runtime.moveBlock('focus-timer', { x: .2, y: .8 })
    runtime.timerAction('focus-timer', 'pause')
    assert.equal(runtime.getSnapshot().timers['focus-timer'].remainingMs, 1497700)
    now += 20000
    assert.equal(timerRemaining(runtime.getSnapshot().timers['focus-timer'], now), 1497700)
    runtime.timerAction('focus-timer', 'start'); now += 1000
    runtime.timerAction('focus-timer', 'pause')
    assert.equal(runtime.getSnapshot().timers['focus-timer'].remainingMs, 1496700)
    runtime.timerAction('focus-timer', 'reset')
    assert.deepEqual(runtime.getSnapshot().timers['focus-timer'], { remainingMs: 1500000, startedAt: null })
    runtime.timerAction('focus-timer', 'start'); now += 1600000
    assert.equal(timerRemaining(runtime.getSnapshot().timers['focus-timer'], now), 0)
    runtime.timerAction('focus-timer', 'pause')
    assert.equal(runtime.getSnapshot().timers['focus-timer'].remainingMs, 0)
    assert.equal(timerRemaining({ remainingMs: 10, startedAt: 100 }, 50), 10)
  } finally { Date.now = original }
})
test('same owner preserves CRUD, custom state and layout; read-only and stale CAS fail atomically', async () => {
  const initial = createClubRegistrationExample()
  initial.spec.version = 2
  initial.spec.blocks.push(copy().blocks[0]); initial.blockPositions['focus-timer'] = { x: .1, y: .5 }
  const runtime = createAppRuntime(initial), owner = runtime.customProject
  const records = structuredClone(runtime.getSnapshot().records)
  const stale = owner.getSnapshot(), auth = owner.getAuthorization()
  let publications = 0; owner.subscribe(() => publications++)
  runtime.timerAction('focus-timer', 'start')
  assert.equal(publications, 1)
  assert.deepEqual(owner.getSnapshot().base.records, records)
  assert.deepEqual(owner.getSnapshot().base.blockPositions, initial.blockPositions)
  assert.equal(owner.getSnapshot().revision, runtime.getSnapshot().revision)
  assert.equal(owner.getSnapshot().base.timers, runtime.getSnapshot().timers)
  const next = structuredClone(stale); next.revision++
  assert.equal(owner.compareAndSwap(stale, next, auth).error.code, 'REVISION_CONFLICT')
  owner.setReadOnly(true)
  const before = owner.getSnapshot()
  for (const action of ['start', 'pause', 'reset']) assert.equal(runtime.timerAction('focus-timer', action).error.code, 'READ_ONLY')
  assert.equal(owner.getSnapshot(), before)
  owner.setReadOnly(false)
  runtime.dispatch({ type: 'create', entityId: 'applicants', record: { id: 'timer-neighbor', values: { 'applicant-name': '保留记录', department: '策划部', available: false } } })
  const timer = runtime.getSnapshot().timers['focus-timer']
  runtime.timerAction('focus-timer', 'pause')
  assert.equal(runtime.getSnapshot().records.applicants.length, records.applicants.length + 1)
  assert.ok(timer.startedAt !== null)
  assert.equal(runtime.timerAction('missing', 'start').ok, false)
  assert.equal(runtime.timerAction('focus-timer', 'execute-code').ok, false)
  await assert.rejects(captureExport(owner), { code: 'UNSUPPORTED_APP_SPEC' })
  assert.throws(() => exportProjectState(owner.getSnapshot()), /AppSpec v2/)
})
test('state schema rejects dangling/invalid timers; removing timer cleans state and undo restores it', () => {
  const state = initializeGeneratedProject(copy()); state.timers = { 'focus-timer': { remainingMs: 42, startedAt: null } }
  assertProjectState(state)
  for (const mutate of [s => s.spec.version = 1, s => s.timers.missing = s.timers['focus-timer'], s => s.timers['focus-timer'].remainingMs = -1, s => s.timers['focus-timer'].startedAt = 'now', s => s.timers['focus-timer'].remainingMs = 1500001, s => s.timers['focus-timer'].script = 'code']) {
    const invalid = structuredClone(state); mutate(invalid); assert.throws(() => assertProjectState(invalid))
  }
  const runtime = createAppRuntime(state)
  assert.equal(runtime.executeCommand({ requestId: 'remove-timer', baseRevision: 0, commands: [{ type: 'removeBlock', blockId: 'focus-timer' }] }).ok, true)
  assert.deepEqual(runtime.getSnapshot().timers, {})
  assert.equal(runtime.executeCommand({ requestId: 'undo-timer', baseRevision: 1, commands: [{ type: 'undo' }] }).ok, true)
  assert.deepEqual(runtime.getSnapshot().timers, state.timers)
  const legacy = createClubRegistrationExample(); legacy.timers = {}; assert.throws(() => migrateProjectState(legacy))
})
test('timer commits preserve admitted custom props/state and exact render order', async () => {
  const { setup } = require('../custom-block/fixtures.cjs')
  const { entry, reference } = await setup()
  const state = initializeGeneratedProject(copy()), runtime = createAppRuntime(state), owner = runtime.customProject
  assert.equal((await owner.install({ baseRevision: 0, expectedReference: null, artifact: entry, instance: { id: 'inert-fixture', ...reference, props: { durationSeconds: 600 } } })).ok, true)
  const beforeState = owner.getSnapshot(), next = structuredClone(beforeState)
  next.custom.states['inert-fixture'] = { versionDigest: reference.versionDigest, stateRevision: 0, value: { remainingSeconds: 600, status: 'idle' } }
  next.revision++
  assert.equal(owner.compareAndSwap(beforeState, next, owner.getAuthorization()).ok, true)
  const before = structuredClone(owner.getSnapshot())
  for (const action of ['start', 'pause', 'reset']) assert.equal(runtime.timerAction('focus-timer', action).ok, true)
  assert.deepEqual(owner.getSnapshot().custom, before.custom)
  assert.deepEqual(owner.getSnapshot().renderOrder, before.renderOrder)
})
test('Mochi can select/read timer metadata but cannot grant timer modification authority', async () => {
  const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
  const { projectContext } = await import('../../src/integrations/mochi-ai/protocol.mjs')
  const runtime = createAppRuntime(initializeGeneratedProject(copy()))
  let calls = 0
  const host = createMochiHost(runtime, () => { calls++; throw new Error('must not run') })
  try {
    host.setSelection('focus-timer')
    const context = projectContext({ ...host.getSnapshot().context, mode: host.getSnapshot().mode })
    assert.equal(context.selectedBlockId, 'focus-timer')
    assert.deepEqual(context.blocks[0].fieldIds, [])
    assert.deepEqual(context.relations, [])
    await assert.rejects(host.callbacks.onRequestPlan('修改时间'), { code: 'TIMER_SCOPE_UNAVAILABLE' })
    assert.equal(calls, 0)
  } finally { host.dispose() }
})

test('duplicate actions and rapid switching never extend a running deadline or subtract twice', () => {
  const spec = copy(); spec.blocks[0].durationSeconds = 6
  const runtime = createAppRuntime(initializeGeneratedProject(spec)), original = Date.now
  let now = 10000; Date.now = () => now
  try {
    runtime.timerAction('focus-timer', 'start')
    for (let i = 0; i < 40; i++) {
      now += 10
      runtime.timerAction('focus-timer', 'start')
      const current = runtime.getSnapshot().timers['focus-timer']
      assert.equal(current.remainingMs + current.startedAt, 16000)
    }
    for (let i = 0; i < 40; i++) {
      runtime.timerAction('focus-timer', 'pause')
      const paused = runtime.getSnapshot().timers['focus-timer'].remainingMs
      now += 100
      runtime.timerAction('focus-timer', 'pause')
      assert.equal(runtime.getSnapshot().timers['focus-timer'].remainingMs, paused)
      runtime.timerAction('focus-timer', 'start')
      now += 10
    }
    runtime.timerAction('focus-timer', 'reset')
    runtime.timerAction('focus-timer', 'reset')
    assert.deepEqual(runtime.getSnapshot().timers['focus-timer'], { remainingMs: 6000, startedAt: null })
  } finally { Date.now = original }
})
test('completion is a stable read-only derived state until an explicit reset', () => {
  const spec = copy(); spec.blocks[0].durationSeconds = 1
  const runtime = createAppRuntime(initializeGeneratedProject(spec)), original = Date.now
  let now = 1000; Date.now = () => now
  try {
    runtime.timerAction('focus-timer', 'start')
    const anchor = runtime.getSnapshot(), revision = anchor.revision
    let completedTransitions = 0, previous = false
    for (let i = 0; i < 40; i++) {
      now += 100
      const completed = timerRemaining(anchor.timers['focus-timer'], now) === 0
      if (completed && !previous) completedTransitions++
      previous = completed
    }
    assert.equal(completedTransitions, 1)
    assert.equal(runtime.getSnapshot(), anchor)
    assert.equal(runtime.getSnapshot().revision, revision)
    for (let i = 0; i < 10; i++) {
      runtime.timerAction('focus-timer', 'start')
      assert.equal(timerRemaining(runtime.getSnapshot().timers['focus-timer'], now), 0)
    }
    runtime.timerAction('focus-timer', 'reset')
    assert.equal(timerRemaining(runtime.getSnapshot().timers['focus-timer'], now), 1000)
  } finally { Date.now = original }
})
