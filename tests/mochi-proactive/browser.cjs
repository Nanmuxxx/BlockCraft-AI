// Real Chromium + production Workshop/Host/Runtime. HTTP advice is fixed offline JSON.
// NODE_PATH may point at the desktop bundled Playwright installation.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path')
const { existsSync, realpathSync } = require('node:fs')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../..')
const output = process.env.MOCHI_PROACTIVE_OUTPUT || path.join(root, '.cache/mochi-proactive/browser')
async function run() {
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
  const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)
  const { localProjectExportPlugin } = await import(pathToFileURL(path.join(root, 'server/project-export/vite-plugin.mjs')).href)
  const alias = ['react', 'react-dom', 'lucide-react', '@fontsource/pixelify-sans'].map(name => ({ find: new RegExp(`^${name}(/|$)`), replacement: path.dirname(require.resolve(`${name}/package.json`)).replaceAll('\\', '/') + '$1' }))
  const localModules = path.join(root, 'node_modules')
  const server = await createServer({ root, configFile: false, cacheDir: path.join(root, '.cache/mochi-proactive/vite'), resolve: { alias },
    server: { host: '127.0.0.1', port: 0, proxy: {}, fs: { allow: [root, ...(existsSync(localModules) ? [realpathSync(localModules)] : []), ...alias.map(item => item.replacement.slice(0, -2))] } },
    plugins: [react(), localProjectExportPlugin(), { name: 'mochi-proactive-offline-fixture', configureServer(vite) {
      vite.middlewares.use('/__mochi-proactive', async (_req, res, next) => {
        try { const html = await vite.transformIndexHtml('/__mochi-proactive', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/mochi-proactive/fixture.tsx"></script></body></html>'); res.setHeader('Content-Type', 'text/html'); res.end(html) }
        catch (error) { next(error) }
      })
    } }] })
  let browser, context, page
  const report = { startedAt: new Date().toISOString(), realAiCalls: 0, cases: [], errors: [], externalRequests: [], analyses: [] }
  try {
    await fs.mkdir(output, { recursive: true }); await server.listen()
    const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
    browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'] })
    report.browserVersion = browser.version()
    for (const width of [1440, 390]) {
      context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' })
      page = await context.newPage()
      let consent = false, sequence = 0, variant = 'initial'
      const ignored = [], inputs = []
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== origin) { report.externalRequests.push({ origin: url.origin, method: request.method() }); return route.abort('blockedbyclient') }
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/mochi-ai/status') return route.fulfill({ json: { enabled: true, proactiveEnabled: consent, modificationsEnabled: false } })
        if (url.pathname === '/api/mochi-ai/consent') { consent = request.postDataJSON().enabled; return route.fulfill({ json: { proactiveEnabled: consent } }) }
        if (url.pathname === '/api/mochi-ai/ignore') { ignored.push(request.postDataJSON().id); return route.fulfill({ json: { ok: true } }) }
        if (url.pathname === '/api/mochi-ai/analyze') {
          const input = request.postDataJSON(); inputs.push(input); sequence++
          report.analyses.push({ width, kind: input.kind, event: input.event?.type, revision: input.context.revision })
          const { appId, instanceId, revision, selectedBlockId, mode } = input.context
          return route.fulfill({ json: { version: 1, source: 'deepseek', capabilities: { modifications: false }, binding: { appId, instanceId, revision, selectedBlockId, mode }, message: '离线结构分析已完成。',
            suggestions: ['预览', '稍后', '忽略', '拒绝', '失败'].map((label, index) => ({ id: 'ai-' + (sequence * 10 + index).toString(16).padStart(32, '0'), text: `${variant}：${label}建议`, reason: '根据当前报名表结构，新增可选备注方便补充说明。', blockId: 'registration-form', priority: 'medium', requiresUserAction: true, kind: 'design-change' })) } })
        }
        report.errors.push('Unexpected local API: ' + url.pathname); return route.abort('blockedbyclient')
      })
      page.on('pageerror', error => report.errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })
      await page.clock.install({ time: new Date() })
      await page.goto(origin + '/__mochi-proactive')
      const panel = page.getByRole('region', { name: '和 Mochi 聊聊', exact: true })
      await expect(panel.getByLabel('主动建议')).toBeEnabled()
      const snapshot = () => page.evaluate(() => structuredClone(window.proactiveQA.runtime.getSnapshot()))
      const original = await snapshot()
      await panel.getByLabel('主动建议').click()
      await expect(panel.getByLabel('主动建议')).toBeChecked()
      const active = panel.getByRole('list', { name: 'Mochi 的建议', exact: true })
      await expect(active.getByRole('listitem')).toHaveCount(5)
      assert.ok(inputs.some(input => input.kind === 'proactive' && input.event.type === 'project-opened'))
      assert.deepEqual(await snapshot(), original, 'analysis performs zero writes')
      const item = label => active.getByRole('listitem').filter({ has: page.getByText(`${variant}：${label}建议`, { exact: true }) })
      await item('稍后').getByRole('button', { name: '稍后处理', exact: true }).click()
      const deferred = panel.getByRole('list', { name: '稍后处理的建议', exact: true })
      await expect(deferred.getByRole('listitem')).toHaveCount(1)
      await deferred.getByRole('button', { name: '恢复建议', exact: true }).click()
      await expect(deferred).toHaveCount(0); await expect(active.getByRole('listitem')).toHaveCount(5)
      await item('忽略').getByRole('button', { name: '忽略', exact: true }).click()
      await item('拒绝').getByRole('button', { name: '拒绝', exact: true }).click()
      await expect(active.getByRole('listitem')).toHaveCount(3)
      assert.equal(ignored.length, 2)
      await page.evaluate(() => { window.proactiveQA.failPlan = true })
      await item('失败').getByRole('button', { name: '接受并预览', exact: true }).click()
      await expect(panel.getByRole('alert')).toBeVisible()
      assert.deepEqual(await snapshot(), original, 'failed plan performs zero writes')
      await page.evaluate(() => { window.proactiveQA.failPlan = false })
      // Advance only the application clock: no wall-time waits or external traffic.
      await page.clock.fastForward(31_000)
      variant = 'structure'
      const changed = await page.evaluate(() => window.proactiveQA.structureChange())
      assert.equal(changed.ok, true)
      await page.clock.runFor(1_000)
      await expect(active.getByRole('listitem')).toHaveCount(5)
      assert.ok(inputs.some(input => input.event?.type === 'structure-changed'))
      const before = await snapshot()
      await item('预览').getByRole('button', { name: '接受并预览', exact: true }).click()
      const preview = page.getByRole('region', { name: '修改计划预览', exact: true })
      await expect(preview).toBeVisible()
      assert.deepEqual(await snapshot(), before, 'accept requests preview and performs zero writes')
      await page.screenshot({ path: path.join(output, `${width}-preview.png`), fullPage: true })
      const planId = await page.evaluate(() => window.proactiveQA.host.getSnapshot().preview.planId)
      await preview.getByRole('button', { name: '确认', exact: true }).click()
      await expect(preview).toHaveCount(0)
      const applied = await snapshot()
      assert.equal(applied.revision, before.revision + 1, 'confirmation commits exactly once')
      assert.deepEqual(applied.records, before.records)
      assert.ok(applied.spec.entities[0].fields.some(field => field.name === '建议备注'))
      await page.evaluate(id => window.proactiveQA.host.callbacks.onConfirm(id), planId)
      assert.deepEqual(await snapshot(), applied, 'duplicate confirmation is idempotent')
      await expect(active.getByRole('listitem')).toHaveCount(0)
      // Trigger another real structure event and verify the same production refresh
      // loop wakes deferred items, then expires both advice and its owned preview.
      await page.clock.runFor(1_000)
      await page.clock.fastForward(31_000)
      variant = 'expiry'
      assert.equal((await page.evaluate(() => window.proactiveQA.structureChange())).ok, true)
      await page.clock.runFor(1_000)
      await expect(active.getByRole('listitem')).toHaveCount(5)
      const expiryBefore = await snapshot()
      await item('稍后').getByRole('button', { name: '稍后处理', exact: true }).click()
      await expect(deferred.getByRole('listitem')).toHaveCount(1)
      await page.clock.fastForward(75_000)
      await expect(deferred).toHaveCount(0)
      await expect(active.getByRole('listitem')).toHaveCount(5)
      await item('预览').getByRole('button', { name: '接受并预览', exact: true }).click()
      await expect(preview).toBeVisible()
      assert.deepEqual(await snapshot(), expiryBefore)
      await page.clock.fastForward(600_001)
      await expect(active.getByRole('listitem')).toHaveCount(0)
      await preview.getByRole('button', { name: '确认', exact: true }).click()
      await expect(preview).toHaveCount(0)
      await expect(page.locator('.mochi-ai').getByRole('alert')).toContainText('SUGGESTION_EXPIRED')
      assert.deepEqual(await snapshot(), expiryBefore, 'expired preview cannot write')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow')
      await page.screenshot({ path: path.join(output, `${width}-applied.png`), fullPage: true })
      report.cases.push({ width, passed: true, analysisNoWrites: true, previewNoWrites: true, confirmationWrites: 1, expiredPreviewRejected: true, deferredAutoResumed: true, ignored: ignored.length, analyses: inputs.length })
      await context.close(); context = null
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true
  } catch (error) {
    report.failure = error.message
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    report.completedAt = new Date().toISOString()
    await context?.close(); await browser?.close(); await server.close()
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  }
  console.log(JSON.stringify(report, null, 2))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
