const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { api, copy, createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createGeneratedArtifactUI } = require('../../src/integrations/generated-artifact/ui.ts')
const { createSourceEditPlanner } = require('../../src/integrations/mochi-source/planning.ts')
const { createModelSourcePlanProvider } = require('../../src/integrations/mochi-source/providers.ts')
const { createCustomBlockBCAdapter } = require('../../src/integrations/custom-block-bc/adapter.ts')
const { viewerState } = require('../../src/integrations/custom-block-bc/viewer.ts')
globalThis.fetch = () => { throw Error('TEST_NETWORK_FORBIDDEN') }
const ref = value => ({ definitionId: value.definitionId, versionDigest: value.versionDigest })

test('fixture HTTP envelope → pending export → installer → selected source edit shares one owner/CAS and stays non-executable', async t => {
  const [{ createGenerator }, { createDeepSeekProvider }, { createPendingStore }, { exportPendingInstall }, fixtures] = await Promise.all([
    import('../../server/custom-block/generator.mjs'), import('../../server/custom-block/provider.mjs'),
    import('../../server/custom-block/store.mjs'), import('../../server/custom-block/install-export.mjs'), import('./fixtures.mjs'),
  ])
  const directory = await mkdtemp(path.join(os.tmpdir(), 'blockcraft-install-edit-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let fixtureHttpCalls = 0, completionCalls = 0
  const output = fixtures.response('editable-button')
  // Explicit transport injection. No real HTTP or paid model call is permitted.
  const provider = createDeepSeekProvider({ allowPaid: true, apiKey: 'fixture-key-never-real', fetchImpl: async (url, init) => {
    fixtureHttpCalls++
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    const body = JSON.parse(init.body)
    assert.equal(body.stream, false); assert.equal(body.response_format.type, 'json_object')
    assert.match(JSON.stringify(body.messages), /请创建一个按钮/)
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }] }), { headers: { 'Content-Type': 'application/json' } })
  } })
  const store = createPendingStore(directory)
  const receipt = await createGenerator({ enabled: true, provider, store }).generate(fixtures.request('editable-button', '请创建一个按钮，随后修改文字和颜色'))
  assert.equal(receipt.execution, 'denied'); assert.equal(receipt.status, 'pending-build')
  const envelope = await exportPendingInstall(store, { reference: receipt.reference, instanceId: 'button-target', props: { title: '原始文字' } })
  const runtime = createAppRuntime(createClubRegistrationExample()), owner = runtime.customProject
  const ui = createGeneratedArtifactUI(owner); t.after(() => ui.dispose())
  const before = owner.getSnapshot(), bytes = Buffer.from(JSON.stringify(envelope))
  await ui.readFile({ size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  await ui.prepare()
  assert.equal(ui.getSnapshot().phase, 'preview'); assert.equal(owner.getSnapshot(), before)
  assert.equal(await owner.registry.resolve(receipt.reference), undefined)
  await ui.confirm()
  assert.equal(ui.getSnapshot().phase, 'installed')
  assert.equal(owner.getSnapshot().revision, before.revision + 1)
  const installed = owner.getSnapshot().custom.instances[0]
  assert.equal(installed.id, 'button-target'); assert.deepEqual(installed.props, { title: '原始文字' })
  const oldArtifact = await owner.registry.resolve(ref(installed))

  const planner = createSourceEditPlanner(owner, createModelSourcePlanProvider(async ({ request, signal }) => {
    completionCalls++; assert.equal(signal.aborted, false)
    assert.equal(request.target.id, 'button-target'); assert.deepEqual(request.target.props, { title: '原始文字' })
    const source = copy(request.current.artifact)
    source.sources[source.manifest.entry] = 'import React from "react"; export default function Component({title}:{title:string}) { return <button style={{color:"#2563eb"}}>{title}</button> }'
    return JSON.stringify({ contractVersion: 1, requestId: request.requestId, baseRevision: request.baseRevision,
      blockId: request.target.id, baseReference: ref(request.target),
      candidate: { versionDigest: await api.computeVersionDigest(source), artifact: source }, props: { title: '新的按钮文字' },
      summary: '离线 fixture 修改按钮文字和颜色，源码未执行', steps: ['保存新源码版本', '确认后替换所选积木'], changedFiles: [source.manifest.entry] })
  }))
  t.after(() => planner.dispose()); planner.setSelection(installed.id)
  const input = { blockId: installed.id, ...ref(installed), intent: '把按钮文字改成新的按钮文字，颜色改成蓝色' }
  const beforeEdit = owner.getSnapshot(), preview = await planner.request(input)
  assert.equal(owner.getSnapshot(), beforeEdit)
  assert.equal(await owner.registry.resolve({ ...ref(installed), versionDigest: preview.proposal.candidate.versionDigest }), undefined)
  assert.equal(preview.status, 'pending-build')
  assert.equal((await planner.confirm(preview.planId)).ok, true)
  const after = owner.getSnapshot(), edited = after.custom.instances[0]
  assert.equal(after.revision, beforeEdit.revision + 1); assert.equal(runtime.getSnapshot().revision, after.revision)
  assert.equal(edited.id, installed.id); assert.notEqual(edited.versionDigest, installed.versionDigest)
  assert.deepEqual(edited.props, { title: '新的按钮文字' })
  assert.deepEqual(after.base, beforeEdit.base); assert.deepEqual(after.renderOrder, beforeEdit.renderOrder)
  assert.deepEqual(after.custom.positions, beforeEdit.custom.positions)
  assert.deepEqual(await owner.registry.resolve(ref(installed)), oldArtifact)
  const replacement = await owner.registry.resolve(ref(edited))
  assert.match(replacement.artifact.sources[replacement.artifact.manifest.entry], /#2563eb/)
  assert.deepEqual(planner.getHistory()[0].previousArtifact, oldArtifact)
  assert.equal(planner.getHistory()[0].receipt.committedRevision, after.revision)

  // B/C consume the exact same immutable project projection. Neither evaluates TSX.
  const adapter = await createCustomBlockBCAdapter(owner, owner.registry)
  const b = adapter.orderedBlocks(after).find(item => item.kind === 'custom')
  assert.deepEqual(b.instance, edited); assert.equal(b.manifest.definitionId, edited.definitionId)
  assert.equal(viewerState(edited).status, 'unavailable')
  assert.equal(viewerState(edited, { status: 'runnable', reference: ref(edited) }).status, 'unavailable')
  assert.equal(viewerState(edited, { status: 'pending-build', reference: ref(installed) }).status, 'unavailable')
  assert.equal(viewerState(edited, { status: 'pending-build', reference: ref(edited) }).status, 'pending-build')
  assert.equal(fixtureHttpCalls, 1); assert.equal(completionCalls, 1)
  assert.equal((await planner.confirm(preview.planId)).duplicate, true)
  assert.equal(owner.getSnapshot(), after)
})
