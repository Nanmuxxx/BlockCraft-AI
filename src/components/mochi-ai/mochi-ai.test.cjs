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

test('unavailable planner is explicit and disables prompt submission and suggestion drafts', () => {
  const html = renderToStaticMarkup(React.createElement(MochiAiAssistant, {
    ...props, preview: null, planningDisabledReason: 'AI 修改尚未启用：等待真实计划 API',
  }))
  assert.match(html, /AI 修改尚未启用：等待真实计划 API/)
  assert.match(html, /<textarea[^>]*disabled/)
  assert.match(html, /class="mochi-ai__send"[^>]*disabled/)
  assert.match(html, /class="mochi-ai__suggestion-prompt"[^>]*disabled/)
})

test('TypeScript callback contract accepts synchronous and asynchronous hosts through both UI entries', () => {
  const path = require('node:path')
  const normalizePath = file => file.replace(/\\/g, '/')
  const filename = normalizePath(path.join(__dirname, '__callback_contract_test__.ts'))
  const source = `
    import type { MochiCallbacks, MochiAiAssistantProps } from './types'
    import type { MochiAssistantProps } from './MochiTypes'
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
    type Assert<T extends true> = T
    type RequestReturn = Assert<Equal<ReturnType<MochiCallbacks['onRequestPlan']>, void | Promise<void>>>
    type ConfirmReturn = Assert<Equal<ReturnType<MochiCallbacks['onConfirm']>, void | Promise<void>>>
    const sync: MochiCallbacks = { onRequestPlan(prompt, ui) { prompt.toUpperCase(); ui.blocks.map(b => b.id) }, onConfirm(id) { id.toUpperCase() }, onCancel() {}, onIgnore() {} }
    const asyncHost: MochiCallbacks = { ...sync, async onRequestPlan() {}, async onConfirm() {} }
    const mixed: MochiCallbacks = { ...sync, onRequestPlan: () => Math.random() ? undefined : Promise.resolve(), onConfirm: () => Math.random() ? undefined : Promise.resolve() }
    const base = { context: { blocks: [] }, messages: [], suggestions: [] }
    const chats: MochiAiAssistantProps[] = [sync, asyncHost, mixed].map(callbacks => ({ ...base, ...callbacks }))
    const assistants: MochiAssistantProps[] = [sync, asyncHost, mixed].map(callbacks => ({ ...base, ...callbacks }))
    // @ts-expect-error A callback cannot return a plan as authority.
    const invalidRequest: MochiCallbacks['onRequestPlan'] = () => ({ planId: 'untrusted' })
    // @ts-expect-error A confirmation cannot return an arbitrary promise payload.
    const invalidConfirm: MochiCallbacks['onConfirm'] = async () => 1
  `
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, ...rest) => normalizePath(file) === filename
    ? ts.createSourceFile(file, source, languageVersion, true)
    : getSourceFile(file, languageVersion, ...rest)
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host))
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => __dirname, getNewLine: () => '\n',
  }))
})


test('controlled Host states distinguish current receipts, history, explicit failure and unknown outcome', () => {
  const operation = { phase: 'REQUEST_FAILED', requestId: 'new', busy: false, error: { code: 'FAILED', message: '请求失败' }, receipt: null, lastApplied: { requestId: 'old', receipt: { committedRevision: 1 } } }
  const render = patch => renderToStaticMarkup(React.createElement(MochiAiAssistant, { ...props, preview: null, operation: { ...operation, ...patch }, onCancelRequest() {} }))
  const failed = render({})
  assert.match(failed, /历史成功回执版本：1/)
  assert.doesNotMatch(failed, /本次修改已应用|本次提交回执版本/)
  assert.match(render({ phase: 'COMMIT_FAILED' }), /提交失败，本次未写入/)
  const unknown = render({ phase: 'COMMIT_OUTCOME_UNKNOWN', error: { code: 'COMMIT_OUTCOME_UNKNOWN', message: '请核对应用' } })
  assert.match(unknown, /提交结果未确认/)
  assert.doesNotMatch(unknown, /请检查后重试|已回滚|本次修改已应用/)
  assert.match(render({ phase: 'APPLIED', receipt: { ok: true, committedRevision: 2 }, error: null }), /本次提交回执版本：2/)
  assert.match(render({ phase: 'REQUESTING', busy: true, error: null }), /取消请求/)
})

test('preview renders untrusted text safely and keeps shared entity impact visible', () => {
  const attack = '<img src=x onerror=alert(1)>'
  const html = renderToStaticMarkup(React.createElement(MochiAiAssistant, { ...props, preview: {
    ...props.preview, title: attack, changes: [{ operation: 'sharedEntityImpact', target: 'applicants', description: '共享实体影响：applicant-list；直接授权外：applicant-list', before: attack, after: attack }],
  } }))
  assert.ok(html.includes('&lt;img'))
  assert.ok(!html.includes(attack))
  assert.match(html, /共享实体影响：applicant-list/)
})

test('invalid input feedback coexists with a valid preview; stale feedback removes confirmation', () => {
  const operation = { phase: 'PREVIEW', requestId: 'valid-preview', busy: false, receipt: null, lastApplied: null,
    error: { code: 'INVALID_PROMPT', message: 'Expected a short nonempty instruction' } }
  const html = renderToStaticMarkup(React.createElement(MochiAiAssistant, { ...props, operation }))
  assert.match(html, /role="alert">INVALID_PROMPT/)
  assert.match(html, /为任务增加优先级/)
  assert.match(html, />确认<\/button>/)
  const stale = renderToStaticMarkup(React.createElement(MochiAiAssistant, { ...props, preview: null,
    operation: { ...operation, phase: 'STALE', error: { code: 'CONTEXT_CHANGED', message: 'Context changed; request a new preview' } } }))
  assert.match(stale, /上下文已变化，请重新预览/)
  assert.match(stale, /role="alert">CONTEXT_CHANGED/)
  assert.doesNotMatch(stale, /修改计划预览|>确认<\/button>/)
})
