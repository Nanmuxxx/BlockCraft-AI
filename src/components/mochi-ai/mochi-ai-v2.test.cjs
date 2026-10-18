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
require.extensions['.png'] = (module) => { module.exports = 'mochi-test-asset.png' }
const { evaluateMochiSuggestions, createMochiDismissalStore } = require('./MochiSuggestions.ts')
const { MochiOverlay } = require('./MochiOverlay.tsx')
const { MochiChat } = require('./MochiChat.tsx')

const base = {
  selectedBlockId: 'form-1',
  blocks: [{ id: 'form-1', name: '报名表单', type: 'form', fieldIds: ['name'] }, { id: 'list-1', name: '报名列表', type: 'list', fieldIds: ['name'] }],
  relations: [{ blockId: 'form-1', entityId: 'people' }, { blockId: 'list-1', entityId: 'people' }],
  entities: [{ id: 'people', name: '报名者', fields: [{ id: 'name', name: '姓名', type: 'text' }] }],
}

test('contact rules are structural and labeled as local rules', () => {
  const missing = evaluateMochiSuggestions(base)
  assert.equal(missing.length, 1)
  assert.equal(missing[0].ruleId, 'form-missing-contact-field')
  assert.equal(missing[0].source, 'local_rule')
  assert.equal(evaluateMochiSuggestions({ ...base, entities: [{ ...base.entities[0], fields: [...base.entities[0].fields, { id: 'phone', name: '电话' }] }] })[0].ruleId, 'contact-not-in-form')
  assert.equal(evaluateMochiSuggestions({ ...base, selectedBlockId: 'list-1', entities: [{ ...base.entities[0], fields: [...base.entities[0].fields, { id: 'phone', name: '电话' }] }] })[0].ruleId, 'contact-not-in-list')
})

test('dismissal store dedupes a recommendation until its fingerprint changes', () => {
  const store = createMochiDismissalStore()
  const recommendation = evaluateMochiSuggestions(base)[0]
  store.dismiss(recommendation)
  assert.equal(store.filter([recommendation]).length, 0)
  const changed = evaluateMochiSuggestions({ ...base, entities: [{ ...base.entities[0], fields: [{ id: 'name', name: '姓名' }, { id: 'status', name: '状态' }] }] })
  assert.equal(store.filter(changed).length, 1)
})

test('rich host context keeps selected block and entity association visible', () => {
  const html = renderToStaticMarkup(React.createElement(MochiChat, {
    context: base,
    messages: [],
    suggestions: [],
    emotion: 'curious',
    onRequestPlan() {},
    onConfirm() {},
    onCancel() {},
    onIgnore() {},
  }))
  assert.match(html, /已选中积木：报名表单/)
  assert.match(html, /关联实体：报名者/)
})

test('overlay exposes an accessible chat button inside a non-interactive motion layer', () => {
  const html = renderToStaticMarkup(React.createElement(MochiOverlay, { anchor: { x: 20, y: 30, width: 100, height: 40, placement: 'right' }, emotion: 'curious' }))
  assert.match(html, /data-placement="right"/)
  const css = fs.readFileSync(require.resolve('./mochi-motion.css'), 'utf8')
  assert.match(css, /\.mochi-overlay[^}]*pointer-events:\s*none/) // class is styled as non-interactive
  assert.match(html, /打开 Mochi 聊天与建议/)
  assert.match(css, /data-dragging/)
  assert.match(css, /prefers-reduced-motion: reduce/)
})
