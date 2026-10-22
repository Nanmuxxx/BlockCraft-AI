// Uses the existing Node 24 native-test resolution pattern; no installed packages.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    for (const suffix of ['.ts', '/index.ts']) {
      const url = new URL(`${specifier}${suffix}`, context.parentURL)
      if (existsSync(fileURLToPath(url))) return next(url.href, context)
    }
  }
  return next(specifier, context)
} })
const { createAppRuntime } = await import('../../src/model/appRuntime.ts')
const { createClubRegistrationExample, createReadingLogExample } = await import('../../src/model/appSpecExamples.ts')
const { createAppChangePlanner, AI_CHANGE_COMMANDS } = await import('../../src/model/appChangePlan.ts')
const { createMochiHost } = await import('../../src/integrations/mochi/host.ts')
const { createModelPlanProvider } = await import('../../src/integrations/mochi/modelPlanProvider.ts')
const { unavailablePlanProvider } = await import('../../src/integrations/mochi/planning.ts')

const blockId = 'registration-form'
const candidate = (id, revision, target, patch) => ({ request: {
  requestId: id, baseRevision: revision, commands: [{ type: 'configureBlockPresentation', blockId: target, presentation: patch }],
}, capabilityIds: [] })
const answer = request => JSON.stringify(candidate(request.requestId, request.baseRevision, request.block.id, { buttonText: request.prompt }))
function setup(t, complete = ({ request }) => answer(request), options) {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const host = createMochiHost(runtime, createModelPlanProvider(complete, options))
  host.setSelection(blockId)
  t.after(() => host.dispose())
  return { runtime, host }
}
function capture(runtime) {
  return { snapshot: runtime.getSnapshot(), owner: runtime.customProject.getSnapshot(), json: JSON.stringify(runtime.getSnapshot()), undo: runtime.canUndo() }
}
function unchanged(runtime, before) {
  assert.strictEqual(runtime.getSnapshot(), before.snapshot)
  assert.strictEqual(runtime.customProject.getSnapshot(), before.owner)
  assert.equal(JSON.stringify(runtime.getSnapshot()), before.json)
  assert.equal(runtime.canUndo(), before.undo)
}
function applied(runtime, before, patch, increments = 1) {
  const expected = structuredClone(before.snapshot)
  expected.revision += increments
  const block = expected.spec.blocks.find(b => b.id === blockId)
  block.presentation = { ...block.presentation, ...patch }
  assert.deepEqual(runtime.getSnapshot(), expected) // includes records, other blocks and layout
  assert.equal(runtime.customProject.getSnapshot().revision, expected.revision)
}
async function preview(host, text = '已修改') {
  await host.callbacks.onRequestPlan(text)
  assert.equal(host.getSnapshot().phase, 'PREVIEW')
  return host.getSnapshot().preview.planId
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('two valid partial modifications increment exactly 0→1→2 and preserve full application data', async t => {
  let count = 0
  const { runtime, host } = setup(t, ({ request }) => JSON.stringify(candidate(request.requestId, request.baseRevision, request.block.id,
    ++count === 1 ? { buttonText: '第一次', backgroundColor: '#abcdef' } : { textColor: '#123456', borderRadius: 0 })))
  const before = capture(runtime)
  const first = await preview(host); unchanged(runtime, before)
  await host.callbacks.onConfirm(first)
  assert.equal(host.getSnapshot().receipt.committedRevision, 1)
  applied(runtime, before, { buttonText: '第一次', backgroundColor: '#abcdef' })
  const afterFirst = capture(runtime)
  const second = await preview(host); unchanged(runtime, afterFirst)
  await host.callbacks.onConfirm(second)
  assert.equal(host.getSnapshot().receipt.committedRevision, 2)
  applied(runtime, afterFirst, { textColor: '#123456', borderRadius: 0 })
  await host.callbacks.onConfirm(first) // duplicate is not an overwrite
  applied(runtime, before, { buttonText: '第一次', backgroundColor: '#abcdef', textColor: '#123456', borderRadius: 0 }, 2)
})

for (const winner of [0, 1]) test(`two independent planners at revision 0: plan ${winner} wins; stale plan cannot overwrite`, t => {
  const { runtime } = setup(t)
  const before = capture(runtime)
  const scope = { selectedBlockId: blockId, allowedBlockIds: [blockId], allowedEntityIds: ['applicants'] }
  const planners = [createAppChangePlanner(runtime), createAppChangePlanner(runtime)]
  const plans = planners.map((p, i) => {
    const result = p.preview(candidate(`parallel-${i}`, 0, blockId, { buttonText: `plan-${i}` }), scope)
    assert.equal(result.ok, true); return result.plan
  })
  unchanged(runtime, before)
  assert.deepEqual(planners[winner].confirm(plans[winner]), { ok: true, duplicate: false, committedRevision: 1 })
  const committed = capture(runtime)
  assert.equal(planners[1 - winner].confirm(plans[1 - winner]).error.code, 'REVISION_CONFLICT')
  unchanged(runtime, committed); applied(runtime, before, { buttonText: `plan-${winner}` })
})

for (const winner of [0, 1]) test(`real owner CAS: two candidates share expected snapshot; candidate ${winner} wins`, t => {
  const { runtime } = setup(t)
  const before = capture(runtime), owner = runtime.customProject
  const expected = owner.getSnapshot(), authorization = owner.getAuthorization()
  const candidates = [0, 1].map(i => {
    const next = structuredClone(expected)
    next.revision++
    next.base.spec.blocks.find(b => b.id === blockId).presentation = { buttonText: `owner-${i}` }
    return next
  })
  assert.deepEqual(owner.compareAndSwap(expected, candidates[winner], authorization), { ok: true, duplicate: false, committedRevision: 1 })
  const committed = capture(runtime)
  const rejected = owner.compareAndSwap(expected, candidates[1 - winner], authorization)
  assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'REVISION_CONFLICT')
  unchanged(runtime, committed); applied(runtime, before, { buttonText: `owner-${winner}` })
})

test('simultaneous Host confirmations commit once and invalidate the other preview', async t => {
  const { runtime, host } = setup(t)
  const other = createMochiHost(runtime, createModelPlanProvider(({ request }) => answer(request)))
  t.after(() => other.dispose()); other.setSelection(blockId)
  const before = capture(runtime)
  const [first, second] = await Promise.all([preview(host, 'winner'), preview(other, 'loser')])
  unchanged(runtime, before)
  const results = await Promise.allSettled([host.callbacks.onConfirm(first), other.callbacks.onConfirm(second)])
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected'])
  assert.equal(results[1].reason.code, 'PLAN_NOT_PENDING')
  applied(runtime, before, { buttonText: 'winner' })
})

for (const kind of ['selection', 'cancel', 'authorization', 'dispose']) {
  for (const late of ['resolve', 'reject']) test(`${kind} invalidates pending request; late Provider ${late} cannot mutate or publish`, async t => {
    const pending = deferred(); let input, signal
    const { runtime, host } = setup(t, args => { input = args.request; signal = args.signal; return pending.promise })
    const before = capture(runtime), request = host.callbacks.onRequestPlan('obsolete')
    const rejected = assert.rejects(request, e => e.code === 'CONTEXT_CHANGED')
    if (kind === 'selection') host.setSelection('applicant-list')
    if (kind === 'cancel') host.cancelRequest(host.getSnapshot().requestId)
    if (kind === 'authorization') { runtime.customProject.setReadOnly(true); runtime.customProject.setReadOnly(false) }
    if (kind === 'dispose') host.dispose()
    await rejected
    assert.equal(signal.aborted, true)
    const retired = host.getSnapshot()
    if (late === 'resolve') pending.resolve(answer(input)); else pending.reject(new Error('late failure'))
    await flush()
    assert.strictEqual(host.getSnapshot(), retired)
    unchanged(runtime, before)
  })
}

test('project handoff retires old Host; late old result cannot affect either project', async t => {
  const pending = deferred(); let oldInput
  const old = setup(t, ({ request }) => { oldInput = request; return pending.promise })
  const oldBefore = capture(old.runtime)
  const rejected = assert.rejects(old.host.callbacks.onRequestPlan('old project'), e => e.code === 'CONTEXT_CHANGED')
  old.host.dispose() // explicit host lifecycle seam; no Workshop UI simulated
  const nextRuntime = createAppRuntime(createReadingLogExample())
  const nextBlock = nextRuntime.getSnapshot().spec.blocks.find(b => b.type === 'form')
  const nextHost = createMochiHost(nextRuntime, createModelPlanProvider(({ request }) => answer(request)))
  t.after(() => nextHost.dispose()); nextHost.setSelection(nextBlock.id)
  const nextBefore = capture(nextRuntime)
  await nextHost.callbacks.onConfirm(await preview(nextHost, 'new project'))
  const expected = structuredClone(nextBefore.snapshot)
  expected.revision++; expected.spec.blocks.find(b => b.id === nextBlock.id).presentation = { buttonText: 'new project' }
  assert.deepEqual(nextRuntime.getSnapshot(), expected)
  const committed = capture(nextRuntime)
  await rejected; pending.resolve(answer(oldInput)); await flush()
  unchanged(old.runtime, oldBefore); unchanged(nextRuntime, committed)
})

test('foreign project planId rejected even when appId and selected block IDs match', async t => {
  const first = setup(t), second = setup(t)
  const planId = await preview(first.host), a = capture(first.runtime), b = capture(second.runtime)
  await assert.rejects(second.host.callbacks.onConfirm(planId), e => e.code === 'PLAN_NOT_OWNED')
  unchanged(first.runtime, a); unchanged(second.runtime, b)
})

test('superseding request commits newer plan; late valid old response cannot overwrite it', async t => {
  const pending = deferred(); let firstInput, calls = 0
  const { runtime, host } = setup(t, ({ request }) => ++calls === 1 ? (firstInput = request, pending.promise) : answer(request))
  const before = capture(runtime)
  const first = assert.rejects(host.callbacks.onRequestPlan('old'), e => e.code === 'CONTEXT_CHANGED')
  const newer = await preview(host, 'new')
  await first; await host.callbacks.onConfirm(newer)
  const committed = capture(runtime)
  pending.resolve(answer(firstInput)); await flush()
  unchanged(runtime, committed); applied(runtime, before, { buttonText: 'new' })
  assert.equal(host.getSnapshot().phase, 'APPLIED')
})

const invalidPatches = [
  ['short hex', { backgroundColor: '#fff' }], ['CSS URL', { backgroundColor: 'url(https://example.invalid)' }],
  ['named color', { textColor: 'red' }], ['null color', { textColor: null }],
  ['negative radius', { borderRadius: -1 }], ['large radius', { borderRadius: 33 }],
  ['fractional radius', { borderRadius: 0.5 }], ['string radius', { borderRadius: '12' }],
  ['long text', { buttonText: '字'.repeat(121) }], ['blank text', { buttonText: '  ' }],
  ['unknown property', { fontSize: 24 }], ['executable property', { onClick: 'alert(1)' }], ['empty patch', {}],
]
for (const [name, patch] of invalidPatches) test(`invalid ${name} is rejected before mutation`, async t => {
  const { runtime, host } = setup(t, ({ request }) => JSON.stringify(candidate(request.requestId, request.baseRevision, request.block.id, patch)))
  const before = capture(runtime)
  await assert.rejects(preview(host), e => e.code === 'VALIDATION')
  assert.equal(host.getSnapshot().phase, 'PREVIEW_REJECTED')
  unchanged(runtime, before)
})

for (const radius of [0, 32]) test(`legal Mock response accepts radius ${radius}, 120-character text, and hex colors`, async t => {
  const patch = { buttonText: '字'.repeat(120), backgroundColor: '#ABCDEF', textColor: '#012345', borderRadius: radius }
  const { runtime, host } = setup(t, ({ request }) => JSON.stringify(candidate(request.requestId, request.baseRevision, request.block.id, patch)))
  const before = capture(runtime), id = await preview(host)
  unchanged(runtime, before); await host.callbacks.onConfirm(id)
  assert.equal(host.getSnapshot().phase, 'APPLIED'); applied(runtime, before, patch)
})

const badResponses = [
  ['invalid JSON', () => '{', 'INVALID_MODEL_RESPONSE', 'REQUEST_FAILED'],
  ['non-string', () => 42, 'INVALID_MODEL_RESPONSE', 'REQUEST_FAILED'],
  ['oversized', () => 'x'.repeat(65537), 'INVALID_MODEL_RESPONSE', 'REQUEST_FAILED'],
  ['null JSON', () => 'null', 'VALIDATION', 'PREVIEW_REJECTED'],
  ['extra property', ({ request }) => JSON.stringify({ ...JSON.parse(answer(request)), authority: 'all' }), 'VALIDATION', 'PREVIEW_REJECTED'],
  ['wrong binding', ({ request }) => JSON.stringify(candidate('different-request', request.baseRevision, request.block.id, { buttonText: 'x' })), 'PLAN_BINDING_MISMATCH', 'PREVIEW_REJECTED'],
  ['stale revision', ({ request }) => JSON.stringify(candidate(request.requestId, 99, request.block.id, { buttonText: 'x' })), 'REVISION_CONFLICT', 'PREVIEW_REJECTED'],
  ['forbidden command', ({ request }) => JSON.stringify({ request: { requestId: request.requestId, baseRevision: request.baseRevision, commands: [{ type: 'undo' }] }, capabilityIds: [] }), 'AI_COMMAND_FORBIDDEN', 'PREVIEW_REJECTED'],
  ['throw', () => { throw new Error('offline provider failure') }, 'PLAN_PROVIDER_FAILED', 'REQUEST_FAILED'],
  ['reject', () => Promise.reject(new Error('offline provider rejection')), 'PLAN_PROVIDER_FAILED', 'REQUEST_FAILED'],
]
for (const [name, complete, code, phase] of badResponses) test(`Provider ${name} returns ${code} and preserves complete Runtime`, async t => {
  const { runtime, host } = setup(t, complete), before = capture(runtime)
  await assert.rejects(preview(host), e => e.code === code)
  assert.equal(host.getSnapshot().phase, phase)
  assert.equal(host.getSnapshot().preview, null)
  unchanged(runtime, before)
})

test('Provider deadline aborts ignored transport; late completion cannot change state; retry succeeds', async t => {
  const pending = deferred(); let input, signal, calls = 0
  const { runtime, host } = setup(t, args => {
    calls++
    if (calls > 1) return answer(args.request)
    input = args.request; signal = args.signal; return pending.promise
  }, { timeoutMs: 5 })
  const before = capture(runtime)
  await assert.rejects(preview(host), e => e.code === 'MODEL_TIMEOUT')
  assert.equal(signal.aborted, true)
  assert.equal(host.getSnapshot().phase, 'REQUEST_FAILED'); unchanged(runtime, before)
  const failed = host.getSnapshot()
  pending.resolve(answer(input)); await flush()
  assert.strictEqual(host.getSnapshot(), failed); unchanged(runtime, before)
  await host.callbacks.onConfirm(await preview(host, 'retry'))
  applied(runtime, before, { buttonText: 'retry' })
})

test('real Runtime batch failure rolls back earlier valid command and does not reserve requestId/history', t => {
  const { runtime } = setup(t), before = capture(runtime)
  const request = candidate('retry-atomic', 0, blockId, { buttonText: 'staged' }).request
  request.commands.push({ type: 'configureBlockPresentation', blockId: 'applicant-list', presentation: { buttonText: 'invalid non-form' } })
  const failed = runtime.executeCommand(request)
  assert.equal(failed.ok, false); assert.equal(failed.error.code, 'VALIDATION'); unchanged(runtime, before)
  request.commands.pop()
  assert.deepEqual(runtime.executeCommand(request), { ok: true, duplicate: false, committedRevision: 1 })
  applied(runtime, before, { buttonText: 'staged' })
})

test('real Runtime rejects captured authorization after revoke/regrant with full state unchanged', t => {
  const { runtime } = setup(t), before = capture(runtime), authorization = runtime.customProject.getAuthorization()
  runtime.customProject.setReadOnly(true); runtime.customProject.setReadOnly(false)
  const result = runtime.executeCommand(candidate('auth-stale', 0, blockId, { buttonText: 'forbidden' }).request, authorization)
  assert.equal(result.ok, false); assert.equal(result.error.code, 'AUTHORIZATION_CHANGED'); unchanged(runtime, before)
})

test('Host failure from a real Runtime authorization check preserves state and permits fresh resubmission', async t => {
  const { runtime, host } = setup(t), foreign = createAppRuntime(createClubRegistrationExample())
  const execute = runtime.executeCommand.bind(runtime)
  // Failure injection passes a real foreign token into the original Runtime;
  // no return-value stub or bypass of owner checks.
  runtime.executeCommand = request => execute(request, foreign.customProject.getAuthorization())
  const before = capture(runtime), id = await preview(host)
  await assert.rejects(host.callbacks.onConfirm(id), e => e.code === 'AUTHORIZATION_CHANGED')
  assert.equal(host.getSnapshot().phase, 'COMMIT_FAILED'); unchanged(runtime, before)
  runtime.executeCommand = execute
  await host.callbacks.onConfirm(await preview(host, 'fresh'))
  applied(runtime, before, { buttonText: 'fresh' })
})

test('controlled editing: exact frozen command contract does not itself mutate application state', t => {
  const { runtime } = setup(t), before = capture(runtime)
  assert.deepEqual([...AI_CHANGE_COMMANDS], ['addField', 'configureBlockFields', 'configureBlockPresentation', 'configureGallery', 'addBlock', 'removeBlock', 'configureMetric', 'reorderBlocks'])
  assert.equal(Object.isFrozen(AI_CHANGE_COMMANDS), true)
  unchanged(runtime, before)
})

for (const [name, command, code] of [
  ['updateField', { type: 'updateField', entityId: 'applicants', fieldId: 'applicant-name', field: { id: 'applicant-name', name: 'forbidden', type: 'text', required: true } }, 'AI_COMMAND_FORBIDDEN'],
  ['removeField', { type: 'removeField', entityId: 'applicants', fieldId: 'applicant-name' }, 'AI_COMMAND_FORBIDDEN'],
  ['undo', { type: 'undo' }, 'AI_COMMAND_FORBIDDEN'],
  ['unknown', { type: 'executeJavaScript', code: 'alert(1)' }, 'VALIDATION'],
]) test(`PR49: ${name} stays forbidden despite presentation command membership`, t => {
  const { runtime } = setup(t), before = capture(runtime), planner = createAppChangePlanner(runtime)
  const input = candidate(`forbidden-${name}`, 0, blockId, { buttonText: 'must not publish' })
  input.request.commands = name === 'undo' ? [command] : [...input.request.commands, command]
  const result = planner.preview(input, { selectedBlockId: blockId, allowedBlockIds: [blockId], allowedEntityIds: ['applicants'] })
  assert.equal(result.ok, false); assert.equal(result.error.code, code)
  unchanged(runtime, before)
})

test('PR49: Preview alone has no execution authority; Confirm forwards captured authorization exactly once', async t => {
  const events = []
  const { runtime, host } = setup(t, ({ request }) => { events.push('provider'); return answer(request) })
  const before = capture(runtime), authorization = runtime.customProject.getAuthorization()
  const execute = runtime.executeCommand.bind(runtime)
  let executions = 0
  runtime.executeCommand = (request, captured) => {
    events.push('executeCommand'); executions++
    assert.strictEqual(captured, authorization)
    return execute(request, captured)
  }
  const unsubscribeHost = host.subscribe(() => events.push(host.getSnapshot().phase))
  const unsubscribeRuntime = runtime.subscribe(() => events.push('runtime'))
  t.after(() => { unsubscribeHost(); unsubscribeRuntime() })
  const id = await preview(host, 'confirmed only')
  assert.equal(executions, 0); assert.equal(host.getSnapshot().receipt, null)
  unchanged(runtime, before)
  await assert.rejects(host.callbacks.onConfirm(`${id}-forged`), e => e.code === 'PLAN_NOT_OWNED')
  assert.equal(executions, 0); unchanged(runtime, before)
  await host.callbacks.onConfirm(id)
  assert.deepEqual(events, ['REQUESTING', 'provider', 'PREVIEW', 'CONFIRMING', 'executeCommand', 'runtime', 'APPLIED'])
  assert.equal(executions, 1); applied(runtime, before, { buttonText: 'confirmed only' })
  const committed = capture(runtime)
  await host.callbacks.onConfirm(id)
  assert.equal(executions, 1); unchanged(runtime, committed)
})

test('PR49: presentation command cannot escape trusted selected-block scope', t => {
  const { runtime } = setup(t), before = capture(runtime), planner = createAppChangePlanner(runtime)
  const result = planner.preview(candidate('scope-rejected', 0, 'applicant-list', { backgroundColor: '#abcdef' }), {
    selectedBlockId: blockId, allowedBlockIds: [blockId], allowedEntityIds: ['applicants'],
  })
  assert.equal(result.ok, false); assert.equal(result.error.code, 'SCOPE_VIOLATION')
  unchanged(runtime, before)
})

for (const reason of ['read-only', 'no-selection']) test(`PR49: ${reason} rejects before Provider invocation`, async t => {
  let calls = 0
  const { runtime, host } = setup(t, ({ request }) => { calls++; return answer(request) })
  if (reason === 'read-only') runtime.customProject.setReadOnly(true)
  else host.setSelection(null)
  const before = capture(runtime)
  await assert.rejects(host.callbacks.onRequestPlan('not authorized'), e => e.code === (reason === 'read-only' ? 'READ_ONLY' : 'SELECTION_REQUIRED'))
  assert.equal(calls, 0); assert.equal(host.getSnapshot().preview, null)
  unchanged(runtime, before)
})

test('PR49: production unavailable Provider remains disabled, with explicit feedback and no Runtime change', async t => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const host = createMochiHost(runtime, unavailablePlanProvider)
  t.after(() => host.dispose()); host.setSelection(blockId)
  const before = capture(runtime)
  await assert.rejects(host.callbacks.onRequestPlan('change button'), e => e.code === 'AI_MODIFICATION_DISABLED')
  const view = host.getSnapshot()
  assert.equal(view.phase, 'REQUEST_FAILED'); assert.equal(view.error.code, 'AI_MODIFICATION_DISABLED')
  assert.equal(view.preview, null); assert.equal(view.receipt, null)
  unchanged(runtime, before)
})
