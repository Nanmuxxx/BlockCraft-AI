// Real Chromium + real local HTTP route. DeepSeek fetch is an offline-only fixture.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const { once } = require('node:events')
const { mkdir, writeFile } = require('node:fs/promises')
const assert = require('node:assert/strict')
const path = require('node:path')
const fixture = require('./pomodoro.json')
async function run() {
  const root = path.resolve(__dirname, '../..')
  const artifacts = path.join(root, 'docs/acceptance/trusted-interactive')
  await mkdir(artifacts, { recursive: true })
  const { createAppServer } = await import('../../server/index.mjs')
  const { createServer } = await import('vite')
  let mode = 'success', calls = 0, output = structuredClone(fixture)
  const backend = createAppServer({ apiKey: 'offline-test-only', model: 'offline-fixture-model',
    interactive: { enabled: true, allowedOrigin: 'http://127.0.0.1:5198', approval: { reference: 'OFFLINE-ONLY', providerVerified: true, permissionsVerified: true, maxCalls: 20, expiresAt: Date.now() + 600000 },
      resolveAccess: async () => ({ sessionId: 'offline-session', appId: 'offline-app', readOnly: false }), reserveBudget: async () => true },
    fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions')
      const request = JSON.parse(options.body)
      assert.equal(request.response_format.type, 'json_object')
      if (mode === 'failure') return new Response('', { status: 503 })
      const spec = mode === 'invalid' ? { ...output, script: 'alert(1)' } : output
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec) } }] })
    },
  })
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
  const vite = await createServer({ root, server: { host: '127.0.0.1', port: 5198, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${backend.address().port}`, changeOrigin: false } } } })
  let browser
  const failures = [], evidence = []
  try {
    await vite.listen(); browser = await chromium.launch({ headless: true })
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport, isMobile: name === 'mobile', deviceScaleFactor: 1 })
      page.on('pageerror', error => failures.push(error.message))
      page.on('request', request => { assert.equal(new URL(request.url()).hostname, '127.0.0.1', 'No external network allowed') })
      await page.goto('http://127.0.0.1:5198/tests/trusted-interactive/index.html')
      await page.getByRole('button', { name: '生成可信配置' }).click()
      await expect(page.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible()
      await expect(page.getByTestId('source')).toContainText('offline-fixture')
      const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })
      const c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
      await expect(b).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: '数学专注', exact: true }).click()
      await page.getByText('积木与数据详情', { exact: true }).click()
      await expect(page.getByRole('complementary', { name: '积木属性', exact: true })).toContainText('无需数据绑定')
      await expect(page.getByRole('complementary', { name: '积木属性', exact: true })).not.toContainText('绑定异常')
      await expect(page.getByRole('region', { name: '番茄钟配置' })).toContainText('1500 秒')
      await page.screenshot({ path: path.join(artifacts, `${name}-b.png`), fullPage: true })
      await c.click()
      const timer = page.getByRole('region', { name: '数学专注', exact: true })
      const remaining = timer.getByLabel('剩余时间')
      await expect(remaining).toHaveText('25:00')
      await timer.getByRole('button', { name: '开始', exact: true }).click()
      await expect(remaining).not.toHaveText('25:00', { timeout: 3000 })
      await timer.getByRole('button', { name: '暂停', exact: true }).click()
      const paused = await remaining.textContent()
      await page.waitForTimeout(1150)
      await expect(remaining).toHaveText(paused)
      await timer.getByRole('button', { name: '开始', exact: true }).click()
      const beforeModeSwitch = JSON.parse(await page.getByTestId('snapshot').textContent())
      await b.click(); await page.waitForTimeout(1150); await c.click()
      await expect(remaining).not.toHaveText(paused)
      const afterModeSwitch = JSON.parse(await page.getByTestId('snapshot').textContent())
      assert.deepEqual(afterModeSwitch.timers, beforeModeSwitch.timers, 'B/C must keep the same anchor')
      assert.equal(afterModeSwitch.revision, beforeModeSwitch.revision, 'Repaint must not commit')
      await page.screenshot({ path: path.join(artifacts, `${name}-c-running.png`), fullPage: true })
      await timer.getByRole('button', { name: '暂停', exact: true }).click()
      const snapshot = await page.getByTestId('snapshot').textContent()
      for (mode of ['invalid', 'failure']) {
        await page.getByRole('button', { name: '生成可信配置' }).click()
        await expect(page.getByRole('alert').filter({ hasText: '现有应用保持原样' })).toBeVisible()
        assert.equal(await page.getByTestId('snapshot').textContent(), snapshot)
      }
      mode = 'success'
      await page.getByRole('button', { name: '导出 React 项目' }).click()
      await expect(page.getByRole('alert').filter({ hasText: '暂不支持 React ZIP 导出' })).toBeVisible()
      await timer.getByRole('button', { name: '重置', exact: true }).click()
      await expect(remaining).toHaveText('25:00')
      // Small view and real click targets must fit horizontally in Chromium.
      await timer.scrollIntoViewIfNeeded()
      const box = await timer.boundingBox()
      assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1, `${name}: timer overflows viewport`)
      // Completion uses a separate legal model configuration, not artificial timer state.
      output = structuredClone(fixture); output.blocks[0].durationSeconds = 1
      await page.getByRole('button', { name: '生成可信配置' }).click()
      await expect(page.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      await expect(remaining).toHaveText('00:01')
      await timer.getByRole('button', { name: '开始', exact: true }).click()
      await expect(remaining).toHaveText('00:00', { timeout: 3000 })
      await expect(timer.locator('p[role="status"]')).toHaveText('本轮专注已完成')
      await expect(timer.getByRole('button', { name: '开始', exact: true })).toBeDisabled()
      output = structuredClone(fixture)
      evidence.push({ viewport: name, size: viewport, passed: ['request-to-validated-config', 'B-config', 'C-start-pause-resume-reset-completion', 'mode-anchor-preserved', 'failed-generation-preserves-owner', 'ZIP-explicit-refusal', 'timer-fits-viewport'] })
      await page.close()
    }
    assert.deepEqual(failures, [])
    await writeFile(path.join(artifacts, 'browser-results.json'), JSON.stringify({ source: 'offline-fixture', paidCalls: 0, fixtureCalls: calls, browser: await browser.version(), evidence, pageErrors: failures }, null, 2) + '\n')
    console.log(JSON.stringify({ passed: evidence.length, fixtureCalls: calls, paidCalls: 0, artifacts }))
  } finally {
    await browser?.close(); await vite.close()
    await new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve) })
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
