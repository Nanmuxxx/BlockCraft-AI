const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { fixture } = require('./helpers.cjs')
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
}).outputText, filename)
require.extensions['.css'] = () => {}
const { viewerState } = require('../../src/integrations/custom-block-bc/viewer.ts')
const { CustomBlockViewer, CustomBlockRunSurface } = require('../../src/integrations/custom-block-bc/CustomBlockViewer.tsx')
const { CustomBlockInspector } = require('../../src/integrations/custom-block-bc/CustomBlockInspector.tsx')
const { CustomBlockCanvas } = require('../../src/integrations/custom-block-bc/CustomBlockCanvas.tsx')

test('missing backend and forged runnable observations never mount executable content', async () => {
  const f = await fixture(), instance = f.owner.getSnapshot().custom.instances[0]
  for (const observation of [undefined, null, { status: 'runnable', reference: f.reference }, { status: 'pending-build', reference: { ...f.reference, versionDigest: `sha256:${'0'.repeat(64)}` } }, { status: 'pending-build', reference: f.reference, src: 'https://evil.invalid' }]) {
    assert.equal(viewerState(instance, observation).status, 'unavailable')
    const html = renderToStaticMarkup(React.createElement(CustomBlockViewer, { instance, name: '<script>alert(1)</script>', observation }))
    assert.match(html, /data-viewer-status="unavailable"/)
    assert.match(html, /无法运行或交互/)
    assert.doesNotMatch(html, /<iframe|<script|srcdoc|<button|fixture must never execute/)
    assert.ok(html.includes(f.reference.versionDigest))
    assert.match(html, /&lt;script&gt;/)
  }
})
test('exact ref pending-build displays honest status and remains noninteractive', async () => {
  const f = await fixture(), instance = f.owner.getSnapshot().custom.instances[0]
  const state = viewerState(instance, { reference: f.reference, status: 'pending-build' })
  assert.equal(state.status, 'pending-build'); assert.deepEqual(state.reference, f.reference)
  assert.equal(viewerState(instance, { reference: { ...f.reference, definitionId: 'other' }, status: 'pending-build' }).status, 'unavailable')
})
test('B canvas and C renderer use the identical interleaved order and exact instance identity', async () => {
  const f = await fixture()
  const b = renderToStaticMarkup(React.createElement(CustomBlockCanvas, { adapter: f.adapter, selectedId: 'countdown-1', onSelect() {} }))
  const c = renderToStaticMarkup(React.createElement(CustomBlockRunSurface, { adapter: f.adapter,
    renderBuiltin: block => React.createElement('p', null, `内置插槽测试 ${block.name}`),
    observationFor: () => ({ reference: f.reference, status: 'pending-build' }),
  }))
  for (const [html, attribute] of [[b, 'data-block-key'], [c, 'data-render-key']]) {
    assert.deepEqual([...html.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))].map(match => match[1]), f.project.renderOrder.map(item => `${item.kind}:${item.id}`))
  }
  assert.match(b, /is-selected/); assert.match(c, /等待构建/)
  assert.doesNotMatch(b + c, /fixture must never execute|toolchain|srcdoc|<iframe/)
})
test('Inspector renders schema controls and absent optional groups without writing', async () => {
  const f = await fixture(), before = f.owner.getSnapshot()
  const html = renderToStaticMarkup(React.createElement(CustomBlockInspector, { adapter: f.adapter, instanceId: 'countdown-1' }))
  for (const label of ['durationSeconds', 'title', 'enabled', 'mode', 'precision', '启用 style']) assert.ok(html.includes(`aria-label="${label}"`))
  assert.match(html, /step="1"/); assert.match(html, /step="any"/)
  assert.match(html, /compact/); assert.match(html, /full/)
  assert.doesNotMatch(html, /style.caption|fixture must never execute/)
  assert.strictEqual(f.owner.getSnapshot(), before); assert.equal(f.owner.commits(), 0)
})
test('no selection displays guidance and source text is never evaluated', async () => {
  const f = await fixture()
  const html = renderToStaticMarkup(React.createElement(CustomBlockInspector, { adapter: f.adapter, instanceId: null }))
  assert.match(html, /请选择一块自定义积木/); assert.doesNotMatch(html, /<form/)
})
