// Run against Vite: WORKSHOP_URL=http://127.0.0.1:5174 node tests/workshop.browser.cjs
// Requires Playwright and its Chromium browser (npx playwright install chromium).
// PLAYWRIGHT_MODULE may point to an externally installed playwright package.
// Only this test intercepts generation; production retains the real DeepSeek endpoint.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const { clubRegistrationSpec } = require('../src/model/appSpecExamples.ts')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
;(async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    let requests = 0
    let fail = false
    await page.route('**/api/ai/generate', route => {
      requests++
      assert.equal(route.request().method(), 'POST')
      assert.match(route.request().postDataJSON().idea, /社团/)
      return route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { error: { code: 'AI_NOT_CONFIGURED' } } : clubRegistrationSpec) })
    })
    const base = process.env.WORKSHOP_URL || 'http://127.0.0.1:5174'
    await page.goto(`${base}/ai-create`)
    await page.getByLabel('你想做什么软件？').fill('社团报名系统，包含报名表、名单和人数统计')
    await page.getByRole('button', { name: '生成应用', exact: true }).click()
    await page.getByRole('button', { name: 'B 模式 · 编辑积木' }).waitFor()
    console.log('blocks:', await page.locator('[data-block-key]').allTextContents())
    await page.locator('[data-block-key="module:registration-form"]').click()
    await page.getByRole('button', { name: '新增字段', exact: true }).click()
    await page.getByRole('checkbox', { name: '展示 联系方式', exact: true }).check()
    await page.locator('[data-block-key="module:applicant-list"]').click()
    await page.getByRole('checkbox', { name: '展示 联系方式', exact: true }).check()
    await page.getByRole('button', { name: 'C 模式 · 运行应用' }).click()
    const form = page.getByRole('region', { name: '报名表', exact: true })
    await page.getByRole('region', { name: '报名名单', exact: true }).getByRole('columnheader', { name: '联系方式', exact: true }).waitFor()
    await form.getByLabel('姓名').fill('验收同学')
    await form.getByLabel('意向部门').selectOption('技术部')
    await form.getByLabel('联系方式').fill('club@example.test')
    // An unfinished draft also survives a round trip.
    await page.getByRole('button', { name: 'B 模式 · 编辑积木' }).click()
    assert.equal(await page.getByRole('checkbox', { name: '展示 联系方式', exact: true }).isChecked(), true)
    await page.getByRole('button', { name: 'C 模式 · 运行应用' }).click()
    assert.equal(await form.getByLabel('联系方式').inputValue(), 'club@example.test')
    await form.getByRole('button', { name: '提交', exact: true }).click()
    // Both the form and list render the latest schema before and after submission.
    const list = page.getByRole('region', { name: '报名名单', exact: true })
    await list.getByRole('columnheader', { name: '联系方式', exact: true }).waitFor()
    assert.match(await list.innerText(), /验收同学.*技术部.*club@example.test/s)
    assert.equal(await page.getByRole('region', { name: '报名人数', exact: true }).locator('output').innerText(), '1')
    await page.screenshot({ path: join(tmpdir(), 'blockcraft-workshop-c.png'), fullPage: true })
    await page.getByRole('button', { name: 'B 模式 · 编辑积木' }).click()
    assert.equal(await page.getByRole('checkbox', { name: '展示 联系方式', exact: true }).isChecked(), true)
    await page.screenshot({ path: join(tmpdir(), 'blockcraft-workshop-b.png'), fullPage: true })
    fail = true
    await page.getByRole('button', { name: '生成新应用', exact: true }).click()
    await page.getByRole('alert').waitFor()
    await page.getByRole('button', { name: 'C 模式 · 运行应用' }).click()
    assert.match(await list.innerText(), /club@example.test/)
    fail = false
    await page.getByRole('button', { name: '重试生成', exact: true }).click()
    await page.getByRole('button', { name: '生成新应用', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'B 模式 · 编辑积木' }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'C 模式 · 运行应用' }).click()
    assert.equal(await page.getByRole('region', { name: '报名人数', exact: true }).locator('output').innerText(), '0')
    assert.equal(requests, 3)
    await page.goto(base)
    await page.getByLabel('描述你想创造的软件').fill('学习管理 App')
    await page.getByRole('button', { name: '开始创造' }).click()
    await page.getByRole('heading', { name: '先确定最重要的功能' }).waitFor()
    await page.getByRole('group', { name: '选择优先关注的功能' }).getByRole('button').first().click()
    await page.getByRole('heading', { name: '我的学习助手' }).waitFor()
    await page.getByRole('button', { name: 'C 应用预览' }).click()
    await page.locator('#study-task-draft').fill('集成回归任务')
    await page.getByRole('button', { name: '添加任务', exact: true }).click()
    await page.getByText('集成回归任务', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'B 功能积木' }).click()
    await page.getByRole('button', { name: 'C 应用预览' }).click()
    await page.getByText('集成回归任务', { exact: true }).waitFor()
    await page.screenshot({ path: join(tmpdir(), 'blockcraft-learning-demo.png'), fullPage: true })
    assert.deepEqual(errors, [])
    console.log('AI → B → C passed; failed generation preserves app; successful replacement resets app; Home → ClarificationStep → Workshop and task roundtrip passed.')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
