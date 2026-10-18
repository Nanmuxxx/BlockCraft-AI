// Run: node --test src/components/mochi-ai/mochi-ai.test.cjs
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
const { MochiAiAssistant } = require('./MochiAiAssistant.tsx')
const { claimPlanConfirmation, shouldSubmitComposerKey } = require('./types.ts')

const props = {
  context: { summary: '一个任务清单', blocks: [{ id: 'tasks-1', name: '每日任务', kind: 'tasks', details: '含 3 个字段' }] },
  messages: [{ id: 'm1', role: 'user', content: '加一个优先级字段' }],
  suggestions: [{ id: 's1', label: '添加优先级', prompt: '添加一个优先级字段' }],
  preview: { planId: 'p1', title: '为任务增加优先级', summary: '新增字段并保留现有内容。', changes: [{ operation: '新增字段', target: '每日任务', description: '创建“优先级”选项。', before: '无', after: '高 / 中 / 低' }] },
  mood: 'curious',
  onRequestPlan() {}, onConfirm() {}, onCancel() {}, onIgnore() {},
}

test('renders supplied context, conversation, suggestions and structured plan preview', () => {
  const html = renderToStaticMarkup(React.createElement(MochiAiAssistant, props))
  for (const text of ['每日任务', '含 3 个字段', '加一个优先级字段', '添加优先级', '为任务增加优先级', '新增字段', '高 / 中 / 低', '确认', '取消']) {
    assert.ok(html.includes(text), `expected rendered UI to include ${text}`)
  }
  assert.match(html, /data-mood="curious"/)
  assert.match(html, /mochi-test-asset\.png/)
})

test('renders all supported moods as explicit visual states', () => {
  for (const mood of ['idle', 'thinking', 'curious', 'happy', 'celebrating', 'error']) {
    const html = renderToStaticMarkup(React.createElement(MochiAiAssistant, { ...props, mood }))
    assert.ok(html.includes(`data-mood="${mood}"`))
  }
})

test('Enter submits only outside IME composition and Shift+Enter preserves newline', () => {
  assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: false }), true)
  assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: true, isComposing: false }), false)
  assert.equal(shouldSubmitComposerKey({ key: 'Enter', shiftKey: false, isComposing: true }), false)
  assert.equal(shouldSubmitComposerKey({ key: 'a', shiftKey: false, isComposing: false }), false)
})

test('plan confirmation guard rejects a fast repeat for the same plan', () => {
  const confirmed = new Set()
  assert.equal(claimPlanConfirmation(confirmed, 'p1'), true)
  assert.equal(claimPlanConfirmation(confirmed, 'p1'), false)
  assert.equal(claimPlanConfirmation(confirmed, 'p2'), true)
})

test('reduced-motion stylesheet disables the component animations', () => {
  const css = fs.readFileSync(require.resolve('./mochi-ai.css'), 'utf8')
  assert.match(css, /prefers-reduced-motion:\s*reduce/)
  assert.match(css, /animation:\s*none\s*!important/)
})
