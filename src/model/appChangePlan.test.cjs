'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { createAppChangePlanner, resolveBlockEntityId, AI_CHANGE_COMMANDS } = require('./appChangePlan.ts')
const { APP_CAPABILITIES, getAppCapability, getBlockCapabilityId } = require('./appCapabilities.ts')
const { createAppRuntime, metricValue } = require('./appRuntime.ts')
const { createClubRegistrationExample, createReadingLogExample } = require('./appSpecExamples.ts')

const addContact = { type: 'addField', entityId: 'applicants', field: { id: 'contact', name: '联系方式', type: 'text', required: false } }
const showContact = blockId => ({ type: 'configureBlockFields', blockId, fieldIds: ['applicant-name', 'department', 'contact'] })
const removeList = { type: 'removeBlock', blockId: 'applicant-list' }
function setup(initial = createClubRegistrationExample()) {
  const runtime = createAppRuntime(initial)
  const planner = createAppChangePlanner(runtime)
  const scope = { selectedBlockId: initial.spec.blocks[0].id, allowedBlockIds: initial.spec.blocks.map(b => b.id), allowedEntityIds: initial.spec.entities.map(e => e.id) }
  let notifications = 0
  runtime.subscribe(() => notifications++)
  const preview = (commands, options = {}) => planner.preview({ request: { requestId: 'ai-change-1', baseRevision: runtime.getSnapshot().revision, commands }, capabilityIds: [], ...options }, scope)
  return { runtime, planner, scope, preview, notifications: () => notifications }
}
function planOf(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.plan }
function rejected(result, code) {
  assert.equal(result.ok, false)
  if (code) assert.equal(result.error.code, code, result.error.message)
}
function newBlock(block, entityId = 'applicants') {
  return { type: 'addBlock', block, binding: { id: `${block.id}-binding`, type: 'dataBinding', blockId: block.id, entityId }, position: { x: 0.25, y: 0.5 } }
}

test('contact field and form/list display change are previewed in isolation and committed atomically once', () => {
  const app = setup()
  const before = app.runtime.getSnapshot()
  const plan = planOf(app.preview([addContact, showContact('registration-form'), showContact('applicant-list')]))
  assert.strictEqual(app.runtime.getSnapshot(), before)
  assert.equal(app.notifications(), 0)
  assert.equal(app.runtime.canUndo(), false)
  assert.equal(plan.after.revision, 1)
  assert.deepEqual(plan.diff.addedFields, [{ entityId: 'applicants', field: addContact.field }])
  assert.deepEqual(plan.diff.blockFieldChanges.map(item => item.blockId), ['registration-form', 'applicant-list'])
  assert.deepEqual(new Set(plan.diff.affectedBlockIds), new Set(['registration-form', 'applicant-list', 'applicant-total']))
  assert.deepEqual(plan.diff.affectedEntityIds, ['applicants'])
  assert.equal(plan.diff.sharedEntityImpacts[0].retainedRecordCount, 1)
  assert.deepEqual(plan.after.records, before.records)
  assert.deepEqual(app.planner.confirm(plan), { ok: true, duplicate: false, committedRevision: 1 })
  assert.equal(app.runtime.getSnapshot().revision, 1)
  assert.equal(app.notifications(), 1)
  assert.equal(app.runtime.canUndo(), true)
  assert.deepEqual(app.runtime.getSnapshot(), plan.after)
  // Existing command history sees one transaction, not three partial changes.
  assert.equal(app.runtime.executeCommand({ requestId: 'undo-contact', baseRevision: 1, commands: [{ type: 'undo' }] }).ok, true)
  assert.deepEqual(app.runtime.getSnapshot().spec, before.spec)
  assert.deepEqual(app.runtime.getSnapshot().records, before.records)
})

test('existing list and metric primitive capabilities add working blocks on the same entity', () => {
  const app = setup()
  const commands = [newBlock({ id: 'contact-list', name: '新名单', type: 'list', fieldIds: ['applicant-name'] }), newBlock({ id: 'new-total', name: '记录数', type: 'metric', aggregation: 'count' })]
  const plan = planOf(app.preview(commands, { capabilityIds: ['registration-management'] }))
  assert.deepEqual(plan.diff.addedBlocks, commands.map(command => command.block))
  assert.deepEqual(new Set(plan.diff.affectedEntityIds), new Set(['applicants']))
  assert.equal(app.planner.confirm(plan).ok, true)
  const after = app.runtime.getSnapshot()
  assert.equal(resolveBlockEntityId(after, 'contact-list'), 'applicants')
  assert.deepEqual(after.blockPositions['contact-list'], { x: 0.25, y: 0.5 })
  assert.equal(metricValue(after, commands[1].block), 1)
  assert.equal(app.runtime.updateRecords({ type: 'delete', entityId: 'applicants', recordId: 'applicant-001' }).ok, true)
  assert.equal(metricValue(app.runtime.getSnapshot(), commands[1].block), 0)
})

test('numeric aggregation adds a running sum and average using existing number field', () => {
  const app = setup(createReadingLogExample())
  const blocks = ['sum', 'average'].map(aggregation => ({ id: `minutes-${aggregation}`, name: aggregation, type: 'metric', aggregation, fieldId: 'minutes' }))
  const plan = planOf(app.preview(blocks.map(block => newBlock(block, 'reading-sessions')), { capabilityIds: ['metric-sum', 'metric-average'] }))
  assert.equal(app.planner.confirm(plan).ok, true)
  blocks.forEach(block => assert.equal(metricValue(app.runtime.getSnapshot(), block), 30))
})

test('removeBlock removes binding and layout while retaining entity schema and all records', () => {
  const initial = createClubRegistrationExample()
  initial.blockPositions['applicant-list'] = { x: 0.4, y: 0.2 }
  const app = setup(initial)
  const plan = planOf(app.preview([removeList]))
  assert.deepEqual(plan.diff.removedBlocks.map(b => b.id), ['applicant-list'])
  assert.equal(plan.diff.recordsPreserved, true)
  assert.equal(app.planner.confirm(plan).ok, true)
  const after = app.runtime.getSnapshot()
  assert.deepEqual(after.records, initial.records)
  assert.deepEqual(after.spec.entities, initial.spec.entities)
  assert.equal(after.spec.relations.some(r => r.blockId === 'applicant-list'), false)
  assert.equal(after.blockPositions['applicant-list'], undefined)
})

test('cancel is idempotent and permanently prevents confirmation with zero live mutation', () => {
  const app = setup()
  const before = app.runtime.getSnapshot()
  const plan = planOf(app.preview([removeList]))
  assert.deepEqual(app.planner.cancel(plan), { ok: true })
  assert.deepEqual(app.planner.cancel(plan), { ok: true })
  rejected(app.planner.confirm(plan), 'PLAN_NOT_PENDING')
  assert.equal(app.planner.getStatus(plan), 'cancelled')
  rejected(app.preview([removeList]), 'PLAN_NOT_PENDING')
  assert.strictEqual(app.runtime.getSnapshot(), before)
  assert.equal(app.notifications(), 0)
  assert.equal(app.runtime.canUndo(), false)
})

test('confirmation submits the exact deeply frozen request and cannot be changed by caller mutation', () => {
  const app = setup()
  const candidate = { request: { requestId: 'immutable', baseRevision: 0, commands: [structuredClone(addContact)] }, capabilityIds: [] }
  const plan = planOf(app.planner.preview(candidate, app.scope))
  candidate.request.commands[0].field.name = 'changed outside'
  candidate.request.commands.push(removeList)
  app.scope.allowedBlockIds.length = 0
  assert.equal(plan.request.commands.length, 1)
  assert.equal(plan.request.commands[0].field.name, '联系方式')
  assert.throws(() => { plan.request.baseRevision = 99 }, TypeError)
  assert.throws(() => { plan.request.commands[0].field.name = 'tampered' }, TypeError)
  assert.throws(() => { plan.after.records.applicants.length = 0 }, TypeError)
  assert.throws(() => { plan.diff.sharedEntityImpacts[0].boundBlockIds.push('tampered') }, TypeError)
  const originalExecute = app.runtime.executeCommand
  let submitted
  app.runtime.executeCommand = request => { submitted = request; return originalExecute(request) }
  assert.equal(app.planner.confirm(plan).ok, true)
  assert.strictEqual(submitted, plan.request)
  assert.equal(app.runtime.getSnapshot().spec.blocks.length, 3)
})

test('same request is deduplicated; changed request or scope with same ID is rejected', () => {
  const app = setup()
  const plan = planOf(app.preview([addContact]))
  assert.strictEqual(planOf(app.preview([addContact])), plan)
  rejected(app.preview([removeList]), 'REQUEST_ID_CONFLICT')
  const candidate = { request: plan.request, capabilityIds: [] }
  rejected(app.planner.preview(candidate, { ...app.scope, selectedBlockId: null, allowedBlockIds: [] }), 'REQUEST_ID_CONFLICT')
  assert.equal(app.planner.confirm(plan).ok, true)
  assert.deepEqual(app.planner.confirm(plan), { ok: true, duplicate: true, committedRevision: 1 })
  assert.equal(app.runtime.moveBlock('applicant-list', { x: 0.3, y: 0.7 }).ok, true)
  const afterMove = app.runtime.getSnapshot()
  assert.deepEqual(app.planner.confirm(plan), { ok: true, duplicate: true, committedRevision: 1 })
  assert.strictEqual(app.runtime.getSnapshot(), afterMove)
  assert.equal(app.notifications(), 2)
  rejected(app.planner.cancel(plan), 'PLAN_NOT_PENDING')
})

test('Runtime receipts also prevent reusing an ID consumed outside the planner', () => {
  const app = setup()
  assert.equal(app.runtime.executeCommand({ requestId: 'ai-change-1', baseRevision: 0, commands: [removeList] }).ok, true)
  app.scope.allowedBlockIds = app.runtime.getSnapshot().spec.blocks.map(block => block.id)
  const before = app.runtime.getSnapshot()
  const plan = planOf(app.preview([addContact]))
  rejected(app.planner.confirm(plan), 'REQUEST_ID_CONFLICT')
  assert.equal(app.planner.getStatus(plan), 'rejected')
  assert.strictEqual(app.runtime.getSnapshot(), before)
})

test('shared schema impact includes siblings outside direct block permission', () => {
  const app = setup()
  app.scope.allowedBlockIds = ['registration-form']
  const plan = planOf(app.preview([addContact]))
  const impact = plan.diff.sharedEntityImpacts[0]
  assert.deepEqual(impact.boundBlockIds, ['registration-form', 'applicant-list', 'applicant-total'])
  assert.deepEqual(impact.outsideDirectScopeBlockIds, ['applicant-list', 'applicant-total'])
  rejected(app.preview([showContact('applicant-list')]), 'SCOPE_VIOLATION')
  assert.equal(app.notifications(), 0)
})

test('entity and direct block permissions are both required; model cannot grant itself scope', () => {
  const app = setup(createReadingLogExample())
  app.scope.allowedEntityIds = ['books']
  app.scope.allowedBlockIds = ['bookshelf']
  for (const commands of [
    [{ type: 'addField', entityId: 'reading-sessions', field: { id: 'secret', name: 'secret', type: 'text', required: false } }],
    [{ type: 'removeBlock', blockId: 'reading-form' }],
    [newBlock({ id: 'stolen-total', name: 'stolen', type: 'metric', aggregation: 'count' }, 'reading-sessions')],
  ]) rejected(app.preview(commands, { capabilityIds: ['metric-count'] }), 'SCOPE_VIOLATION')
  rejected(app.preview([removeList], { allowedEntityIds: ['applicants'] }))
  const candidate = { request: { requestId: 'scope', baseRevision: 0, commands: [{ type: 'removeBlock', blockId: 'bookshelf' }] }, capabilityIds: [] }
  rejected(app.planner.preview(candidate, { ...app.scope, selectedBlockId: 'reading-form' }))
  rejected(app.planner.preview(candidate, { ...app.scope, allowedEntityIds: ['missing'] }))
  assert.equal(app.notifications(), 0)
})

test('four-command allowlist rejects updateField/removeField/undo and unknown commands atomically', () => {
  assert.deepEqual([...AI_CHANGE_COMMANDS], ['addField', 'configureBlockFields', 'addBlock', 'removeBlock'])
  const app = setup()
  const before = app.runtime.getSnapshot()
  for (const command of [
    { type: 'updateField', entityId: 'applicants', fieldId: 'applicant-name', field: { id: 'applicant-name', name: 'rename', type: 'text', required: true } },
    { type: 'removeField', entityId: 'applicants', fieldId: 'available' },
    { type: 'undo' },
    { type: 'executeJavaScript', code: 'alert(1)' },
  ]) {
    // Undo must be standalone even in the general protocol; the others follow a valid first command.
    rejected(app.preview(command.type === 'undo' ? [command] : [addContact, command]))
    assert.strictEqual(app.runtime.getSnapshot(), before)
  }
  rejected(app.preview([{ type: 'undo' }]), 'AI_COMMAND_FORBIDDEN')
  assert.equal(app.notifications(), 0)
})

test('invalid fields, references, required backfill and metric configuration reject the whole batch', () => {
  const app = setup()
  const before = app.runtime.getSnapshot()
  for (const tail of [
    { ...addContact, field: { ...addContact.field, type: 'email' } },
    { ...addContact, field: { ...addContact.field, id: 'department' } },
    { ...addContact, field: { ...addContact.field, required: true } },
    { ...addContact, field: { ...addContact.field, type: 'select', options: [] } },
    { type: 'configureBlockFields', blockId: 'registration-form', fieldIds: ['available'] },
    { type: 'configureBlockFields', blockId: 'applicant-list', fieldIds: ['not-a-field'] },
    { type: 'configureBlockFields', blockId: 'applicant-total', fieldIds: ['department'] },
    newBlock({ id: 'bad-sum', name: 'bad', type: 'metric', aggregation: 'sum', fieldId: 'department' }),
  ]) {
    const prefix = { ...addContact, field: { ...addContact.field, id: 'prefix-note', name: 'valid prefix' } }
    rejected(app.preview([prefix, tail], { capabilityIds: ['metric-sum'] }))
    assert.strictEqual(app.runtime.getSnapshot(), before)
  }
  assert.equal(app.notifications(), 0)
  assert.equal(app.runtime.canUndo(), false)
})

test('cross-entity references, nonunique bindings, duplicate IDs and transient replacement are rejected', () => {
  const app = setup(createReadingLogExample())
  for (const commands of [
    [{ type: 'configureBlockFields', blockId: 'bookshelf', fieldIds: ['minutes'] }],
    [newBlock({ id: 'other-list', name: 'other', type: 'list', fieldIds: ['minutes'] }, 'books')],
    [newBlock({ id: 'bookshelf', name: 'collision', type: 'list', fieldIds: ['book-title'] }, 'books')],
    [{ type: 'removeBlock', blockId: 'bookshelf' }, newBlock({ id: 'bookshelf', name: 'replace', type: 'list', fieldIds: ['book-title'] }, 'books')],
    [{ type: 'removeBlock', blockId: 'bookshelf' }, { type: 'removeBlock', blockId: 'bookshelf' }],
    [newBlock({ id: 'transient', name: 'temp', type: 'list', fieldIds: ['book-title'] }, 'books'), { type: 'removeBlock', blockId: 'transient' }],
    [{ ...newBlock({ id: 'bad-binding', name: 'bad', type: 'list', fieldIds: ['book-title'] }, 'books'), binding: { id: 'binding-x', type: 'dataBinding', blockId: 'bookshelf', entityId: 'books' } }],
  ]) rejected(app.preview(commands, { capabilityIds: ['list'] }))
  const invalid = createReadingLogExample()
  invalid.spec.relations.push({ id: 'extra-binding', type: 'dataBinding', blockId: 'bookshelf', entityId: 'reading-sessions' })
  assert.throws(() => resolveBlockEntityId(invalid, 'bookshelf'), /one valid entity binding/)
  assert.throws(() => resolveBlockEntityId(invalid, 'missing'), /Unknown block/)
  const unsafeRuntime = { ...app.runtime, getSnapshot: () => invalid }
  rejected(createAppChangePlanner(unsafeRuntime).preview({ request: { requestId: 'invalid-state', baseRevision: 0, commands: [{ type: 'removeBlock', blockId: 'bookshelf' }] }, capabilityIds: [] }, app.scope))
  assert.equal(app.notifications(), 0)
})

test('strict JSON input rejects scripts, hidden code, getters, prototypes, cycles and non-JSON values', () => {
  const app = setup()
  let getterCalls = 0
  const getterField = { ...addContact.field }
  Object.defineProperty(getterField, 'name', { enumerable: true, get() { getterCalls++; return 'executed' } })
  const cyclic = { ...addContact }; cyclic.field = cyclic
  for (const command of [
    { ...addContact, script: 'alert(1)' },
    { ...addContact, field: { ...addContact.field, name: '<script>alert(1)</script>' } },
    { ...addContact, field: { ...addContact.field, name: 'javascript:alert(1)' } },
    { ...addContact, field: { ...addContact.field, name: '() => window.alert(1)' } },
    { ...addContact, field: { ...addContact.field, onChange: () => {} } },
    { ...addContact, field: getterField },
    { ...addContact, field: Object.assign(Object.create({ inherited: true }), addContact.field) },
    { ...addContact, field: { ...addContact.field, id: 'constructor' } },
    { ...addContact, field: { ...addContact.field, required: undefined } },
    cyclic,
  ]) rejected(app.preview([command]))
  assert.equal(getterCalls, 0)
  for (const request of [
    { requestId: 'bad id', baseRevision: 0, commands: [addContact] },
    { requestId: 'negative', baseRevision: -1, commands: [addContact] },
    { requestId: 'fraction', baseRevision: 0.5, commands: [addContact] },
    { requestId: 'empty', baseRevision: 0, commands: [] },
    { requestId: 'code', baseRevision: 0, commands: [addContact], code: 'alert(1)' },
  ]) rejected(app.planner.preview({ request, capabilityIds: [] }, app.scope))
  assert.equal(app.notifications(), 0)
})

test('stale preview and later record/layout/structural revisions reject without rebasing', () => {
  for (const mutate of [
    runtime => runtime.updateRecords({ type: 'update', entityId: 'applicants', recordId: 'applicant-001', values: { 'applicant-name': 'updated', department: '技术部' } }),
    runtime => runtime.moveBlock('applicant-list', { x: 0.2, y: 0.3 }),
    runtime => runtime.executeCommand({ requestId: 'other-editor', baseRevision: 0, commands: [removeList] }),
  ]) {
    const app = setup()
    const plan = planOf(app.preview([addContact]))
    assert.equal(mutate(app.runtime).ok, true)
    const changed = app.runtime.getSnapshot()
    rejected(app.planner.confirm(plan), 'REVISION_CONFLICT')
    assert.equal(app.planner.getStatus(plan), 'stale')
    assert.strictEqual(app.runtime.getSnapshot(), changed)
    assert.equal(app.notifications(), 1)
    rejected(app.preview([addContact], { request: { requestId: 'stale-input', baseRevision: 0, commands: [addContact] } }), 'REVISION_CONFLICT')
    assert.equal(plan.request.baseRevision, 0)
  }
})

test('plan handles are bound to the exact planner and app instance, even with equal app IDs/revisions', () => {
  const one = setup(), two = setup()
  const plan = planOf(one.preview([addContact]))
  const otherPlan = planOf(two.preview([removeList]))
  assert.equal(plan.appId, otherPlan.appId)
  assert.equal(plan.request.baseRevision, otherPlan.request.baseRevision)
  rejected(two.planner.confirm(plan), 'PLAN_NOT_OWNED')
  rejected(two.planner.cancel(plan), 'PLAN_NOT_OWNED')
  assert.equal(two.planner.getStatus(plan), 'unknown')
  rejected(one.planner.confirm(structuredClone(plan)), 'PLAN_NOT_OWNED')
  rejected(one.planner.confirm({ ...plan }), 'PLAN_NOT_OWNED')
  rejected(createAppChangePlanner(one.runtime).confirm(plan), 'PLAN_NOT_OWNED')
  assert.equal(one.notifications(), 0)
  assert.equal(two.notifications(), 0)
  assert.equal(one.planner.confirm(plan).ok, true)
  assert.equal(two.runtime.getSnapshot().revision, 0)
})

test('capability catalog separates business composition and actual primitives and is deeply immutable', () => {
  assert.equal(new Set(APP_CAPABILITIES.map(item => item.id)).size, APP_CAPABILITIES.length)
  assert.deepEqual(APP_CAPABILITIES.filter(item => item.kind === 'primitive').map(item => item.id), ['form', 'list', 'metric-count', 'metric-sum', 'metric-average'])
  for (const item of APP_CAPABILITIES) {
    assert.ok(Object.isFrozen(item))
    if (item.kind === 'semantic' && item.status === 'supported') item.primitives.forEach(id => assert.equal(getAppCapability(id).kind, 'primitive'))
  }
  assert.equal(getBlockCapabilityId({ type: 'metric', aggregation: 'average' }), 'metric-average')
  assert.throws(() => { getAppCapability('workout-timer').status = 'supported' }, TypeError)
  assert.throws(() => { getAppCapability('workout-record-management').primitives.push('workout-timer') }, TypeError)
})

test('unsupported features and unknown declarations cannot create fake executable blocks', () => {
  const app = setup()
  const command = newBlock({ id: 'fake-feature', name: '待支持功能', type: 'list', fieldIds: ['applicant-name'] })
  const ids = ['workout-timer', 'calendar', 'automatic-workout-planning', 'completion-rate', 'checklist', 'unknown-feature']
  for (const id of ids) {
    const result = app.preview([command], { capabilityIds: ['list', id] })
    rejected(result, 'UNSUPPORTED_CAPABILITY')
    assert.equal(result.unsupportedOperations[0].capabilityId, id)
    assert.ok(result.unsupportedOperations[0].reason.length > 0)
    assert.equal('plan' in result, false)
  }
  rejected(app.preview([command]), 'UNSUPPORTED_CAPABILITY')
  rejected(app.preview([newBlock({ id: 'timer', name: 'Timer', type: 'timer' })], { capabilityIds: ['form'] }))
  rejected(app.preview([newBlock({ id: 'ratio', name: 'Ratio', type: 'metric', aggregation: 'completion-rate' })], { capabilityIds: ['metric-count'] }))
  assert.equal(app.notifications(), 0)
  assert.equal(app.runtime.getSnapshot().revision, 0)
})
