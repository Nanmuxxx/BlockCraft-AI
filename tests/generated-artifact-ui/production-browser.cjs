// No transform/QA bridge/alternate UI: ordinary Vite + the actual /ai-create route.
// Only the existing initial AppSpec/status HTTP responses are fixed offline.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { mkdir, writeFile } = require('node:fs/promises')
const { realpathSync } = require('node:fs')
const { createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const root = path.resolve(__dirname, '../..')
const output = process.env.GENERATED_UI_PRODUCTION_EVIDENCE || '/tmp/blockcraft-generated-ui-production'

async function run() {
  await mkdir(output, { recursive: true })
  const { archivedInstallExport } = await import('./offline-export.mjs')
  const exported = await archivedInstallExport()
  const { createServer } = await import('vite')
  const vite = await createServer({ root, server: { host: '127.0.0.1', port: 5299, strictPort: true, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } } })
  await vite.listen()
  const browser = await chromium.launch({ headless: true }), report = { browser: browser.version(), scope: 'unmodified production /ai-create components; no QA bridge; initial AppSpec HTTP intercepted offline', cases: [], errors: [], paidCalls: 0 }
  try {
    for (const width of [1366, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, recordVideo: { dir: path.join(output, 'video'), size: { width, height: 900 } } })
      const page = await context.newPage(), external = [], errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname !== '127.0.0.1') { external.push(url.href); return route.abort() }
        if (url.pathname === '/api/ai/generate') return route.fulfill({ json: createClubRegistrationExample().spec })
        if (url.pathname === '/api/mochi-ai/status') return route.fulfill({ json: { enabled: false, proactiveEnabled: false, modificationsEnabled: false, reason: 'ACCESS_UNAVAILABLE' } })
        if (url.pathname.startsWith('/api/')) { errors.push(url.pathname); return route.abort() }
        return route.continue()
      })
      await page.goto('http://127.0.0.1:5299/ai-create')
      await page.getByLabel('你想做什么软件？').fill('离线真实源码制品安装验收')
      await page.getByRole('button', { name: '生成应用', exact: true }).click()
      await expect(page.locator('[data-block-key]')).toHaveCount(3)
      const importer = page.locator('.custom-block-import'), preview = importer.getByLabel('AI 积木添加预览')
      await importer.locator('summary').click(); await importer.getByLabel('导入方式').selectOption('ai')
      const malformed = Buffer.from(JSON.stringify(exported))
      const marker = Buffer.from(exported.importFile.artifact.artifact.manifest.name)
      const markerOffset = malformed.indexOf(marker)
      assert.ok(markerOffset >= 0); malformed[markerOffset] = 0xff
      await importer.getByLabel('积木制品 JSON').setInputFiles({ name: 'invalid-utf8.json', mimeType: 'application/json', buffer: malformed })
      await expect(preview).toContainText('不是有效的 UTF-8')
      await expect(page.locator('[data-block-key]')).toHaveCount(3)
      await expect(preview.getByRole('button', { name: '预览添加', exact: true })).toHaveCount(0)
      const select = () => importer.getByLabel('积木制品 JSON').setInputFiles({ name: 'archived-real-pomodoro.install.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
      await select(); await preview.getByRole('button', { name: '预览添加', exact: true }).click()
      await expect(preview.getByRole('button', { name: '确认添加', exact: true })).toBeVisible()
      await expect(page.locator('[data-block-key]')).toHaveCount(3)
      await expect(preview).toContainText('pending-build'); await expect(preview).toContainText(exported.importFile.instance.versionDigest)
      await page.screenshot({ path: path.join(output, `preview-${width}.png`), fullPage: true })
      await preview.getByRole('button', { name: '取消添加', exact: true }).click()
      await expect(page.locator('[data-block-key]')).toHaveCount(3)
      await select(); await preview.getByRole('button', { name: '预览添加', exact: true }).click()
      await preview.getByRole('button', { name: '确认添加', exact: true }).click()
      await expect(preview.getByRole('status')).toContainText('已添加积木')
      await expect(page.locator('[data-block-key]')).toHaveCount(4)
      await page.locator('[data-block-key="custom:offline-pomodoro"]').click()
      await expect(page.getByRole('complementary', { name: '自定义积木属性', exact: true }).getByLabel('initialMinutes', { exact: true })).toHaveValue('25')
      await page.screenshot({ path: path.join(output, `installed-${width}.png`), fullPage: true })
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      await expect(page.locator('[data-instance-id="offline-pomodoro"]')).toHaveAttribute('data-viewer-status', 'unavailable')
      assert.equal(await page.locator('iframe').count(), 0)
      assert.equal(await page.evaluate(() => '__generatedQA' in window), false)
      assert.equal(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth), true)
      assert.deepEqual(external, []); assert.deepEqual(errors, [])
      await page.screenshot({ path: path.join(output, `unavailable-${width}.png`), fullPage: true })
      const video = page.video(); await context.close()
      report.cases.push({ width, passed: true, checks: ['production route without QA decoration', 'invalid UTF-8 rejected before preview without adding a card', 'archived export load', 'preview with exact version/props/source/pending', 'preview/cancel no added card', 'explicit confirm adds one', 'B selects and inspects parameters', 'C unavailable without iframe', 'no QA bridge', 'no external/API egress', 'no horizontal overflow'], video: await video.path(), errors, external })
    }
  } catch (error) { report.errors.push(error.stack || String(error)); throw error }
  finally { await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); await vite.close() }
  console.log(JSON.stringify(report, null, 2))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
