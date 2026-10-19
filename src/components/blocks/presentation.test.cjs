// Run: node --test src/components/blocks/presentation.test.cjs
// Covers: defensive presentation reader, B/C container mapping, snapshot
// passthrough, the committed-state model gate, and default zero-regression.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename)
}
require.extensions['.css'] = () => {}
const { readBlockPresentation, blockCardStyle } = require('./presentation.ts')
const { toAppCanvasModules } = require('./app-canvas.ts')
const { BlockCanvas } = require('../BlockCanvas.tsx')
const { BuiltinBlockRenderer } = require('../app-renderer/AppRenderer.tsx')
const { assertAppSpec } = require('../../model/appSpecValidation.ts')

const FULL = { buttonText: '立即报名', backgroundColor: '#FFEEDD', textColor: '#123456', borderRadius: 12 }

// Official PR49 schema exercised through both display consumers.
const spec = {
  version: 1, id: 'demo-app', name: '演示',
  entities: [{ id: 'signup', name: '报名', fields: [{ id: 'name', name: '姓名', type: 'text', required: true }] }],
  blocks: [
    { id: 'form-1', name: '报名表单', type: 'form', fieldIds: ['name'], presentation: { ...FULL } },
    { id: 'plain-1', name: '普通表单', type: 'form', fieldIds: ['name'] },
    { id: 'list-1', name: '报名列表', type: 'list', fieldIds: ['name'], presentation: { backgroundColor: '#112233' } },
  ],
  relations: [
    { id: 'rel-1', type: 'dataBinding', blockId: 'form-1', entityId: 'signup' },
    { id: 'rel-2', type: 'dataBinding', blockId: 'plain-1', entityId: 'signup' },
    { id: 'rel-3', type: 'dataBinding', blockId: 'list-1', entityId: 'signup' },
  ],
}
const project = { spec, records: {}, revision: 1, blockPositions: {} }
const fakeRuntime = { subscribe: () => () => {}, getSnapshot: () => project }

test('reader returns empty presentation for absent, malformed or hostile blocks', () => {
  assert.deepEqual(readBlockPresentation(undefined), {})
  assert.deepEqual(readBlockPresentation(null), {})
  assert.deepEqual(readBlockPresentation('nope'), {})
  assert.deepEqual(readBlockPresentation({}), {})
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: 'nope' }), {})
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: [] }), {})
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { backgroundColor: 'url(evil)' } }), {})
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { backgroundColor: 'expression(alert(1))' } }), {})
})

test('reader keeps every valid field together and drops only invalid ones', () => {
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { ...FULL } }), FULL)
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { ...FULL, buttonText: '   ' } }),
    { backgroundColor: '#FFEEDD', textColor: '#123456', borderRadius: 12 })
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { backgroundColor: 'rgb(255, 0, 0)' } }), {})
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { textColor: '#FFFA' } }), {})
  // Unknown extra keys inside presentation are ignored, never copied or executed.
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { ...FULL, shadow: 'big', position: 'fixed' } }), FULL)
})

test('reader rejects hostile colors, non-numeric radius and overlong labels', () => {
  for (const bad of ['red', '', '#12345', 'rgb(999, 0, 0)', '#GGG', 'rgba(0,0,0,2)']) {
    assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { backgroundColor: bad } }), {}, bad)
  }
  for (const bad of [-4, '12', NaN, Infinity, 12.5, 33]) {
    assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { borderRadius: bad } }), {}, String(bad))
  }
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { borderRadius: 0 } }), { borderRadius: 0 })
  assert.deepEqual(readBlockPresentation({ type: 'form', presentation: { buttonText: 'x'.repeat(121) } }), {})
  assert.equal(readBlockPresentation({ type: 'form', presentation: { buttonText: 'x'.repeat(120) } }).buttonText, 'x'.repeat(120))
})

test('reader never mutates its input', () => {
  const block = { id: 'b1', presentation: { backgroundColor: '#FFEEDD', junk: 1 } }
  const before = JSON.stringify(block)
  readBlockPresentation(block)
  assert.equal(JSON.stringify(block), before)
})

test('style mapping keeps an empty object for unset presentation and orders bg, text, radius', () => {
  assert.deepEqual(blockCardStyle({}), {})
  assert.deepEqual(blockCardStyle({}), {})
  assert.deepEqual(blockCardStyle({}), {})
  assert.deepEqual(blockCardStyle(FULL), { backgroundColor: '#FFEEDD', color: '#123456', borderRadius: 12 })
  assert.deepEqual(blockCardStyle({ backgroundColor: '#FFF' }), { backgroundColor: '#FFF' })
})

test('reader ignores accessors without executing them', () => {
  const hostile = {}; Object.defineProperty(hostile, 'presentation', { get() { throw Error('executed') } })
  assert.deepEqual(readBlockPresentation(hostile), {})
  const raw = {}; Object.defineProperty(raw, 'backgroundColor', { get() { throw Error('executed') } })
  assert.deepEqual(readBlockPresentation({ presentation: raw }), {})
})

test('snapshot passthrough: toAppCanvasModules carries presentation and defaults to empty', () => {
  const modules = toAppCanvasModules(project)
  assert.deepEqual(modules[0].presentation, FULL)
  assert.deepEqual(modules[1].presentation, {})
  assert.deepEqual(modules[2].presentation, { backgroundColor: '#112233' })
})

test('PR49 model gate accepts official fields and rejects old aliases / unsafe inputs', () => {
  assert.doesNotThrow(() => assertAppSpec(spec))
  for (const patch of [{buttonLabel:'old'}, {borderRadius:33}, {backgroundColor:'url(evil)'}, {textColor:'#FFF'}]) {
    const invalid = structuredClone(spec); invalid.blocks[0].presentation = patch
    assert.throws(() => assertAppSpec(invalid), error => error.code === 'VALIDATION')
  }
})

const baseProps = { positions: {}, selectedModuleId: null, onSelectModule() {}, onMoveModule() {} }
const renderCanvas = modules => renderToStaticMarkup(React.createElement(BlockCanvas, { ...baseProps, modules }))

test('B card renders committed presentation styles and the configured button label', () => {
  const html = renderCanvas([{ id: 'form-1', kind: 'form', name: '报名表单', presentation: { ...FULL } }])
  assert.match(html, /background-color:#FFEEDD/)
  assert.match(html, /color:#123456/)
  assert.match(html, /border-radius:12px/)
  assert.match(html, /按钮：立即报名/)
})

test('B card defaults stay byte-identical without or with empty presentation', () => {
  const plain = renderCanvas([{ id: 'm1', kind: 'form', name: '普通表单' }])
  const empty = renderCanvas([{ id: 'm1', kind: 'form', name: '普通表单', presentation: {} }])
  const unset = renderCanvas([{ id: 'm1', kind: 'form', name: '普通表单', presentation: undefined }])
  assert.equal(plain, empty)
  assert.equal(plain, unset)
  assert.doesNotMatch(plain, /background-color/)
  assert.doesNotMatch(plain, /按钮文字/)
})

const renderBlock = blockId => renderToStaticMarkup(React.createElement(BuiltinBlockRenderer, { runtime: fakeRuntime, blockId }))

test('C block container renders the same presentation values; buttons keep default copy otherwise', () => {
  const styled = renderBlock('form-1')
  assert.match(styled, /background-color:#FFEEDD/)
  assert.match(styled, /color:#123456/)
  assert.match(styled, /border-radius:12px/)
  assert.match(styled, /立即报名/)
  const plain = renderBlock('plain-1')
  assert.doesNotMatch(plain, /background-color/)
  assert.match(plain, /提交/)
  const list = renderBlock('list-1')
  assert.match(list, /新增记录/)
})