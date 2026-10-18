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
const { createAppRuntime } = require('../../model/appRuntime.ts')
const { createClubRegistrationExample, createReadingLogExample } = require('../../model/appSpecExamples.ts')
const { AppRenderer } = require('../../components/app-renderer/AppRenderer.tsx')
const { AppSpecCanvas } = require('../../components/app-builder/AppSpecCanvas.tsx')
function setup(provider = mockAddOptionalField, initial = createClubRegistrationExample()) {
  const runtime = createAppRuntime(initial)
  let executions = 0, updates = 0
  const execute = runtime.executeCommand
  runtime.executeCommand = request => { executions++; return execute(request) }
  runtime.subscribe(() => updates++)
  const host = createMochiHost(runtime, provider)
  host.setSelection(initial.spec.blocks[0].id)
  return { runtime, host, executions: () => executions, updates: () => updates }
}
async function plan(host) { await host.callbacks.onRequestPlan('这是固定 Mock，不解析这句话'); return host.getSnapshot().preview.planId }
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code)
function defer() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

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

test('B/C mode changes revoke pending plans and reject late responses', async () => {
  const deferred = defer()
  let request
  const s = setup(req => { request = req; return deferred.promise })
  const inflight = s.host.callbacks.onRequestPlan('mock')
  await rejects(s.host.callbacks.onRequestPlan('double submit'), 'REQUEST_BUSY')
  s.host.setMode('run')
  assert.ok(request.signal.aborted)
  deferred.resolve(mockAddOptionalField(request))
  await rejects(inflight, 'CONTEXT_CHANGED')
  assert.equal(s.host.getSnapshot().preview, null); assert.equal(s.host.getSnapshot().error, null)
  s.host.setMode('blocks')
  assert.equal(s.runtime.getSnapshot().revision, 0)
  const other = setup(), id = await plan(other.host)
  other.host.setMode('run'); other.host.setMode('blocks')
  await rejects(other.host.callbacks.onConfirm(id), 'PLAN_NOT_PENDING')
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
  assert.equal(s.host.getSnapshot().receipt.committedRevision, 1)
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
