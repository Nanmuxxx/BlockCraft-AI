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
require.extensions['.css'] = () => {}
require.extensions['.png'] = (module, filename) => { module.exports = filename }
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { createMochiHost } = require('./host.ts')
const { mockAddOptionalField } = require('./mockPlanner.ts')
const { createAppChangePlanner } = require('../../model/appChangePlan.ts')
const { createAppRuntime } = require('../../model/appRuntime.ts')
const { createClubRegistrationExample, createReadingLogExample } = require('../../model/appSpecExamples.ts')
const { AppRenderer } = require('../../components/app-renderer/AppRenderer.tsx')
const { AppSpecCanvas } = require('../../components/app-builder/AppSpecCanvas.tsx')
function setup(provider = mockAddOptionalField, initial = createClubRegistrationExample()) {
  const runtime = createAppRuntime(initial)
  let executions = 0, updates = 0
  const authorizationArgs = []
  const execute = runtime.executeCommand
  runtime.executeCommand = (request, authorization) => { executions++; authorizationArgs.push(authorization); return execute(request, authorization) }
  runtime.subscribe(() => updates++)
  const host = createMochiHost(runtime, provider)
  host.setSelection(initial.spec.blocks[0].id)
  return { runtime, host, executions: () => executions, updates: () => updates, authorizationArgs: () => authorizationArgs }
}
async function plan(host) { await host.callbacks.onRequestPlan('这是固定 Mock，不解析这句话'); return host.getSnapshot().preview.planId }
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code)
function defer() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

// Inject notification loss at the Runtime boundary. The production v2 owner
// isolates observer exceptions, so throwing subscribers no longer drop events.
function notificationGate(runtime) {
  const subscribe = runtime.subscribe
  let paused = false
  runtime.subscribe = listener => subscribe(() => { if (!paused) listener() })
  return action => { paused = true; try { return action() } finally { paused = false } }
}

test('Mock preview is isolated, immutable, complete; confirm updates real B/C renderers exactly once', async () => {
  const s = setup()
  const before = s.runtime.getSnapshot()
  const id = await plan(s.host)
  assert.strictEqual(s.runtime.getSnapshot(), before)
  assert.equal(s.executions(), 0); assert.equal(s.updates(), 0)
  const view = s.host.getSnapshot()
  assert.ok(Object.isFrozen(view.context.entities[0].fields))
  assert.ok(!JSON.stringify(view.context).includes('小林')) // no record values in UI context
  assert.ok(view.preview.changes.some(c => c.operation === 'sharedEntityImpact' && c.description.includes('applicant-list')))
  assert.throws(() => { view.preview.planId = 'forged' }, TypeError)
  await Promise.all([s.host.callbacks.onConfirm(id), s.host.callbacks.onConfirm(id)])
  assert.equal(s.executions(), 1); assert.equal(s.updates(), 1)
  assert.equal(s.runtime.getSnapshot().revision, before.revision + 1)
  assert.deepEqual(s.runtime.getSnapshot().records, before.records)
  assert.deepEqual(s.runtime.getSnapshot().blockPositions, before.blockPositions)
  assert.deepEqual(s.runtime.getSnapshot().spec.blocks[1], before.spec.blocks[1])
  const canvas = renderToStaticMarkup(React.createElement(AppSpecCanvas, { runtime: s.runtime, selectedBlockId: 'registration-form' }))
  assert.match(canvas, /Mock 备注/)
  s.host.setMode('run')
  const app = renderToStaticMarkup(React.createElement(AppRenderer, { runtime: s.runtime }))
  assert.match(app, /Mock 备注/); assert.match(app, /小林/)
  s.host.setMode('blocks')
  assert.match(renderToStaticMarkup(React.createElement(AppSpecCanvas, { runtime: s.runtime, selectedBlockId: 'registration-form' })), /Mock 备注/)
  assert.equal(s.runtime.getSnapshot().revision, 1)
  s.host.dispose()
})

test('callback context cannot grant selection or scope; provider sees only host context', async () => {
  let captured
  const s = setup(req => { captured = req; return mockAddOptionalField(req) })
  const context = { selectedBlockId: 'applicant-list', allowedBlockIds: ['applicant-list'], revision: 900 }
  await s.host.callbacks.onRequestPlan('mock', context)
  assert.equal(captured.context.selectedBlockId, 'registration-form')
  assert.equal(captured.context.revision, 0)
  assert.equal(captured.runtime, undefined); assert.equal(captured.scope, undefined)
  assert.ok(Object.isFrozen(captured.snapshot.records.applicants))
  await s.host.callbacks.onConfirm(s.host.getSnapshot().preview.planId)
  assert.equal(s.runtime.getSnapshot().spec.blocks[1].fieldIds.length, 2)
})

test('no selection cannot be replaced with a component hint', async () => {
  let calls = 0
  const s = setup(() => { calls++ })
  s.host.setSelection(null)
  await rejects(s.host.callbacks.onRequestPlan('mock', { selectedBlockId: 'registration-form' }), 'SELECTION_REQUIRED')
  assert.equal(calls, 0); assert.equal(s.executions(), 0)
  assert.throws(() => s.host.setSelection('missing'), error => error.code === 'UNKNOWN_TARGET')
})

for (const [name, initial, change, code] of [
  ['sibling block sharing entity', createClubRegistrationExample, { type: 'removeBlock', blockId: 'applicant-list' }, 'SCOPE_VIOLATION'],
  ['other entity', createReadingLogExample, { type: 'addField', entityId: 'reading-sessions', field: { id: 'secret', name: '越权', type: 'text', required: false } }, 'SCOPE_VIOLATION'],
  ['record command', createClubRegistrationExample, { type: 'deleteRecord', entityId: 'applicants', recordId: 'applicant-001' }, undefined],
]) test(`rejects ${name} from provider without changing Runtime`, async () => {
  const s = setup(req => ({ request: { requestId: req.requestId, baseRevision: req.context.revision, commands: [change] }, capabilityIds: [] }), initial())
  const before = s.runtime.getSnapshot()
  await assert.rejects(plan(s.host), error => !code || error.code === code)
  assert.strictEqual(s.runtime.getSnapshot(), before); assert.equal(s.executions(), 0)
  assert.equal(s.host.getSnapshot().preview, null)
})

for (const [name, mutate, code] of [
  ['request ID', c => { c.request.requestId = 'foreign-request' }, 'PLAN_BINDING_MISMATCH'],
  ['revision', c => { c.request.baseRevision++ }, 'REVISION_CONFLICT'],
  ['scope injection', c => { c.scope = { allowedBlockIds: ['applicant-list'] } }, 'VALIDATION'],
  ['unsupported capability', c => { c.capabilityIds = ['workout-timer'] }, 'UNSUPPORTED_CAPABILITY'],
]) test(`rejects provider ${name} tampering`, async () => {
  const s = setup(req => { const c = mockAddOptionalField(req); mutate(c); return c })
  const before = s.runtime.getSnapshot()
  await rejects(plan(s.host), code)
  assert.strictEqual(s.runtime.getSnapshot(), before); assert.equal(s.executions(), 0)
})

test('cancel is idempotent; cancelled and invented planIds cannot execute', async () => {
  const s = setup(), id = await plan(s.host), before = s.runtime.getSnapshot()
  s.host.callbacks.onCancel(id); s.host.callbacks.onCancel(id)
  await rejects(s.host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  await rejects(s.host.callbacks.onConfirm('made-up-plan'), 'PLAN_NOT_OWNED')
  assert.strictEqual(s.runtime.getSnapshot(), before); assert.equal(s.executions(), 0)
})

test('selection A→B→A and a newer request both revoke old plans', async () => {
  const s = setup(), old = await plan(s.host)
  s.host.setSelection('applicant-list'); s.host.setSelection('registration-form')
  await rejects(s.host.callbacks.onConfirm(old), 'PLAN_NOT_PENDING')
  const middle = await plan(s.host), newest = await plan(s.host)
  await rejects(s.host.callbacks.onConfirm(middle), 'PLAN_NOT_PENDING')
  await s.host.callbacks.onConfirm(newest)
  assert.equal(s.executions(), 1)
})

for (const [name, mutate] of [
  ['records', r => r.updateRecords({ type: 'update', entityId: 'applicants', recordId: 'applicant-001', values: { 'applicant-name': '新姓名', department: '宣传部' } })],
  ['layout', r => r.moveBlock('applicant-list', { x: 0.3, y: 0.4 })],
  ['schema', r => r.executeCommand({ requestId: 'external', baseRevision: 0, commands: [{ type: 'removeBlock', blockId: 'registration-form' }] })],
]) test(`${name} revision invalidates preview and preserves the external update`, async () => {
  const s = setup(), id = await plan(s.host)
  assert.equal(mutate(s.runtime).ok, true)
  const changed = s.runtime.getSnapshot(), executions = s.executions()
  await rejects(s.host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  assert.strictEqual(s.runtime.getSnapshot(), changed); assert.equal(s.executions(), executions)
  assert.equal(s.host.getSnapshot().preview, null)
})

test('same appId/revision in different Runtime cannot use the other host planId', async () => {
  const a = setup(), b = setup(), id = await plan(a.host)
  await rejects(b.host.callbacks.onConfirm(id), 'PLAN_NOT_OWNED')
  await a.host.callbacks.onConfirm(id)
  assert.equal(b.runtime.getSnapshot().revision, 0); assert.equal(b.executions(), 0)
})

test('reentrant confirmation during Runtime publish cannot execute twice', async () => {
  const s = setup(), id = await plan(s.host)
  let reentrant
  s.runtime.subscribe(() => { reentrant = rejects(s.host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING') })
  await s.host.callbacks.onConfirm(id); await reentrant
  await s.host.callbacks.onConfirm(id)
  assert.equal(s.executions(), 1); assert.equal(s.updates(), 1)
})

test('ignoring suggestions only updates host state and leaves pending plan intact', async () => {
  const s = setup(), id = await plan(s.host), before = s.runtime.getSnapshot()
  s.host.callbacks.onIgnore('suggestion'); s.host.callbacks.onIgnore('suggestion')
  assert.deepEqual(s.host.getSnapshot().ignoredSuggestionIds, ['suggestion'])
  assert.equal(s.host.getSnapshot().preview.planId, id)
  assert.strictEqual(s.runtime.getSnapshot(), before); assert.equal(s.executions(), 0)
})

test('B/C mode changes preserve in-flight requests and previews without rebuilding Runtime', async () => {
  const deferred = defer()
  let request
  const s = setup(req => { request = req; return deferred.promise })
  const before = s.runtime.getSnapshot()
  const inflight = s.host.callbacks.onRequestPlan('mock')
  const epoch = s.host.getSnapshot().epoch
  s.host.setMode('run')
  assert.equal(request.signal.aborted, false)
  assert.equal(s.host.getSnapshot().phase, 'REQUESTING')
  deferred.resolve(mockAddOptionalField(request))
  await inflight
  const id = s.host.getSnapshot().preview.planId
  s.host.setMode('blocks'); s.host.setMode('run')
  assert.equal(s.host.getSnapshot().epoch, epoch)
  assert.equal(s.host.getSnapshot().preview.planId, id)
  assert.strictEqual(s.runtime.getSnapshot(), before)
  await s.host.callbacks.onConfirm(id)
  assert.equal(s.executions(), 1)
  assert.equal(s.host.getSnapshot().phase, 'APPLIED')
})

for (const lateFailure of [false, true]) test(`obsolete async ${lateFailure ? 'failure' : 'success'} cannot clear a newer preview`, async () => {
  const deferred = defer()
  let oldRequest, count = 0
  const s = setup(req => { if (++count === 1) { oldRequest = req; return deferred.promise } return mockAddOptionalField(req) })
  const inflight = s.host.callbacks.onRequestPlan('old')
  s.host.setSelection('applicant-list')
  const id = await plan(s.host), view = s.host.getSnapshot()
  if (lateFailure) deferred.reject(new Error('old network error'))
  else deferred.resolve(mockAddOptionalField(oldRequest))
  await assert.rejects(inflight)
  assert.strictEqual(s.host.getSnapshot(), view)
  await s.host.callbacks.onConfirm(id); assert.equal(s.executions(), 1)
})

test('anchor is host geometry bound to selection, instance, epoch and revision', async () => {
  const s = setup(), view = s.host.getSnapshot()
  const anchor = { instanceId: view.context.instanceId, revision: view.context.revision, selectedBlockId: view.context.selectedBlockId, epoch: view.epoch, rect: { x: 12, y: 34, width: 100, height: 50, placement: 'right' } }
  s.host.setAnchor(anchor); anchor.rect.x = 999
  assert.equal(s.host.getSnapshot().anchor.x, 12)
  assert.throws(() => s.host.setAnchor({ ...anchor, instanceId: 'foreign' }), /Stale anchor/)
  assert.throws(() => s.host.setAnchor({ ...anchor, rect: { x: NaN, y: 0 } }), /Invalid anchor/)
  await plan(s.host)
  assert.equal(s.host.getSnapshot().anchor, null)
  assert.throws(() => s.host.setAnchor(anchor), /Stale anchor/)
  s.runtime.moveBlock('registration-form', { x: 0.1, y: 0.1 })
  assert.throws(() => s.host.setAnchor({ ...anchor, epoch: s.host.getSnapshot().epoch }), /Stale anchor/)
})

test('failed next plan or rejected execution retains the previously confirmed application', async () => {
  let fail = false
  const s = setup(req => { if (fail) throw new Error('network'); return mockAddOptionalField(req) })
  await s.host.callbacks.onConfirm(await plan(s.host))
  const confirmed = s.runtime.getSnapshot()
  fail = true
  await rejects(plan(s.host), 'PLAN_PROVIDER_FAILED')
  assert.strictEqual(s.runtime.getSnapshot(), confirmed)
  assert.equal(s.host.getSnapshot().receipt, null)
  assert.equal(s.host.getSnapshot().lastApplied.receipt.committedRevision, 1)
  assert.equal(s.host.getSnapshot().phase, 'REQUEST_FAILED')
  fail = false
  const id = await plan(s.host)
  s.runtime.executeCommand = () => ({ ok: false, error: { code: 'TEST_REJECTED', message: 'atomic failure' } })
  await rejects(s.host.callbacks.onConfirm(id), 'TEST_REJECTED')
  await rejects(s.host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  assert.strictEqual(s.runtime.getSnapshot(), confirmed)
  assert.equal(s.host.getSnapshot().preview, null)
})

test('disposal aborts requests, cancels pending confirmation and releases Runtime subscription', async () => {
  const deferred = defer()
  let request
  const s = setup(req => { request = req; return deferred.promise })
  const inflight = s.host.callbacks.onRequestPlan('mock')
  s.host.dispose(); s.host.dispose()
  const disposed = s.host.getSnapshot()
  assert.ok(request.signal.aborted)
  deferred.resolve(mockAddOptionalField(request))
  await rejects(inflight, 'CONTEXT_CHANGED')
  s.runtime.moveBlock('registration-form', { x: 0, y: 0 })
  assert.strictEqual(s.host.getSnapshot(), disposed)
  await rejects(s.host.callbacks.onRequestPlan('mock'), 'HOST_DISPOSED')
  const other = setup(), id = await plan(other.host)
  other.host.dispose()
  await rejects(other.host.callbacks.onConfirm(id), 'HOST_DISPOSED')
  assert.equal(other.executions(), 0)
})

for (const lateFailure of [false, true]) test(`requestId cancellation ignores late ${lateFailure ? 'reject' : 'resolve'} and cannot clear the next busy state`, async () => {
  const old = defer(), next = defer()
  const requests = []
  const s = setup(req => { requests.push(req); return requests.length === 1 ? old.promise : next.promise })
  const first = s.host.callbacks.onRequestPlan('old')
  const oldId = s.host.getSnapshot().requestId
  s.host.cancelRequest('foreign')
  assert.equal(requests[0].signal.aborted, false)
  s.host.cancelRequest(oldId)
  const cancelled = s.host.getSnapshot()
  assert.equal(cancelled.phase, 'CANCELLED'); assert.equal(cancelled.busy, false)
  assert.equal(requests[0].signal.aborted, true)
  const second = s.host.callbacks.onRequestPlan('new')
  const current = s.host.getSnapshot()
  s.host.cancelRequest(oldId)
  if (lateFailure) old.reject(new Error('late failure'))
  else old.resolve(mockAddOptionalField(requests[0]))
  await assert.rejects(first)
  assert.strictEqual(s.host.getSnapshot(), current)
  assert.equal(current.phase, 'REQUESTING'); assert.equal(current.busy, true)
  next.resolve(mockAddOptionalField(requests[1])); await second
  assert.equal(s.host.getSnapshot().phase, 'PREVIEW')
  assert.equal(s.updates(), 0); assert.equal(s.executions(), 0)
})

for (const lateFailure of [false, true]) test(`new request supersedes old ${lateFailure ? 'failure' : 'success'} without requiring cancellation`, async () => {
  const deferred = defer()
  let oldRequest, count = 0
  const s = setup(req => { if (++count === 1) { oldRequest = req; return deferred.promise } return mockAddOptionalField(req) })
  const first = s.host.callbacks.onRequestPlan('old')
  const second = s.host.callbacks.onRequestPlan('new')
  await second
  const current = s.host.getSnapshot()
  assert.equal(oldRequest.signal.aborted, true)
  if (lateFailure) deferred.reject(new Error('old'))
  else deferred.resolve(mockAddOptionalField(oldRequest))
  await assert.rejects(first)
  assert.strictEqual(s.host.getSnapshot(), current)
})

test('abort reentrancy starts a newer request without resurrecting the cancelled attempt', async () => {
  const deferred = defer()
  let count = 0, newer
  const s = setup(req => {
    if (++count === 1) {
      req.signal.addEventListener('abort', () => { newer = s.host.callbacks.onRequestPlan('from abort') })
      return deferred.promise
    }
    return mockAddOptionalField(req)
  })
  const old = s.host.callbacks.onRequestPlan('old')
  const id = s.host.getSnapshot().requestId
  s.host.cancelRequest(id)
  await newer
  const current = s.host.getSnapshot()
  deferred.reject(new Error('late'))
  await assert.rejects(old)
  assert.equal(current.phase, 'PREVIEW')
  assert.strictEqual(s.host.getSnapshot(), current)
})

test('request replacement abort callbacks cannot overwrite the newest owner', async () => {
  const deferred = defer()
  let count = 0, fromAbort
  const s = setup(req => {
    if (++count === 1) {
      req.signal.addEventListener('abort', () => { fromAbort = s.host.callbacks.onRequestPlan('third') })
      return deferred.promise
    }
    return mockAddOptionalField(req)
  })
  const first = s.host.callbacks.onRequestPlan('first')
  const second = s.host.callbacks.onRequestPlan('second')
  await rejects(second, 'CONTEXT_CHANGED')
  await fromAbort
  const current = s.host.getSnapshot()
  deferred.reject(new Error('late')); await assert.rejects(first)
  assert.equal(count, 2) // Superseded second request never reaches provider.
  assert.equal(current.phase, 'PREVIEW')
  assert.strictEqual(s.host.getSnapshot(), current)
})

test('authorization identity invalidates plans but never grants scope', async () => {
  const s = setup(), id = await plan(s.host), before = s.runtime.getSnapshot()
  s.host.setAuthorizationContextKey('changed')
  assert.equal(s.host.getSnapshot().phase, 'STALE')
  await rejects(s.host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  assert.strictEqual(s.runtime.getSnapshot(), before)
  s.host.setAuthorizationContextKey('allowedBlockIds=all')
  await plan(s.host)
  const shared = s.host.getSnapshot().preview.changes.find(c => c.operation === 'sharedEntityImpact')
  assert.match(shared.description, /直接授权外：applicant-list/)
})

test('test wrapper forwards the preview authorization to Runtime', async () => {
  const s = setup(), id = await plan(s.host)
  const authorization = s.runtime.customProject.getAuthorization()
  await s.host.callbacks.onConfirm(id)
  assert.equal(s.executions(), 1)
  assert.strictEqual(s.authorizationArgs()[0], authorization)
})

test('old preview authorization cannot pass final CAS after authorization generation changes', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const initial = runtime.getSnapshot(), block = initial.spec.blocks[0]
  const entityId = initial.spec.relations.find(relation => relation.blockId === block.id).entityId
  const planner = createAppChangePlanner(runtime)
  const calls = []
  const execute = runtime.executeCommand
  runtime.executeCommand = (request, authorization) => { calls.push(authorization); return execute(request, authorization) }
  const candidate = mockAddOptionalField({
    prompt: 'authorization CAS regression', requestId: 'auth-cas-regression',
    context: { selectedBlockId: block.id, revision: initial.revision }, snapshot: initial, signal: new AbortController().signal,
  })
  const preview = planner.preview(candidate, { selectedBlockId: block.id, allowedBlockIds: [block.id], allowedEntityIds: [entityId] })
  assert.equal(preview.ok, true)
  const oldAuthorization = runtime.customProject.getAuthorization()
  runtime.customProject.setReadOnly(true)
  runtime.customProject.setReadOnly(false)
  assert.notStrictEqual(runtime.customProject.getAuthorization(), oldAuthorization)
  const result = planner.confirm(preview.plan)
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'AUTHORIZATION_CHANGED')
  assert.strictEqual(calls[calls.length - 1], oldAuthorization)
  assert.strictEqual(runtime.getSnapshot(), initial)
  assert.equal(runtime.getSnapshot().revision, initial.revision)
})

test('confirm locks before Host observers and own Runtime notifications never publish stale', async () => {
  const s = setup(), id = await plan(s.host), phases = []
  let reentrant
  s.host.subscribe(() => {
    phases.push(s.host.getSnapshot().phase)
    if (s.host.getSnapshot().phase === 'CONFIRMING') reentrant = rejects(s.host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  })
  s.host.subscribe(() => { throw new Error('UI observer failure') })
  await s.host.callbacks.onConfirm(id); await reentrant
  assert.equal(s.executions(), 1)
  assert.deepEqual(phases, ['CONFIRMING', 'APPLIED'])
  assert.equal(s.host.getSnapshot().receipt.ok, true)
})

test('synchronous context change while publishing CONFIRMING prevents any write', async () => {
  const s = setup(), id = await plan(s.host), before = s.runtime.getSnapshot()
  s.host.subscribe(() => {
    if (s.host.getSnapshot().phase === 'CONFIRMING') s.host.setSelection('applicant-list')
  })
  await rejects(s.host.callbacks.onConfirm(id), 'CONTEXT_CHANGED')
  assert.strictEqual(s.runtime.getSnapshot(), before)
  assert.equal(s.executions(), 0)
  assert.equal(s.host.getSnapshot().phase, 'STALE')
})

test('explicit failure with identical immutable snapshot is COMMIT_FAILED and terminal', async () => {
  const s = setup(), id = await plan(s.host), before = s.runtime.getSnapshot()
  s.runtime.executeCommand = () => ({ ok: false, error: { code: 'REJECTED', message: 'no write' } })
  await rejects(s.host.callbacks.onConfirm(id), 'REJECTED')
  assert.strictEqual(s.runtime.getSnapshot(), before)
  assert.equal(s.host.getSnapshot().phase, 'COMMIT_FAILED')
  assert.equal(s.host.getSnapshot().receipt.ok, false)
  const failed = s.host.getSnapshot()
  await rejects(s.host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  assert.strictEqual(s.host.getSnapshot(), failed)
})

for (const afterWrite of [false, true]) test(`unexpected exception ${afterWrite ? 'after Runtime writes' : 'before known receipt'} is UNKNOWN, never a rollback claim`, async () => {
  const s = setup(), id = await plan(s.host), before = s.runtime.getSnapshot()
  if (afterWrite) {
    const execute = s.runtime.executeCommand
    s.runtime.executeCommand = (...args) => { execute(...args); throw new Error('receipt unavailable AFTER session changed') }
  }
  else s.runtime.executeCommand = () => { throw new Error('unexpected exception') }
  await rejects(s.host.callbacks.onConfirm(id), 'COMMIT_OUTCOME_UNKNOWN')
  assert.equal(s.host.getSnapshot().phase, 'COMMIT_OUTCOME_UNKNOWN')
  assert.equal(s.host.getSnapshot().receipt, null)
  assert.equal(s.host.getSnapshot().lastApplied, null)
  assert.doesNotMatch(s.host.getSnapshot().error.message, /回滚|保持不变/)
  assert.equal(s.runtime.getSnapshot().revision, before.revision + (afterWrite ? 1 : 0))
  const executions = s.executions()
  await rejects(s.host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  assert.equal(s.executions(), executions)
})

test('a failure receipt after a write is UNKNOWN even without a thrown exception', async () => {
  const s = setup(), id = await plan(s.host)
  const execute = s.runtime.executeCommand
  s.runtime.executeCommand = request => { execute(request); return { ok: false, error: { code: 'MISLEADING', message: 'failed' } } }
  await rejects(s.host.callbacks.onConfirm(id), 'COMMIT_OUTCOME_UNKNOWN')
  assert.equal(s.runtime.getSnapshot().revision, 1)
  assert.equal(s.host.getSnapshot().phase, 'COMMIT_OUTCOME_UNKNOWN')
  assert.equal(s.host.getSnapshot().receipt, null)
})

test('new attempts clear current receipt while retaining history across cancel and preview rejection', async () => {
  let invalid = false
  const s = setup(req => invalid ? {} : mockAddOptionalField(req))
  const committed = await plan(s.host)
  await s.host.callbacks.onConfirm(committed)
  const history = s.host.getSnapshot().lastApplied
  const next = await plan(s.host)
  assert.equal(s.host.getSnapshot().receipt, null)
  s.host.callbacks.onCancel(next)
  assert.equal(s.host.getSnapshot().phase, 'CANCELLED')
  assert.strictEqual(s.host.getSnapshot().lastApplied, history)
  await s.host.callbacks.onConfirm(committed) // Historical idempotence cannot restore APPLIED.
  assert.equal(s.host.getSnapshot().phase, 'CANCELLED')
  invalid = true
  await assert.rejects(plan(s.host))
  assert.equal(s.host.getSnapshot().phase, 'PREVIEW_REJECTED')
  assert.equal(s.host.getSnapshot().receipt, null)
  assert.strictEqual(s.host.getSnapshot().lastApplied, history)
})

for (const reject of [false, true]) test(`disposed host cannot publish a late ${reject ? 'failure' : 'success'} into its replacement`, async () => {
  const deferred = defer()
  let request, notifications = 0
  const s = setup(req => { request = req; return deferred.promise })
  s.host.subscribe(() => notifications++)
  const old = s.host.callbacks.onRequestPlan('old')
  s.host.dispose()
  const frozen = s.host.getSnapshot(), count = notifications
  const replacement = createMochiHost(s.runtime, mockAddOptionalField)
  replacement.setSelection('registration-form')
  await plan(replacement)
  const current = replacement.getSnapshot()
  if (reject) deferred.reject(new Error('late'))
  else deferred.resolve(mockAddOptionalField(request))
  await assert.rejects(old)
  assert.strictEqual(s.host.getSnapshot(), frozen)
  assert.strictEqual(replacement.getSnapshot(), current)
  assert.equal(notifications, count)
  replacement.dispose()
})


test('invalid initial input reports an attempt without superseding a valid request', async () => {
  const deferred = defer()
  let request
  const s = setup(req => { request = req; return deferred.promise })
  s.host.setSelection(null)
  await rejects(s.host.callbacks.onRequestPlan('mock'), 'SELECTION_REQUIRED')
  assert.equal(s.host.getSnapshot().phase, 'REQUEST_FAILED')
  assert.equal(s.host.getSnapshot().error.code, 'SELECTION_REQUIRED')
  s.host.setSelection('registration-form')
  const pending = s.host.callbacks.onRequestPlan('valid')
  const view = s.host.getSnapshot()
  await rejects(s.host.callbacks.onRequestPlan(''), 'INVALID_PROMPT')
  assert.strictEqual(s.host.getSnapshot(), view)
  assert.equal(request.signal.aborted, false)
  deferred.resolve(mockAddOptionalField(request)); await pending
})

test('context invalidation inside Runtime publication cannot hide an uncertain write', async () => {
  const s = setup(), id = await plan(s.host)
  s.runtime.subscribe(() => { s.host.setSelection('applicant-list') })
  const execute = s.runtime.executeCommand
  s.runtime.executeCommand = (...args) => { execute(...args); throw new Error('receipt unavailable after write') }
  await rejects(s.host.callbacks.onConfirm(id), 'COMMIT_OUTCOME_UNKNOWN')
  assert.equal(s.runtime.getSnapshot().revision, 1)
  assert.equal(s.host.getSnapshot().phase, 'COMMIT_OUTCOME_UNKNOWN')
  assert.equal(s.host.getSnapshot().preview, null)
})

test('invalid input over 4000 characters reports an error without revoking a valid preview; corrected input retries', async () => {
  const s = setup(), id = await plan(s.host), before = s.runtime.getSnapshot()
  const preview = s.host.getSnapshot().preview, requestId = s.host.getSnapshot().requestId
  await rejects(s.host.callbacks.onRequestPlan('x'.repeat(4001)), 'INVALID_PROMPT')
  assert.equal(s.host.getSnapshot().error?.code, 'INVALID_PROMPT')
  assert.equal(s.host.getSnapshot().phase, 'PREVIEW')
  assert.strictEqual(s.host.getSnapshot().preview, preview)
  assert.equal(s.host.getSnapshot().requestId, requestId)
  assert.equal(s.host.getSnapshot().busy, false)
  const corrected = await plan(s.host)
  assert.notEqual(corrected, id)
  assert.equal(s.host.getSnapshot().error, null)
  assert.strictEqual(s.runtime.getSnapshot(), before)
  assert.equal(s.executions(), 0); assert.equal(s.updates(), 0)
})

for (const reenter of [false, true]) test(`missed Runtime notification terminates stale preview before confirm${reenter ? ' without cancelling a reentrant newer request' : ''}`, async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const withoutNotification = notificationGate(runtime)
  const deferred = defer()
  let calls = 0, nextRequest, nextPromise, writes = 0, notifications = 0
  const execute = runtime.executeCommand
  runtime.executeCommand = input => { writes++; return execute(input) }
  const host = createMochiHost(runtime, request => {
    if (++calls === 1) return mockAddOptionalField(request)
    nextRequest = request; return deferred.promise
  })
  host.setSelection('registration-form')
  const id = await plan(host), view = host.getSnapshot()
  host.subscribe(() => {
    notifications++
    if (reenter && host.getSnapshot().phase === 'STALE') nextPromise = host.callbacks.onRequestPlan('newer after stale')
  })
  assert.equal(withoutNotification(() => runtime.moveBlock('applicant-list', { x: 0.3, y: 0.4 })).ok, true)
  const changed = runtime.getSnapshot()
  assert.equal(changed.revision, view.context.revision + 1)
  assert.equal(changed.blockPositions['applicant-list'].x, 0.3)
  assert.strictEqual(host.getSnapshot(), view, 'Host missed the notification')
  assert.equal(notifications, 0)
  await rejects(host.callbacks.onConfirm(id), 'CONTEXT_CHANGED')
  assert.equal(writes, 0)
  assert.strictEqual(runtime.getSnapshot(), changed, 'confirmation makes no additional write')
  if (reenter) {
    assert.equal(host.getSnapshot().phase, 'REQUESTING')
    assert.equal(nextRequest.signal.aborted, false)
    deferred.resolve(mockAddOptionalField(nextRequest)); await nextPromise
    assert.equal(host.getSnapshot().phase, 'PREVIEW')
    assert.notEqual(host.getSnapshot().preview.planId, id)
  } else {
    assert.equal(host.getSnapshot().phase, 'STALE')
    assert.equal(host.getSnapshot().preview, null)
    assert.equal(host.getSnapshot().error.code, 'CONTEXT_CHANGED')
    assert.equal(host.getSnapshot().busy, false)
  }
  const final = host.getSnapshot()
  await rejects(host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  assert.strictEqual(host.getSnapshot(), final)
  host.dispose()
})

test('revision changed by a CONFIRMING observer with missed notification also terminates the preview', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const withoutNotification = notificationGate(runtime)
  const host = createMochiHost(runtime, mockAddOptionalField)
  host.setSelection('registration-form')
  const id = await plan(host)
  let changed
  host.subscribe(() => {
    if (host.getSnapshot().phase === 'CONFIRMING') {
      assert.equal(withoutNotification(() => runtime.moveBlock('applicant-list', { x: 0.2, y: 0.4 })).ok, true)
      changed = runtime.getSnapshot()
    }
  })
  await rejects(host.callbacks.onConfirm(id), 'CONTEXT_CHANGED')
  assert.equal(changed.revision, 1)
  assert.strictEqual(runtime.getSnapshot(), changed)
  assert.equal(host.getSnapshot().phase, 'STALE')
  assert.equal(host.getSnapshot().preview, null)
  assert.equal(host.getSnapshot().error.code, 'CONTEXT_CHANGED')
  await rejects(host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  host.dispose()
})

for (const restore of [false, true]) test(`missed authorization notification retires in-flight response${restore ? ' after regrant' : ''}`, async () => {
  const runtime = createAppRuntime(createClubRegistrationExample()), withoutNotification = notificationGate(runtime)
  const response = defer()
  let request
  const host = createMochiHost(runtime, input => { request = input; return response.promise })
  host.setSelection('registration-form')
  const before = runtime.customProject.getSnapshot(), pending = host.callbacks.onRequestPlan('old authorization')
  withoutNotification(() => { runtime.customProject.setReadOnly(true); if (restore) runtime.customProject.setReadOnly(false) })
  response.resolve(mockAddOptionalField(request))
  await rejects(pending, 'CONTEXT_CHANGED')
  assert.equal(host.getSnapshot().phase, 'STALE')
  assert.equal(host.getSnapshot().preview, null); assert.equal(host.getSnapshot().busy, false)
  assert.equal(request.signal.aborted, true)
  assert.strictEqual(runtime.customProject.getSnapshot(), before)
  host.dispose()
})

for (const duringConfirm of [false, true]) test(`missed authorization generation cannot commit${duringConfirm ? ' from CONFIRMING observer' : ' an old preview'}`, async () => {
  const runtime = createAppRuntime(createClubRegistrationExample()), withoutNotification = notificationGate(runtime)
  const host = createMochiHost(runtime, mockAddOptionalField)
  host.setSelection('registration-form')
  const id = await plan(host), before = runtime.customProject.getSnapshot()
  let writes = 0
  const execute = runtime.executeCommand
  runtime.executeCommand = (...args) => { writes++; return execute(...args) }
  const revoke = () => withoutNotification(() => { runtime.customProject.setReadOnly(true); runtime.customProject.setReadOnly(false) })
  if (duringConfirm) host.subscribe(() => { if (host.getSnapshot().phase === 'CONFIRMING') revoke() })
  else revoke()
  await rejects(host.callbacks.onConfirm(id), 'CONTEXT_CHANGED')
  assert.equal(writes, 0)
  assert.equal(host.getSnapshot().phase, 'STALE'); assert.equal(host.getSnapshot().preview, null)
  assert.strictEqual(runtime.customProject.getSnapshot(), before)
  await rejects(host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
  host.dispose()
})

test('observed authorization revocation while CONFIRMING prevents writes', async () => {
  const s = setup(), id = await plan(s.host), before = s.runtime.customProject.getSnapshot()
  s.host.subscribe(() => { if (s.host.getSnapshot().phase === 'CONFIRMING') s.runtime.customProject.setReadOnly(true) })
  await rejects(s.host.callbacks.onConfirm(id), 'CONTEXT_CHANGED')
  assert.equal(s.executions(), 0); assert.strictEqual(s.runtime.customProject.getSnapshot(), before)
  assert.equal(s.host.getSnapshot().phase, 'STALE'); assert.equal(s.host.getSnapshot().preview, null)
  s.host.dispose()
})

test('production owner isolates throwing observers and preserves a known successful receipt', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  runtime.subscribe(() => { throw new Error('early observer cannot hide successful publication') })
  const host = createMochiHost(runtime, mockAddOptionalField)
  host.setSelection('registration-form')
  const id = await plan(host)
  runtime.subscribe(() => { throw new Error('late observer cannot hide successful publication') })
  await host.callbacks.onConfirm(id)
  assert.equal(host.getSnapshot().phase, 'APPLIED')
  assert.equal(host.getSnapshot().receipt.committedRevision, runtime.getSnapshot().revision)
  await host.callbacks.onConfirm(id)
  assert.equal(runtime.getSnapshot().revision, 1)
  host.dispose()
})

test('readonly request never reaches provider or changes the sole owner', async () => {
  let calls = 0
  const s = setup(() => { calls++ }), owner = s.runtime.customProject, before = owner.getSnapshot()
  owner.setReadOnly(true)
  await rejects(plan(s.host), 'READ_ONLY')
  assert.equal(calls, 0); assert.equal(s.executions(), 0)
  assert.strictEqual(s.runtime.customProject, owner); assert.strictEqual(owner.getSnapshot(), before)
  s.host.dispose()
})

test('missed revision notification rejects the in-flight provider response', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample()), withoutNotification = notificationGate(runtime)
  const response = defer()
  let request
  const host = createMochiHost(runtime, input => { request = input; return response.promise })
  host.setSelection('registration-form')
  const pending = host.callbacks.onRequestPlan('stale response')
  withoutNotification(() => runtime.moveBlock('applicant-list', { x: .7, y: .6 }))
  const changed = runtime.customProject.getSnapshot()
  response.resolve(mockAddOptionalField(request))
  await rejects(pending, 'CONTEXT_CHANGED')
  assert.equal(host.getSnapshot().phase, 'STALE'); assert.equal(host.getSnapshot().preview, null)
  assert.strictEqual(runtime.customProject.getSnapshot(), changed)
  host.dispose()
})

test('a missed context change while publishing REQUESTING never reaches provider', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample()), withoutNotification = notificationGate(runtime)
  let calls = 0
  const host = createMochiHost(runtime, input => { calls++; return mockAddOptionalField(input) })
  host.setSelection('registration-form')
  host.subscribe(() => {
    if (host.getSnapshot().phase === 'REQUESTING') withoutNotification(() => runtime.customProject.setReadOnly(true))
  })
  const before = runtime.customProject.getSnapshot()
  await rejects(host.callbacks.onRequestPlan('revoked before provider'), 'CONTEXT_CHANGED')
  assert.equal(calls, 0); assert.equal(host.getSnapshot().busy, false)
  assert.equal(host.getSnapshot().phase, 'STALE'); assert.equal(host.getSnapshot().preview, null)
  assert.strictEqual(runtime.customProject.getSnapshot(), before)
  host.dispose()
})
