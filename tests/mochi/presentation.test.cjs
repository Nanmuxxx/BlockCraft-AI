const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename)
require.extensions['.css'] = () => {}
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { createAppRuntime } = require('../../src/model/appRuntime.ts')
const { createClubRegistrationExample } = require('../../src/model/appSpecExamples.ts')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { createModelPlanProvider } = require('../../src/integrations/mochi/modelPlanProvider.ts')
const { AppRenderer } = require('../../src/components/app-renderer/AppRenderer.tsx')

function setup(transform = x => x) {
  const runtime = createAppRuntime(createClubRegistrationExample())
  // A deterministic completion fixture; no API, transport, or prompt inference.
  const provider = createModelPlanProvider(async ({ request }) => JSON.stringify(transform({
    request: { requestId: request.requestId, baseRevision: request.baseRevision, commands: [{
      type: 'configureBlockPresentation', blockId: request.block.id,
      presentation: { buttonText: request.prompt.match(/按钮文案设为「(.*?)」/)?.[1] ?? request.prompt, backgroundColor: '#abcdef', textColor: '#123456', borderRadius: 12 },
    }] }, capabilityIds: [],
  })))
  const host = createMochiHost(runtime, provider)
  host.setSelection('registration-form')
  return { host, runtime }
}
async function preview(host, prompt = '立即报名') {
  await host.callbacks.onRequestPlan(`把按钮文案设为「${prompt}」，调整背景、文字颜色和圆角`)
  return host.getSnapshot().preview.planId
}

test('completion → diff → explicit confirm → real Runtime; consecutive merge patches preserve records', async () => {
  const { host, runtime } = setup()
  const initial = runtime.getSnapshot()
  const id = await preview(host)
  assert.strictEqual(runtime.getSnapshot(), initial)
  assert.match(host.getSnapshot().preview.changes[0].after, /立即报名/)
  await host.callbacks.onConfirm(id)
  assert.equal(runtime.getSnapshot().revision, initial.revision + 1)
  assert.deepEqual(runtime.getSnapshot().records, initial.records)
  const block = runtime.getSnapshot().spec.blocks.find(b => b.id === 'registration-form')
  assert.equal(block.presentation.buttonText, '立即报名')
  const inB = renderToStaticMarkup(React.createElement(AppRenderer, { runtime }))
  host.setMode('run')
  assert.equal(renderToStaticMarkup(React.createElement(AppRenderer, { runtime })), inB)
  assert.match(inB, /立即报名/); assert.match(inB, /background-color:#abcdef/)
  assert.match(inB, /border-radius:12px/)
  host.setMode('blocks')
  await host.callbacks.onConfirm(await preview(host, '再次报名'))
  assert.equal(runtime.getSnapshot().revision, initial.revision + 2)
  assert.match(renderToStaticMarkup(React.createElement(AppRenderer, { runtime })), /再次报名/)
  host.dispose()
})

for (const patch of [{}, { backgroundColor: 'url(https://invalid/)' }, { borderRadius: 33 }, { borderRadius: -1 }, { buttonText: '' }, { buttonText: 'x'.repeat(121) }, { onClick: 'alert(1)' }]) {
  test(`invalid patch leaves exact Runtime snapshot unchanged: ${JSON.stringify(patch).slice(0, 70)}`, async () => {
    const { host, runtime } = setup(candidate => { candidate.request.commands[0].presentation = patch; return candidate })
    const initial = runtime.getSnapshot()
    await assert.rejects(preview(host))
    assert.strictEqual(runtime.getSnapshot(), initial)
    host.dispose()
  })
}
test('out-of-scope target is rejected; a fresh valid submission can succeed', async () => {
  let invalid = true
  const { host, runtime } = setup(candidate => { if (invalid) candidate.request.commands[0].blockId = 'applicant-list'; return candidate })
  const before = runtime.getSnapshot()
  await assert.rejects(preview(host), error => error.code === 'SCOPE_VIOLATION')
  assert.strictEqual(runtime.getSnapshot(), before)
  invalid = false
  await host.callbacks.onConfirm(await preview(host))
  assert.equal(runtime.getSnapshot().revision, before.revision + 1)
  host.dispose()
})
for (const change of ['selection', 'revision', 'authorization', 'cancel']) test(`${change} retires presentation preview`, async () => {
  const { host, runtime } = setup()
  const id = await preview(host)
  if (change === 'selection') host.setSelection('applicant-list')
  if (change === 'revision') runtime.moveBlock('registration-form', { x: 0.2, y: 0.3 })
  if (change === 'authorization') { runtime.customProject.setReadOnly(true); runtime.customProject.setReadOnly(false) }
  if (change === 'cancel') host.callbacks.onCancel(id)
  const before = runtime.getSnapshot()
  await assert.rejects(host.callbacks.onConfirm(id))
  assert.strictEqual(runtime.getSnapshot(), before)
  host.dispose()
})
