const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript'), React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }, fileName: filename }).outputText, filename)
const { StudioAccessStatus } = require('./StudioAccessStatus.tsx')
const render = studio => renderToStaticMarkup(React.createElement(StudioAccessStatus, { studio }))
test('current cumulative status renders actual API shape without optional estimates', () => {
  const html = render({ configured: true, authenticated: true, singleBoot: true, budget: { calls: 82, maxCalls: 100, capCny: 5, reservedCny: 1.234567, remainingCalls: 18, remainingCny: 3.765433, halted: false } })
  for (const text of ['AI 创作已解锁', '已用 82/100 次', '累计保守计费 ¥1.2346', '剩余 18 次', '历史调用与保守费用已计入', '容器重启不会恢复额度']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /历史费用待核对|本轮额度独立计算|容器重启后 AI 授权会锁定/)
})
test('legacy estimate and unknown history remain readable; disabled status is explicit', () => {
  const base = { configured: false, authenticated: true, budget: { calls: 3, maxCalls: 8, capCny: 1, reservedCny: 0.2, halted: true } }
  assert.match(render({ ...base, budget: { ...base.budget, estimatedCny: 0.12 } }), /估算 ¥0.1200/)
  const html = render(base); assert.match(html, /AI 创作暂时不可用/); assert.match(html, /历史费用待核对/); assert.match(html, /当前预算已安全暂停/)
})
