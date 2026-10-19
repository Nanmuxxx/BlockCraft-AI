// Node 24 --experimental-transform-types: isolated engine checks, no npm dependencies.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(fileURLToPath(url))) return next(url.href, context)
    const index = new URL(`${specifier}/index.ts`, context.parentURL)
    if (existsSync(fileURLToPath(index))) return next(index.href, context)
  }
  return next(specifier, context)
} })
const { createAppRuntime } = await import('../../src/model/appRuntime.ts')
const { createClubRegistrationExample } = await import('../../src/model/appSpecExamples.ts')
const { createMochiHost } = await import('../../src/integrations/mochi/host.ts')
const { createModelPlanProvider } = await import('../../src/integrations/mochi/modelPlanProvider.ts')
function setup(transform = x => x) {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const host = createMochiHost(runtime, createModelPlanProvider(async ({ request }) => JSON.stringify(transform({
    request: { requestId: request.requestId, baseRevision: request.baseRevision, commands: [{ type: 'configureBlockPresentation', blockId: request.block.id, presentation: { buttonText: request.prompt, backgroundColor: '#abcdef', borderRadius: 12 } }] }, capabilityIds: [],
  }))))
  host.setSelection('registration-form')
  return { runtime, host }
}
const preview = async (host, text = '立即报名') => { await host.callbacks.onRequestPlan(text); return host.getSnapshot().preview.planId }
test('provider JSON → preview → confirm → shared B/C Runtime; two edits and idempotent confirmation', async () => {
  const { runtime, host } = setup()
  const before = runtime.getSnapshot()
  const id = await preview(host)
  assert.strictEqual(runtime.getSnapshot(), before)
  assert.match(host.getSnapshot().preview.changes[0].after, /立即报名/)
  await Promise.all([host.callbacks.onConfirm(id), host.callbacks.onConfirm(id)])
  assert.equal(runtime.getSnapshot().revision, before.revision + 1)
  const inB = runtime.getSnapshot()
  host.setMode('run'); assert.strictEqual(runtime.getSnapshot(), inB)
  assert.equal(inB.spec.blocks[0].presentation.buttonText, '立即报名')
  await host.callbacks.onConfirm(await preview(host, '再次报名'))
  assert.equal(runtime.getSnapshot().revision, before.revision + 2)
  assert.deepEqual(runtime.getSnapshot().records, before.records)
  host.dispose()
})
for (const patch of [{}, { backgroundColor: 'url(https://invalid)' }, { textColor: 'red' }, { borderRadius: 33 }, { borderRadius: -1 }, { buttonText: '' }, { buttonText: 'x'.repeat(121) }, { onClick: 'script' }]) test(`reject patch ${JSON.stringify(patch).slice(0, 65)}`, async () => {
  const { runtime, host } = setup(c => { c.request.commands[0].presentation = patch; return c })
  const before = runtime.getSnapshot()
  await assert.rejects(preview(host)); assert.strictEqual(runtime.getSnapshot(), before); host.dispose()
})
for (const kind of ['selection', 'revision', 'authorization', 'cancel']) test(`stale ${kind} cannot commit`, async () => {
  const { runtime, host } = setup(); const id = await preview(host)
  if (kind === 'selection') host.setSelection('applicant-list')
  if (kind === 'revision') runtime.moveBlock('registration-form', { x: 0.2, y: 0.3 })
  if (kind === 'authorization') { runtime.customProject.setReadOnly(true); runtime.customProject.setReadOnly(false) }
  if (kind === 'cancel') host.callbacks.onCancel(id)
  const before = runtime.getSnapshot()
  await assert.rejects(host.callbacks.onConfirm(id)); assert.strictEqual(runtime.getSnapshot(), before); host.dispose()
})
test('out-of-scope rejection and fresh resubmission', async () => {
  let invalid = true
  const { runtime, host } = setup(c => { if (invalid) c.request.commands[0].blockId = 'applicant-list'; return c })
  const before = runtime.getSnapshot()
  await assert.rejects(preview(host), e => e.code === 'SCOPE_VIOLATION')
  assert.strictEqual(runtime.getSnapshot(), before)
  invalid = false; await host.callbacks.onConfirm(await preview(host))
  assert.equal(runtime.getSnapshot().revision, before.revision + 1); host.dispose()
})
test('Runtime owner/CAS denial is surfaced without mutation or retry', async () => {
  const { runtime, host } = setup(); const id = await preview(host)
  const before = runtime.getSnapshot()
  runtime.executeCommand = () => ({ ok: false, error: { code: 'REVISION_CONFLICT', message: 'owner CAS rejected' } })
  await assert.rejects(host.callbacks.onConfirm(id), e => e.code === 'REVISION_CONFLICT')
  assert.strictEqual(runtime.getSnapshot(), before)
  assert.equal(host.getSnapshot().phase, 'COMMIT_FAILED'); host.dispose()
})
test('atomic batch failure rolls back an earlier valid patch', () => {
  const { runtime, host } = setup(); const before = runtime.getSnapshot()
  const result = runtime.executeCommand({ requestId: 'atomic-test', baseRevision: before.revision, commands: [
    { type: 'configureBlockPresentation', blockId: 'registration-form', presentation: { buttonText: 'first' } },
    { type: 'configureBlockPresentation', blockId: 'applicant-list', presentation: { buttonText: 'invalid target type' } },
  ] })
  assert.equal(result.ok, false); assert.strictEqual(runtime.getSnapshot(), before); host.dispose()
})
test('partial patches retain earlier parameters and report actual before/after', async () => {
  let count = 0
  const { runtime, host } = setup(c => { c.request.commands[0].presentation = ++count === 1 ? { buttonText: '保留文字', backgroundColor: '#abcdef' } : { borderRadius: 24 }; return c })
  await host.callbacks.onConfirm(await preview(host))
  const id = await preview(host)
  const diff = host.getSnapshot().preview.changes[0]
  assert.match(diff.before, /保留文字/); assert.match(diff.after, /24/)
  await host.callbacks.onConfirm(id)
  assert.deepEqual(runtime.getSnapshot().spec.blocks[0].presentation, { buttonText: '保留文字', backgroundColor: '#abcdef', borderRadius: 24 }); host.dispose()
})
test('cancellation consumes a late completion without publishing or changing Runtime', async () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  let resolve
  const host = createMochiHost(runtime, () => new Promise(done => { resolve = done }))
  host.setSelection('registration-form')
  const before = runtime.getSnapshot(), pending = host.callbacks.onRequestPlan('late')
  host.cancelRequest(host.getSnapshot().requestId)
  await assert.rejects(pending)
  resolve({ request: { requestId: 'late', baseRevision: before.revision, commands: [] }, capabilityIds: [] })
  await new Promise(done => setImmediate(done))
  assert.equal(host.getSnapshot().phase, 'CANCELLED'); assert.strictEqual(runtime.getSnapshot(), before); host.dispose()
})
test('foreign Runtime authorization cannot publish presentation changes', () => {
  const { runtime, host } = setup(), foreign = createAppRuntime(createClubRegistrationExample())
  const before = runtime.getSnapshot()
  const result = runtime.executeCommand({ requestId: 'foreign-owner', baseRevision: before.revision, commands: [
    { type: 'configureBlockPresentation', blockId: 'registration-form', presentation: { buttonText: 'forbidden' } },
  ] }, foreign.customProject.getAuthorization())
  assert.equal(result.ok, false); assert.strictEqual(runtime.getSnapshot(), before); host.dispose()
})
