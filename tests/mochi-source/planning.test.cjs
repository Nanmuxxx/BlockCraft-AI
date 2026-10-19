const test = require('node:test')
const assert = require('node:assert/strict')
const { api, copy, artifact, createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createSourceEditPlanner } = require('../../src/integrations/mochi-source/planning.ts')
const { createMockSourcePlanProvider, createModelSourcePlanProvider } = require('../../src/integrations/mochi-source/providers.ts')
const ref = value => ({ definitionId: value.definitionId, versionDigest: value.versionDigest })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function candidate(request) {
  const source = copy(request.current.artifact)
  // Controlled protocol fixture, NOT AI-generated output or a duration template.
  source.sources[source.manifest.entry] = 'export default function ProtocolFixture() { throw new Error("inert candidate must not execute"); return <output>fixture revision</output> }'
  return { contractVersion: 1, requestId: request.requestId, baseRevision: request.baseRevision, blockId: request.target.id, baseReference: ref(request.target), candidate: { versionDigest: await api.computeVersionDigest(source), artifact: source }, props: copy(request.target.props), summary: 'Mock：更改 TSX 测试版本，未执行', steps: ['替换测试源文本', '等待用户确认及隔离验收'], changedFiles: [source.manifest.entry] }
}
async function setup(generate = candidate, wrapSession = value => value) {
  const runtime = createAppRuntime(createClubRegistrationExample()), owner = runtime.customProject
  const source = artifact(), versionDigest = await api.computeVersionDigest(source)
  const registered = { versionDigest, artifact: source }
  for (const id of ['target', 'sibling']) assert.equal((await owner.install({ baseRevision: owner.getSnapshot().revision, instance: { id, definitionId: source.manifest.definitionId, versionDigest, props: { durationSeconds: 600 } }, artifact: registered, expectedReference: null })).ok, true)
  const expected = owner.getSnapshot(), withState = copy(expected); withState.revision++
  for (const id of ['target', 'sibling']) withState.custom.states[id] = { versionDigest, stateRevision: 3, value: { remainingSeconds: 123, status: 'paused' } }
  assert.equal(owner.compareAndSwap(expected, withState, owner.getAuthorization()).ok, true)
  const planner = createSourceEditPlanner(wrapSession(owner), createMockSourcePlanProvider(generate))
  planner.setSelection('target')
  const input = { blockId: 'target', definitionId: source.manifest.definitionId, versionDigest, intent: '按意图修改现有功能源代码' }
  return { runtime, owner, planner, input, registered, request: () => planner.request(input) }
}
test('model deadline leaves no preview/history/write; a later request owns the only confirmation', async () => {
  const f = await setup(), waiting = deferred()
  let calls = 0, expiredRequest, expiredSignal
  const provider = createModelSourcePlanProvider(async ({ request, signal }) => {
    if (++calls === 1) { expiredRequest = request; expiredSignal = signal; return waiting.promise }
    return JSON.stringify(await candidate(request))
  }, { timeoutMs: 30 })
  const planner = createSourceEditPlanner(f.owner, provider)
  planner.setSelection('target')
  const before = f.owner.getSnapshot()
  try {
    await assert.rejects(planner.request(f.input), { code: 'MODEL_TIMEOUT' })
    assert.equal(expiredSignal.aborted, true)
    assert.equal(f.owner.getSnapshot(), before); assert.deepEqual(planner.getHistory(), [])
    const latest = await planner.request(f.input)
    waiting.resolve(JSON.stringify(await candidate(expiredRequest)))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(planner.getStatus(latest.planId), 'pending')
    assert.equal(f.owner.getSnapshot(), before)
    assert.equal((await planner.confirm(latest.planId)).ok, true)
    assert.equal(f.owner.getSnapshot().revision, before.revision + 1)
    assert.deepEqual(planner.getHistory().map(item => item.planId), [latest.planId])
    assert.equal(calls, 2)
  } finally { planner.dispose(); f.planner.dispose() }
})
test('preview is inert; one real install/CAS changes only selected version/props/state; old version and state remain traceable', async () => {
  const f = await setup(), before = f.owner.getSnapshot()
  let notifications = 0; f.owner.subscribe(() => notifications++)
  const plan = await f.request()
  assert.equal(f.owner.getSnapshot(), before)
  assert.equal(await f.owner.registry.resolve({ definitionId: f.input.definitionId, versionDigest: plan.proposal.candidate.versionDigest }), undefined)
  assert.equal(plan.providerKind, 'mock'); assert.equal(plan.status, 'pending-build')
  assert.equal(plan.stateEffect, 'archive-and-reset-selected-state')
  assert.ok(Object.isFrozen(plan.proposal.candidate.artifact.sources))
  assert.equal((await f.planner.confirm(plan.planId)).ok, true)
  const after = f.owner.getSnapshot(), expected = copy(before)
  expected.revision++
  expected.custom.instances[0].versionDigest = plan.proposal.candidate.versionDigest
  delete expected.custom.states.target
  assert.deepEqual(after, expected)
  assert.equal(f.runtime.getSnapshot().revision, after.revision)
  assert.equal(notifications, 1)
  assert.equal((await f.planner.confirm(plan.planId)).duplicate, true)
  assert.equal(notifications, 1)
  assert.deepEqual(await f.owner.registry.resolve(ref(f.input)), f.registered)
  const [record] = f.planner.getHistory()
  assert.deepEqual(record.beforeState, before.custom.states.target)
  assert.deepEqual(record.previousArtifact, f.registered)
  assert.equal(record.receipt.committedRevision, after.revision)
  assert.equal(record.status, 'pending-build')
  assert.ok(Object.isFrozen(record.before.props))
})
test('minimum provider context includes selected source/props and excludes records, other instances, authority and state values', async () => {
  let captured
  const f = await setup(request => { captured = request; return candidate(request) })
  await f.request()
  assert.deepEqual(Object.keys(captured).sort(), ['contractVersion', 'requestId', 'projectId', 'baseRevision', 'intent', 'target', 'current'].sort())
  assert.equal(captured.target.id, 'target')
  assert.ok(Object.isFrozen(captured.target.props))
  assert.equal(JSON.stringify(captured).includes('sibling'), false)
  assert.equal(JSON.stringify(captured).includes('remainingSeconds":123'), false)
})
test('cancel is idempotent and does not install; copied/foreign plan ids do not authorize', async () => {
  const f = await setup(), before = f.owner.getSnapshot(), plan = await f.request()
  f.planner.cancel(plan.planId); f.planner.cancel(plan.planId)
  await assert.rejects(f.planner.confirm(plan.planId), { code: 'PLAN_NOT_PENDING' })
  await assert.rejects(f.planner.confirm('foreign'), { code: 'PLAN_NOT_OWNED' })
  const other = await setup()
  await assert.rejects(other.planner.confirm(plan.planId), { code: 'PLAN_NOT_OWNED' })
  assert.equal(f.owner.getSnapshot(), before); assert.equal(f.planner.getHistory().length, 0)
})
for (const [name, mutate] of [
  ['request id', p => p.requestId = 'foreign'], ['revision', p => p.baseRevision++], ['target', p => p.blockId = 'sibling'],
  ['parent version', p => p.baseReference.versionDigest = `sha256:${'0'.repeat(64)}`],
  ['extra execution permit', p => p.executionPermit = true], ['empty summary', p => p.summary = ''],
  ['missing steps', p => p.steps = []], ['incorrect diff', p => p.changedFiles = []],
  ['digest', p => p.candidate.versionDigest = `sha256:${'0'.repeat(64)}`],
  ['manifest', p => p.candidate.artifact.manifest.protocolVersion = 2],
  ['definition', p => p.candidate.artifact.manifest.definitionId = 'other-definition'],
  ['unknown props', p => p.props.unexpected = true], ['invalid props', p => p.props.durationSeconds = -1],
]) test(`reject invalid candidate: ${name}`, async () => {
  let rejectedCandidate
  const f = await setup(async request => { const p = await candidate(request); mutate(p); rejectedCandidate = p.candidate; return p }), before = f.owner.getSnapshot()
  await assert.rejects(f.request())
  assert.equal(f.owner.getSnapshot(), before)
  assert.equal(f.planner.getHistory().length, 0)
  if (rejectedCandidate.artifact.manifest.definitionId === f.input.definitionId) assert.equal(await f.owner.registry.resolve({ definitionId: f.input.definitionId, versionDigest: rejectedCandidate.versionDigest }), undefined)
})
for (const [name, edit, code] of [
  ['unchanged source', (p, r) => { p.candidate = copy(r.current); p.changedFiles = [] }, 'VERSION_CONFLICT'],
  ['capability escalation', p => p.candidate.artifact.manifest.requestedCapabilities = [], 'UNSUPPORTED_MIGRATION'],
  ['schema migration', p => p.candidate.artifact.manifest.propsSchema.properties.durationSeconds.maximum++, 'UNSUPPORTED_MIGRATION'],
  ['props only', (p, r) => { p.candidate.artifact = copy(r.current.artifact); p.candidate.artifact.sources['data.json'] = '{}'; p.changedFiles = ['data.json'] }, 'SOURCE_CHANGE_REQUIRED'],
]) test(`rehash does not authorize ${name}`, async () => {
  const f = await setup(async r => { const p = await candidate(r); edit(p, r); p.candidate.versionDigest = await api.computeVersionDigest(p.candidate.artifact); return p })
  const before = f.owner.getSnapshot()
  await assert.rejects(f.request(), { code }); assert.equal(f.owner.getSnapshot(), before)
})
for (const [name, change] of [
  ['selection A-B-A', f => { f.planner.setSelection('sibling'); f.planner.setSelection('target') }],
  ['mode/context', f => f.planner.invalidate()],
  ['project revision', f => f.runtime.moveBlock('registration-form', { x: .3, y: .4 })],
  ['authorization revoke/regrant', f => { f.owner.setReadOnly(true); f.owner.setReadOnly(false) }],
]) test(`stale confirmation fails after ${name}`, async () => {
  const f = await setup(), plan = await f.request(); change(f)
  const before = f.owner.getSnapshot()
  await assert.rejects(f.planner.confirm(plan.planId))
  assert.equal(f.owner.getSnapshot(), before); assert.equal(f.planner.getHistory().length, 0)
})
test('late provider response ignoring abort cannot revive old plan or supersede newer request', async () => {
  const waiting = deferred(), started = deferred(); let calls = 0, oldSignal
  const f = await setup(async (r, signal) => { if (++calls === 1) { oldSignal = signal; started.resolve(); await waiting.promise } return candidate(r) })
  const old = f.request(); await started.promise
  const outcome = assert.rejects(old, { code: 'CONTEXT_CHANGED' })
  const next = await f.request()
  assert.equal(oldSignal.aborted, true)
  waiting.resolve(); await outcome
  assert.equal(f.planner.getStatus(next.planId), 'pending')
  assert.equal((await f.planner.confirm(next.planId)).ok, true)
})
test('context cancellation retires a never-settling source provider before it can return', { timeout: 1000 }, async () => {
  const started = deferred(); let rejectOld, calls = 0
  const f = await setup((r) => {
    if (++calls > 1) return candidate(r)
    started.resolve()
    return new Promise((_, reject) => { rejectOld = reject })
  })
  const old = f.request(), rejected = assert.rejects(old, { code: 'CONTEXT_CHANGED' })
  await started.promise
  f.planner.invalidate(); await rejected
  const before = f.owner.getSnapshot(), next = await f.request()
  rejectOld(new Error('late provider failure'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.owner.getSnapshot(), before)
  assert.equal(f.planner.getStatus(next.planId), 'pending')
  assert.equal(f.planner.getHistory().length, 0)
  assert.equal((await f.planner.confirm(next.planId)).ok, true)
  assert.equal(f.planner.getHistory().length, 1)
  f.planner.dispose()
})
test('synchronous abort reentry cannot share a source request epoch with its superseder', async () => {
  const started = deferred(); let calls = 0, reentered, f
  f = await setup((r, signal) => {
    if (++calls !== 1) return candidate(r)
    signal.addEventListener('abort', () => { reentered = f.request() }, { once: true })
    started.resolve()
    return new Promise(() => {})
  })
  const old = f.request(), oldRejected = assert.rejects(old, { code: 'CONTEXT_CHANGED' })
  await started.promise
  const superseder = f.request()
  await assert.rejects(superseder, { code: 'CONTEXT_CHANGED' })
  await oldRejected
  const newest = await reentered
  assert.equal(f.planner.getStatus(newest.planId), 'pending')
  assert.equal((await f.planner.confirm(newest.planId)).ok, true)
  assert.equal(f.planner.getHistory().length, 1)
  f.planner.dispose()
})
test('readonly and explicit stale input reject before provider; no untrusted getters execute', async () => {
  let calls = 0, getterCalls = 0
  const f = await setup(r => { calls++; return candidate(r) })
  const before = f.owner.getSnapshot()
  await assert.rejects(f.planner.request({ ...f.input, versionDigest: `sha256:${'0'.repeat(64)}` }), { code: 'VERSION_CONFLICT' })
  const malicious = { ...f.input }; Object.defineProperty(malicious, 'intent', { enumerable: true, get() { getterCalls++; return 'bad' } })
  await assert.rejects(f.planner.request(malicious))
  f.owner.setReadOnly(true)
  await assert.rejects(f.request(), { code: 'READ_ONLY' })
  assert.equal(calls, 0); assert.equal(getterCalls, 0); assert.equal(f.owner.getSnapshot(), before)
})
test('confirm lease blocks selection/cancel/dispose/reentrant confirm while real install is awaiting; competing write wins CAS', async () => {
  const f = await setup(), plan = await f.request()
  const pending = f.planner.confirm(plan.planId)
  assert.throws(() => f.planner.setSelection('sibling'), { code: 'CONFIRM_BUSY' })
  // A future Workshop mode bridge must invalidate synchronously before changing UI mode.
  assert.throws(() => f.planner.invalidate(), { code: 'CONFIRM_BUSY' })
  assert.throws(() => f.planner.cancel(plan.planId), { code: 'CONFIRM_BUSY' })
  assert.throws(() => f.planner.dispose(), { code: 'CONFIRM_BUSY' })
  await assert.rejects(f.planner.confirm(plan.planId), { code: 'CONFIRM_BUSY' })
  assert.equal(f.runtime.moveBlock('registration-form', { x: .7, y: .8 }).ok, true)
  const winner = f.owner.getSnapshot()
  assert.equal((await pending).error.code, 'REVISION_CONFLICT')
  assert.equal(f.owner.getSnapshot(), winner)
  assert.equal(await f.owner.registry.resolve({ definitionId: f.input.definitionId, versionDigest: plan.proposal.candidate.versionDigest }), undefined)
  assert.equal(f.planner.getHistory().length, 0)
})
test('revocation during real admission reaches final CAS and refuses stale authorization', async () => {
  let installCalls = 0
  const f = await setup(candidate, owner => ({ ...owner, install: async (input, auth) => { installCalls++; return owner.install(input, auth) } }))
  const plan = await f.request(), before = f.owner.getSnapshot(), pending = f.planner.confirm(plan.planId)
  f.owner.setReadOnly(true); f.owner.setReadOnly(false)
  assert.equal((await pending).error.code, 'AUTHORIZATION_CHANGED')
  assert.equal(installCalls, 1); assert.equal(f.owner.getSnapshot(), before)
})
test('two planners compete on one real session; at most one version commit', async () => {
  const f = await setup(), other = createSourceEditPlanner(f.owner, createMockSourcePlanProvider(candidate)); other.setSelection('target')
  const a = await f.request(), b = await other.request(f.input), before = f.owner.getSnapshot()
  const results = await Promise.all([f.planner.confirm(a.planId), other.confirm(b.planId)])
  assert.equal(results.filter(r => r.ok).length, 1)
  assert.equal(results.find(r => !r.ok).error.code, 'REVISION_CONFLICT')
  assert.equal(f.owner.getSnapshot().revision, before.revision + 1)
})
test('concurrent explicit replacement invalidates an older preview, keeps both registered versions', async () => {
  const f = await setup(), plan = await f.request(), source = copy(f.registered.artifact)
  source.sources[source.manifest.entry] = 'throw new Error("concurrent inert version")'
  const digest = await api.computeVersionDigest(source)
  assert.equal((await f.owner.install({ baseRevision: f.owner.getSnapshot().revision, instance: { ...copy(f.owner.getSnapshot().custom.instances[0]), versionDigest: digest }, artifact: { versionDigest: digest, artifact: source }, expectedReference: ref(f.input) })).ok, true)
  const winner = f.owner.getSnapshot()
  await assert.rejects(f.planner.confirm(plan.planId))
  assert.equal(f.owner.getSnapshot(), winner)
  assert.deepEqual(await f.owner.registry.resolve(ref(f.input)), f.registered)
})
test('model seam forwards structured source task without template/fallback; malformed model text and provider failure leave project untouched', async () => {
  const f = await setup(), before = f.owner.getSnapshot()
  let calls = 0
  const provider = createModelSourcePlanProvider(async ({ instruction, request, signal }) => {
    calls++; assert.match(instruction, /complete new RegisteredArtifact/); assert.equal(request.intent, f.input.intent); assert.equal(signal.aborted, false)
    return 'ordinary chat advice'
  })
  const planner = createSourceEditPlanner(f.owner, provider); planner.setSelection('target')
  await assert.rejects(planner.request(f.input), SyntaxError)
  assert.equal(calls, 1); assert.equal(f.owner.getSnapshot(), before)
  const failing = createSourceEditPlanner(f.owner, createMockSourcePlanProvider(() => { throw Error('controlled provider failure') })); failing.setSelection('target')
  await assert.rejects(failing.request(f.input), /controlled provider failure/)
  assert.equal(f.owner.getSnapshot(), before)
})
test('dispose aborts in-flight provider and permanently closes planner without a write', async () => {
  const waiting = deferred(), started = deferred()
  const f = await setup(async r => { started.resolve(); await waiting.promise; return candidate(r) }), before = f.owner.getSnapshot()
  const pending = f.request(); await started.promise
  const outcome = assert.rejects(pending, { code: 'PLANNER_DISPOSED' })
  f.planner.dispose(); waiting.resolve(); await outcome
  await assert.rejects(f.request(), { code: 'PLANNER_DISPOSED' })
  assert.equal(f.owner.getSnapshot(), before)
})
test('caller input and returned provider JSON are captured before asynchronous validation', async () => {
  let raw
  const f = await setup(async r => { raw = await candidate(r); return raw })
  const input = copy(f.input), pending = f.planner.request(input)
  input.blockId = 'sibling'; input.intent = 'late mutation'
  const plan = await pending
  raw.props.durationSeconds = -1
  raw.candidate.artifact.sources[raw.candidate.artifact.manifest.entry] = 'late replacement'
  assert.equal(plan.request.intent, f.input.intent)
  assert.equal(plan.request.target.id, 'target')
  assert.equal(plan.proposal.props.durationSeconds, 600)
  assert.equal((await f.planner.confirm(plan.planId)).ok, true)
  assert.notEqual((await f.owner.registry.resolve({ definitionId: f.input.definitionId, versionDigest: plan.proposal.candidate.versionDigest })).artifact.sources[raw.candidate.artifact.manifest.entry], 'late replacement')
})

for (const stage of ['initial artifact', 'replacement project']) test(`cancel retires a stalled ${stage} registry lookup without changing history`, { timeout: 1000 }, async () => {
  const started = deferred(); let rejectLate, lookups = 0
  const f = await setup(candidate, owner => ({ ...owner, registry: { resolve(reference) {
    if (++lookups === (stage === 'initial artifact' ? 1 : 2)) {
      started.resolve()
      return new Promise((_, reject) => { rejectLate = reject })
    }
    return owner.registry.resolve(reference)
  } } }))
  const before = f.owner.getSnapshot(), pending = f.request()
  const rejected = assert.rejects(pending, { code: 'CONTEXT_CHANGED' })
  await started.promise; f.planner.invalidate(); await rejected
  assert.equal(f.owner.getSnapshot(), before)
  assert.equal(f.planner.getHistory().length, 0)
  const fresh = await f.request()
  rejectLate(new Error('obsolete registry failure'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.planner.getStatus(fresh.planId), 'pending')
  assert.equal((await f.planner.confirm(fresh.planId)).ok, true)
  assert.equal(f.planner.getHistory().length, 1)
  f.planner.dispose()
})
test('model seam preserves completion-supplied TSX bytes and uses the same validation, without network', async () => {
  const f = await setup(), sourceText = 'export default function DifferentFixture() { throw new Error("do not execute this completion fixture"); return <aside data-test="separate-source">distinct fixture</aside> }'
  const provider = createModelSourcePlanProvider(async ({ request }) => {
    const p = await candidate(request)
    p.candidate.artifact.sources[request.current.artifact.manifest.entry] = sourceText
    p.candidate.versionDigest = await api.computeVersionDigest(p.candidate.artifact)
    return JSON.stringify(p)
  })
  const planner = createSourceEditPlanner(f.owner, provider); planner.setSelection('target')
  const preview = await planner.request(f.input)
  assert.equal(preview.providerKind, 'model')
  assert.equal(preview.proposal.candidate.artifact.sources[preview.request.current.artifact.manifest.entry], sourceText)
  assert.equal((await planner.confirm(preview.planId)).ok, true)
})
test('install rejection is terminal and cannot be retried as a fresh implicit authorization', async () => {
  let installs = 0
  const f = await setup(candidate, owner => ({ ...owner, install: async () => { installs++; return { ok: false, error: { code: 'HOST_UNAVAILABLE', message: 'controlled rejection' } } } }))
  const plan = await f.request(), before = f.owner.getSnapshot()
  assert.equal((await f.planner.confirm(plan.planId)).error.code, 'HOST_UNAVAILABLE')
  assert.equal(f.planner.getStatus(plan.planId), 'rejected')
  await assert.rejects(f.planner.confirm(plan.planId), { code: 'PLAN_NOT_PENDING' })
  assert.equal(installs, 1); assert.equal(f.owner.getSnapshot(), before)
})
