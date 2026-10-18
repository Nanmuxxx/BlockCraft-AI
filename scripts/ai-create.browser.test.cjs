// Requires Playwright + Chromium. All /api requests are intercepted; no paid calls.
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { mkdir } = require('node:fs/promises')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const spec = {
  version: 1, id: 'mock-app', name: 'Mock API 验收应用（离线测试）',
  entities: [{ id: 'items', name: '记录', fields: [
    { id: 'title', name: '名称', type: 'text', required: true },
    { id: 'amount', name: '金额', type: 'number', required: true },
  ] }],
  blocks: [
    { id: 'entry', type: 'form', name: '录入', fieldIds: ['title', 'amount'] },
    { id: 'rows', type: 'list', name: '明细', fieldIds: ['title', 'amount'] },
    { id: 'count', type: 'metric', name: '数量', aggregation: 'count' },
    { id: 'sum', type: 'metric', name: '总额', aggregation: 'sum', fieldId: 'amount' },
  ],
  relations: ['entry', 'rows', 'count', 'sum'].map(blockId => ({ id: `binding-${blockId}`, type: 'dataBinding', blockId, entityId: 'items' })),
}

async function run() {
  const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5187', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let browser
  try {
    await mkdir('/tmp/blockcraft-g2-audit', { recursive: true })
    await Promise.race([
      new Promise((resolve, reject) => {
        let output = ''
        vite.stdout.on('data', chunk => { output += chunk; if (output.includes('http://127.0.0.1:5187')) resolve() })
        vite.once('exit', code => reject(new Error(`Vite exited: ${code}`)))
      }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Vite startup timeout')), 15000); timer.unref() }),
    ])
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const failures = []
    const assetFailures = []
    page.on('response', response => {
      if (!new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) assetFailures.push(response.url())
    })
    page.on('pageerror', error => failures.push(error.message))
    let mode = 'success'
    let requests = 0
    let release
    await page.route('**/api/**', async route => {
      assert.equal(new URL(route.request().url()).pathname, '/api/ai/generate')
      assert.equal(route.request().method(), 'POST')
      assert.deepEqual(route.request().postDataJSON(), { idea: '任意软件创意：记录支出' })
      requests++
      if (mode === 'network') return route.abort('failed')
      if (mode === 'hold') await new Promise(resolve => { release = resolve })
      await route.fulfill({ status: mode === 'failure' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'failure' ? { error: { code: 'AI_NOT_CONFIGURED' } } : mode === 'invalid' ? { version: 999 } : spec) })
    })
    const { expect } = require('playwright/test')
    await page.goto('http://127.0.0.1:5187/ai-create')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    assert.equal(requests, 0)
    await expect(page.getByRole('button', { name: '生成应用', exact: true })).toBeDisabled()
    await page.getByLabel('你想做什么软件？').fill('任意软件创意：记录支出')
    mode = 'hold'
    await page.getByRole('button', { name: '生成应用', exact: true }).click()
    await expect(page.getByRole('button', { name: '正在生成…' })).toBeDisabled()
    await expect(page.getByRole('status')).toContainText('AI 正在设计应用')
    assert.equal(requests, 1)
    release()
    await expect(page.getByRole('heading', { name: spec.name })).toBeVisible()
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    const form = page.getByRole('region', { name: '录入', exact: true })
    const list = page.getByRole('region', { name: '明细', exact: true })
    const metric = name => page.getByRole('region', { name, exact: true }).locator('output')
    await form.getByRole('button', { name: '提交', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('请填写名称')
    await form.getByRole('textbox').fill('午餐')
    await form.getByRole('spinbutton').fill('12.5')
    await form.getByRole('button', { name: '提交', exact: true }).click()
    await expect(list.getByRole('cell', { name: '午餐', exact: true })).toBeVisible()
    await expect(metric('数量')).toHaveText('1')
    await expect(metric('总额')).toHaveText('12.5')
    await list.getByRole('button', { name: '编辑', exact: true }).click()
    await list.getByRole('spinbutton').fill('20')
    await list.getByRole('button', { name: '保存修改', exact: true }).click()
    await expect(metric('总额')).toHaveText('20')
    mode = 'failure'
    await page.locator('.ai-create-regenerate > summary').click()
    await page.getByRole('button', { name: '生成新应用', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('当前应用和数据已保留')
    await expect(metric('总额')).toHaveText('20')
    for (const next of ['invalid', 'network']) {
      mode = next
      await page.getByRole('button', { name: '重试生成', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText(next === 'invalid' ? 'AppSpec 校验' : '无法连接')
      await expect(metric('数量')).toHaveText('1')
    }
    await list.getByRole('button', { name: '删除', exact: true }).click()
    await expect(metric('数量')).toHaveText('0')
    await expect(metric('总额')).toHaveText('0')
    await form.getByRole('textbox').fill('旧草稿')
    mode = 'success'
    await page.getByRole('button', { name: '重试生成', exact: true }).click()
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    await expect(form.getByRole('textbox')).toHaveValue('')
    await expect(metric('数量')).toHaveText('0')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.screenshot({ path: '/tmp/blockcraft-ai-create-mock.png', fullPage: true })
    await page.goto('http://127.0.0.1:5187/app-renderer')
    await expect(page.getByRole('heading', { name: '通用应用预览' })).toBeVisible()
    await page.getByRole('button', { name: '阅读记录', exact: true }).click()
    await expect(page.getByRole('heading', { name: '累计分钟' })).toBeVisible()
    await page.goto('http://127.0.0.1:5187/')
    await expect(page.getByRole('main')).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByLabel('描述你想创造的软件').fill('做一个学习助手')
    await page.getByRole('button', { name: '开始创造', exact: true }).click()
    await expect(page.getByRole('heading', { name: '先确定最重要的功能' })).toBeVisible()
    await page.getByRole('button', { name: /两个都需要/ }).click()
    await expect(page.getByRole('heading', { name: '我的学习助手', exact: true })).toBeVisible()
    const modes = page.getByRole('group', { name: '创作模式', exact: true })
    await page.screenshot({ path: '/tmp/blockcraft-g2-audit/legacy-b.png', fullPage: true })
    await modes.getByRole('button', { name: 'C 应用预览', exact: true }).click()
    await page.getByLabel('新增一项学习任务').fill('G2 原 Demo 回归任务')
    await page.getByRole('button', { name: '添加任务', exact: true }).click()
    const tasks = page.getByRole('list', { name: '学习任务列表', exact: true })
    await expect(tasks.getByText('G2 原 Demo 回归任务', { exact: true })).toBeVisible()
    await modes.getByRole('button', { name: 'B 功能积木', exact: true }).click()
    await modes.getByRole('button', { name: 'C 应用预览', exact: true }).click()
    await expect(tasks.getByText('G2 原 Demo 回归任务', { exact: true })).toBeVisible()
    await page.screenshot({ path: '/tmp/blockcraft-g2-audit/legacy-c.png', fullPage: true })
    await page.evaluate(() => document.fonts.ready)
    assert.deepEqual(assetFailures, [], 'styles, fonts and images load without HTTP errors')
    assert.deepEqual(failures, [])
    console.log(`PASS: ${requests} intercepted Mock API requests; loading, CRUD/metrics, failures retain data, retry/replacement, mobile, legacy routes; no paid API requests.`)
  } finally {
    await browser?.close()
    vite.kill('SIGTERM')
    if (vite.exitCode === null) await once(vite, 'exit')
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
