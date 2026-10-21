const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
async function run() {
  const { createServer } = await import('vite')
  const vite = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'layout-order-qa', configureServer(server) {
    server.middlewares.use('/__order', async (_req, res, next) => {
      try { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__order', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/layout-order/fixture.tsx"></script></body></html>')) } catch (e) { next(e) }
    })
  } }] })
  let browser
  const report = { cases: [], errors: [], paidCalls: 0 }
  try {
    await vite.listen(); browser = await chromium.launch({ headless: true })
    for (const width of [1366, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      page.on('pageerror', e => report.errors.push(e.message))
      await page.route('**/api/**', route => route.fulfill({ json: { enabled: false, reason: 'ACCESS_UNAVAILABLE' } }))
      await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__order`)
      const movedId = width > 600 ? 'registration-form' : 'applicant-total'
      const expected = width > 600 ? ['applicant-list', 'applicant-total', 'registration-form'] : ['applicant-list', 'registration-form', 'applicant-total']
      const form = page.locator(`[data-block-key="builtin:${movedId}"]`)
      await expect(form).toBeVisible(); await form.click(); await page.mouse.move(0, 0)
      await form.scrollIntoViewIfNeeded()
      await page.waitForTimeout(200)
      const box = await form.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 700, { steps: 30 }); await page.mouse.up()
      await expect.poll(() => page.evaluate(() => window.orderQA.runtime.customProject.getSnapshot().renderOrder.map(item => item.id))).toEqual(expected)
      const saved = await page.evaluate(async () => {
        const project = window.orderQA.runtime.customProject.getSnapshot()
        const loaded = await window.orderQA.roundTrip()
        return { order: project.renderOrder, loaded: loaded.renderOrder, revision: project.revision }
      })
      assert.deepEqual(saved.loaded, saved.order); assert.equal(saved.revision, 1)
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      const titles = await page.locator('#generated-preview .renderer-block > h2').allTextContents()
      const names = { 'registration-form': '报名表', 'applicant-list': '报名名单', 'applicant-total': '报名人数' }
      assert.deepEqual(titles, expected.map(id => names[id]))
      await page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }).click()
      assert.deepEqual(await page.evaluate(() => window.orderQA.runtime.customProject.getSnapshot().renderOrder), saved.order)
      await fs.mkdir(path.join(root, '.cache/layout-order'), { recursive: true })
      await page.screenshot({ path: path.join(root, `.cache/layout-order/B-${width}.png`), fullPage: true })
      report.cases.push({ width, revision: saved.revision, order: saved.order, jsonRoundTrip: true, pointerDrag: true, passed: true })
      await page.close()
    }
    assert.deepEqual(report.errors, [])
  } finally {
    await fs.mkdir(path.join(root, '.cache/layout-order'), { recursive: true })
    await fs.writeFile(path.join(root, '.cache/layout-order/report.json'), JSON.stringify(report, null, 2))
    await browser?.close(); await vite.close()
  }
  console.log(JSON.stringify(report))
}
run().catch(e => { console.error(e); process.exitCode = 1 })
