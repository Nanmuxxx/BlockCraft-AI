const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { execFileSync } = require('node:child_process')
require('../custom-block/fixtures.cjs') // Existing TS transpile hook; imports only.
const { DEMO_GALLERY } = require('../../src/model/appSpecExamples.ts')
const root = path.resolve(__dirname, '../..')
const out = path.join(root, 'docs/acceptance/gallery-stability')
const report = {
  codeSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'Additional stability coverage for #55; OFFLINE FIXTURES and browser-intercepted Mock errors only',
  started: new Date().toISOString(), liveModelCalls: 0, cases: [], screenshots: [],
  pageErrors: [], consoleErrors: [], network: [], externalAttempts: [],
}
let page, browser, server, width, fault = 'none', posts = 0, held = []
const click = locator => width === 390 ? locator.tap() : locator.click()
const workshop = () => page.getByRole('region', { name: '生成的应用', exact: true })
const runMode = () => click(page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }))
async function shot(name) {
  const file = `screenshots/${width}-${name}.png`
  await page.screenshot({ path: path.join(out, file), fullPage: true })
  report.screenshots.push(file)
  return file
}
async function test(id, fn) {
  const entry = { id: `${width}-${id}`, started: new Date().toISOString() }
  try { entry.evidence = await fn(); entry.status = 'PASS' }
  catch (e) { entry.status = 'FAIL'; entry.error = e.stack; entry.screenshot = await shot(`FAIL-${id}`).catch(() => null) }
  report.cases.push(entry)
  console.log(JSON.stringify(entry))
  return entry.status === 'PASS'
}
async function choose(item, cancel = false) {
  if (await page.getByRole('button', { name: '查看案例', exact: true }).count()) await click(page.getByRole('button', { name: '查看案例', exact: true }))
  const card = page.locator('.demo-gallery__card').filter({ has: page.getByRole('heading', { name: item.name, exact: true }) })
  await click(card.getByRole('button', { name: '加载到工作台' }))
  const dialog = page.getByRole('dialog')
  if (await dialog.count()) await click(dialog.getByRole('button', { name: cancel ? '取消' : '确认加载', exact: true }))
  if (!cancel) {
    await expect(workshop().locator('h1')).toHaveText(item.create().spec.name)
    await expect(page.getByLabel('当前应用来源')).toContainText(`离线应用示例 · ${item.name}`)
    await runMode()
    await expect(page.locator('.renderer-block--form')).toBeVisible()
  }
}
function info(item) {
  const state = item.create(), form = state.spec.blocks.find(b => b.type === 'form')
  const entity = state.spec.entities.find(e => e.id === state.spec.relations.find(r => r.blockId === form.id).entityId)
  const listBlock = state.spec.blocks.find(b => b.type === 'list' && state.spec.relations.find(r => r.blockId === b.id).entityId === entity.id)
  return { state, entity, form: page.locator('.renderer-block--form'), list: page.getByRole('region', { name: listBlock.name, exact: true }), rows: state.records[entity.id].length }
}
async function fill(item, marker) {
  const { entity, form } = info(item)
  for (const field of entity.fields) {
    const control = form.getByLabel(field.name, { exact: false })
    if (field.type === 'select' || field.type === 'boolean') await control.selectOption(field.type === 'boolean' ? 'true' : field.options[0])
    else await control.fill(field.type === 'date' ? '2026-10-19' : field.type === 'number' ? '7' : `${marker}-${field.id}`)
  }
}
async function snapshot() {
  return {
    title: await workshop().locator('h1').innerText(),
    source: await page.getByLabel('当前应用来源').innerText(),
    tables: await page.locator('.app-spec-preview-content tbody').allTextContents(),
    metrics: await page.locator('.app-spec-preview-content output').allTextContents(),
  }
}
async function showPrompt() {
  const details = page.locator('.ai-create-regenerate')
  if ((await details.getAttribute('open')) === null) await click(details.locator('summary'))
}
async function generate() {
  await showPrompt()
  await page.getByLabel('你想做什么软件？', { exact: true }).fill('稳定性测试：仅使用本地 Mock 响应')
  await click(page.locator('.ai-create-prompt button[type=submit]'))
}
async function main() {
  await fs.mkdir(path.join(out, 'screenshots'), { recursive: true })
  const vite = await import(pathToFileURL(require.resolve('vite')).href)
  server = await vite.preview({ root, preview: { host: '127.0.0.1', port: 5217, strictPort: true } })
  browser = await chromium.launch({ headless: true, ...(process.env.GALLERY_BROWSER_PATH ? { executablePath: process.env.GALLERY_BROWSER_PATH } : { channel: 'msedge' }) })
  report.browser = browser.version()
  for (width of [1440, 390]) {
    fault = 'none'; posts = 0; held = []
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      report.network.push({ width, method: request.method(), path: url.pathname, fault })
      if (url.hostname !== '127.0.0.1' || url.port !== '5217') { report.externalAttempts.push(url.origin); return route.abort() }
      if (url.pathname === '/api/mochi-ai/status') {
        if (fault === 'status-invalid') return route.fulfill({ contentType: 'application/json', body: '{bad' })
        return route.fulfill({ json: { enabled: false, proactiveEnabled: false, modificationsEnabled: false, reason: 'ACCESS_UNAVAILABLE' } })
      }
      if (url.pathname === '/api/ai/generate') {
        posts++
        if (fault === 'hold') { held.push(route); return }
        if (fault === 'network') return route.abort('internetdisconnected')
        if (fault === 'json') return route.fulfill({ contentType: 'application/json', body: '<html>bad gateway</html>' })
        if (fault === 'spec') return route.fulfill({ json: { version: 1, blocks: [] } })
        if (fault === 'oversize') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ padding: 'x'.repeat(132000) }) })
        if (fault === 'http503' || fault === 'http504') return route.fulfill({ status: fault === 'http503' ? 503 : 504, json: { error: { code: fault === 'http503' ? 'AI_UNAVAILABLE' : 'AI_TIMEOUT' } } })
        // Any unexpected generation is denied, never forwarded to a server.
        return route.abort('blockedbyclient')
      }
      if (url.pathname.startsWith('/api/') || request.method() !== 'GET') return route.abort('blockedbyclient')
      return route.continue()
    })
    page = await context.newPage()
    page.setDefaultTimeout(8000)
    page.on('pageerror', e => report.pageErrors.push({ width, text: e.message }))
    page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push({ width, fault, text: m.text() }) })
    await page.goto('http://127.0.0.1:5217/ai-create?gallery=1')
    await expect(page.locator('.demo-gallery__card')).toHaveCount(6)
    // One page/context per viewport: three complete cycles, with same-fixture reloads.
    for (let round = 1; round <= 3; round++) for (const item of DEMO_GALLERY) {
      await test(`cycle${round}-${item.id}`, async () => {
        await choose(item)
        const { form, list, rows } = info(item)
        await expect(list.locator('tbody tr')).toHaveCount(rows)
        await expect(page.locator('.app-spec-preview-content')).not.toContainText('STABILITY-')
        const baseline = await snapshot()
        // Blank submit must not create a row or change aggregation.
        await click(form.getByRole('button', { name: '提交', exact: true }))
        await expect(form.getByRole('alert')).toBeVisible()
        assert.deepEqual(await snapshot(), baseline)
        const marker = `STABILITY-${width}-${round}-${item.id}`
        await fill(item, marker)
        const submit = form.getByRole('button', { name: '提交', exact: true })
        // Actual two input events, not a direct runtime dispatch.
        if (width === 390) { await submit.tap(); await submit.tap() } else await submit.dblclick({ delay: 20 })
        await expect(list.locator('tbody tr')).toHaveCount(rows + 1)
        await expect(list.locator('tbody tr').filter({ hasText: marker })).toHaveCount(1)
        const created = await snapshot()
        await click(page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })); await runMode()
        assert.deepEqual(await snapshot(), created)
        await choose(item, true); assert.deepEqual(await snapshot(), created)
        await choose(item) // Same-fixture reset must be deterministic.
        assert.deepEqual(await snapshot(), baseline)
        if (round === 3) await shot(`cycle3-${item.id}`)
        const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
        assert.ok(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow))
        return { round, fixture: item.id, initialRows: rows, repeatedSubmitRows: rows + 1, sameFixtureReload: 'fresh initial rows and metrics', overflow }
      })
    }
    const item = DEMO_GALLERY[1]
    await choose(item); await fill(item, `STABILITY-preserve-${width}`)
    await click(info(item).form.getByRole('button', { name: '提交', exact: true }))
    const retained = await snapshot()
    await test('offline-loaded-page', async () => {
      await context.setOffline(true)
      await click(page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })); await runMode()
      assert.deepEqual(await snapshot(), retained)
      await fill(item, `STABILITY-offline-${width}`)
      await click(info(item).form.getByRole('button', { name: '提交', exact: true }))
      await expect(info(item).list.locator('tbody tr')).toHaveCount(info(item).rows + 2)
      await choose(DEMO_GALLERY[5]); await choose(item)
      await shot('offline-switch')
      return { network: 'Playwright context offline; already loaded JS', operations: 'B/C, create, fixture switch and return succeeded' }
    })
    await context.setOffline(false)
    // Preserve an edited row across each abnormal generation response.
    await fill(item, `STABILITY-error-${width}`); await click(info(item).form.getByRole('button', { name: '提交', exact: true }))
    const beforeFault = await snapshot()
    await test('whitespace-required-input', async () => {
      await fill(item, 'STABILITY-invalid')
      await info(item).form.getByLabel('科目', { exact: false }).fill('   ')
      await click(info(item).form.getByRole('button', { name: '提交', exact: true }))
      await expect(info(item).form.getByRole('alert')).toContainText('请填写科目')
      assert.deepEqual(await snapshot(), beforeFault)
      return { error: '请填写科目', preserved: true }
    })
    await test('invalid-number-input', async () => {
      await fill(item, 'STABILITY-invalid')
      const input = info(item).form.getByLabel('学习时长（分钟）', { exact: false })
      await input.fill(''); await input.pressSequentially('1e309')
      const browserValue = await input.inputValue()
      await click(info(item).form.getByRole('button', { name: '提交', exact: true }))
      await expect(info(item).form.getByRole('alert')).toBeVisible()
      assert.deepEqual(await snapshot(), beforeFault)
      return { typed: '1e309', browserValue, error: await info(item).form.getByRole('alert').innerText(), preserved: true }
    })
    for (const scenario of ['network', 'http503', 'http504', 'json', 'spec', 'oversize']) {
      await test(`mock-${scenario}`, async () => {
        fault = scenario
        const previousPosts = posts
        await generate()
        await expect(page.locator('.ai-create-error')).toBeVisible()
        await expect(page.locator('.ai-create-prompt button[type=submit]')).toBeEnabled()
        assert.equal(posts, previousPosts + 1)
        assert.deepEqual(await snapshot(), beforeFault)
        const error = await page.locator('.ai-create-error').innerText()
        await shot(`mock-${scenario}`)
        // Returning directly to the Gallery is the offline fallback after an error.
        await choose(DEMO_GALLERY[0]); await choose(item)
        await fill(item, `STABILITY-error-${width}`); await click(info(item).form.getByRole('button', { name: '提交', exact: true }))
        assert.deepEqual(await snapshot(), beforeFault)
        return { fault: scenario, mockPosts: 1, error, preserved: true, galleryFallback: 'PASS' }
      })
    }
    await test('pending-double-generate-cancel-recover', async () => {
      fault = 'hold'; const previousPosts = posts
      await showPrompt(); await page.getByLabel('你想做什么软件？', { exact: true }).fill('Mock hold')
      const submit = page.locator('.ai-create-prompt button[type=submit]')
      if (width === 390) await submit.tap(); else await submit.dblclick({ delay: 10 })
      await expect(submit).toBeDisabled(); assert.equal(posts, previousPosts + 1)
      await expect(page.getByRole('button', { name: '取消生成', exact: true })).toBeVisible()
      assert.deepEqual(await snapshot(), beforeFault)
      await click(page.getByRole('button', { name: '取消生成', exact: true }))
      await expect(submit).toBeEnabled()
      for (const route of held.splice(0)) await route.abort().catch(() => {})
      assert.deepEqual(await snapshot(), beforeFault)
      fault = 'none'; await choose(DEMO_GALLERY[0]); await choose(item)
      return { duplicateGenerationPosts: posts - previousPosts, cancellation: 'old app preserved; Gallery fallback works' }
    })
    await test('refresh-and-new-tab', async () => {
      fault = 'status-invalid'
      await page.reload(); await expect(page.locator('.demo-gallery__card')).toHaveCount(6)
      await expect(workshop()).toHaveCount(0)
      await choose(item)
      await expect(info(item).list.locator('tbody tr')).toHaveCount(info(item).rows)
      await expect(page.locator('.app-spec-preview-content')).not.toContainText('STABILITY-')
      await shot('refresh-recovered')
      fault = 'none'
      const clean = await context.newPage(); const old = page; page = clean
      try {
        await page.goto('http://127.0.0.1:5217/ai-create?gallery=1'); await choose(item)
        await expect(info(item).list.locator('tbody tr')).toHaveCount(info(item).rows)
      } finally { await clean.close(); page = old }
      return { refresh: 'in-memory edits cleared as disclosed; reload fixture restores initial data', malformedStatus: 'Gallery usable', newPage: 'no row contamination' }
    })
    await context.close()
  }
  assert.deepEqual(report.pageErrors, [])
  assert.deepEqual(report.externalAttempts, [])
  report.expectedConsoleErrors = report.consoleErrors.filter(e =>
    (e.fault === 'network' && e.text.includes('ERR_INTERNET_DISCONNECTED')) ||
    (e.fault === 'http503' && e.text.includes('503')) ||
    (e.fault === 'http504' && e.text.includes('504')))
  report.unexpectedConsoleErrors = report.consoleErrors.filter(e => !report.expectedConsoleErrors.includes(e))
  assert.deepEqual(report.unexpectedConsoleErrors, [])
}
main().catch(e => { report.fatal = e.stack; console.error(e); process.exitCode = 1 }).finally(async () => {
  report.finished = new Date().toISOString()
  report.summary = { pass: report.cases.filter(c => c.status === 'PASS').length, fail: report.cases.filter(c => c.status === 'FAIL').length }
  if (report.summary.fail) process.exitCode = 1
  await fs.writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2))
  await browser?.close()
  await server?.close()
  console.log(JSON.stringify({ summary: report.summary, fatal: report.fatal, pageErrors: report.pageErrors, externalAttempts: report.externalAttempts }))
})
