// Optional Playwright regression. Every API request is intercepted; no backend/key.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')

async function run() {
  const { cases } = await import('./fixtures.mjs')
  const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5193', '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let browser
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        let output = ''
        vite.stdout.on('data', chunk => { output += chunk; if (output.includes('http://127.0.0.1:5193')) resolve() })
        vite.once('exit', code => reject(new Error(`Vite exited: ${code}`)))
      }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Vite startup timeout')), 15000); timer.unref() }),
    ])
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const failures = []
    page.on('pageerror', error => failures.push(error.message))
    let candidate
    let mode = 'success'
    let calls = 0
    await page.route('**/api/**', async route => {
      assert.equal(new URL(route.request().url()).pathname, '/api/ai/generate')
      assert.deepEqual(route.request().postDataJSON(), { idea: candidate.idea })
      calls++
      if (mode === 'network') return route.abort('failed')
      return route.fulfill({ status: mode === 'failure' ? 502 : 200, contentType: 'application/json',
        body: JSON.stringify(mode === 'failure' ? { error: { code: 'AI_INVALID_SPEC' } } : mode === 'invalid' ? { version: 999 } : candidate.spec) })
    })
    await page.goto('http://127.0.0.1:5193/ai-create')
    for (candidate of cases) {
      const prompt = page.getByLabel('你想做什么软件？')
      if (!await prompt.isVisible()) await page.locator('.ai-create-regenerate > summary').click()
      await prompt.fill(candidate.idea)
      await page.getByRole('button', { name: /^(生成应用|生成新应用|重试生成)$/ }).click()
      await expect(page.getByRole('heading', { name: candidate.spec.name, exact: true })).toBeVisible()
      // Current Workshop intentionally starts in B mode. Explicitly enter C.
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      for (const [entityId, records] of Object.entries(candidate.records)) {
        const entity = candidate.spec.entities.find(entity => entity.id === entityId)
        const binding = candidate.spec.relations.find(binding => binding.entityId === entityId
          && candidate.spec.blocks.some(block => block.id === binding.blockId && block.type === 'list'))
        const block = candidate.spec.blocks.find(block => block.id === binding.blockId)
        const region = page.getByRole('region', { name: block.name, exact: true })
        for (const values of records) {
          await region.getByRole('button', { name: '新增记录', exact: true }).click()
          for (const field of entity.fields) {
            const control = region.getByLabel(field.name, { exact: false })
            if (field.type === 'select' || field.type === 'boolean') await control.selectOption(String(values[field.id]))
            else await control.fill(String(values[field.id]))
          }
          await region.getByRole('button', { name: '提交', exact: true }).click()
        }
        assert.equal(await region.locator('tbody tr').count(), records.length)
      }
      for (const [blockId, value] of Object.entries(candidate.expectedMetrics)) {
        const block = candidate.spec.blocks.find(block => block.id === blockId)
        await expect(page.getByRole('region', { name: block.name, exact: true }).locator('output')).toHaveText(String(value))
      }
    }
    candidate = cases.find(candidate => candidate.id === 'movie-log')
    const region = page.getByRole('region', { name: '已看电影记录', exact: true })
    await region.getByRole('button', { name: '编辑', exact: true }).click()
    await region.getByLabel('电影名', { exact: false }).fill('保留的电影')
    await region.getByRole('button', { name: '保存修改', exact: true }).click()
    if (!await page.getByLabel('你想做什么软件？').isVisible()) await page.locator('.ai-create-regenerate > summary').click()
    for (mode of ['failure', 'invalid', 'network']) {
      await page.getByRole('button', { name: /^(生成新应用|重试生成)$/ }).click()
      await expect(page.getByRole('alert')).toContainText('当前应用和数据已保留')
      await expect(region.getByRole('cell', { name: '保留的电影', exact: true })).toBeVisible()
    }
    await region.getByRole('button', { name: '删除', exact: true }).click()
    await expect(region.getByText('暂无记录')).toBeVisible()
    mode = 'success'
    await page.getByRole('button', { name: '重试生成', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    await expect(region.getByText('暂无记录')).toBeVisible()
    assert.deepEqual(failures, [])
    console.log(`PASS: ${cases.length} distinct offline apps rendered and recorded data; aggregates, edit/delete, 3 failures retain old app, retry; ${calls} intercepted API requests; zero paid calls.`)
  } finally {
    await browser?.close()
    vite.kill('SIGTERM')
    if (vite.exitCode === null) await once(vite, 'exit')
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
