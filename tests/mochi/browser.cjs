// Real Chromium, real Workshop/Runtime. Fixed Mock only in the explicit test fixture.
// Requires Playwright on NODE_PATH (same optional setup as generation/browser.cjs).
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { existsSync, readFileSync, realpathSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const output = process.env.MOCHI_QA_OUTPUT || path.join(root, '.cache/mochi-browser/evidence')
async function run() {
  const { createServer } = await import(pathToFileURL(require.resolve('vite')).href)
  const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)
  const { localProjectExportPlugin } = await import(pathToFileURL(path.join(root, 'server/project-export/vite-plugin.mjs')).href)
  const alias = ['react', 'react-dom', 'lucide-react', '@fontsource/pixelify-sans'].map(name => ({ find: new RegExp(`^${name}(/|$)`), replacement: path.dirname(require.resolve(`${name}/package.json`)).replaceAll('\\', '/') + '$1' }))
  const localNodeModules = path.join(root, 'node_modules')
  const vite = await createServer({ root, configFile: false, cacheDir: path.join(root, '.cache', 'mochi-host-browser'), resolve: { alias }, optimizeDeps: { include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'lucide-react'] }, server: { host: '127.0.0.1', port: 5197, strictPort: true, proxy: {}, fs: { allow: [root, ...(existsSync(localNodeModules) ? [realpathSync(localNodeModules)] : []), path.dirname(require.resolve('@fontsource/pixelify-sans/500.css')), ...alias.map(item => item.replacement.slice(0, -2))] } },
    plugins: [react(), localProjectExportPlugin(), { name: 'offline-mochi-qa-only', configureServer(server) {
      server.middlewares.use('/__mochi', async (_req, res, next) => {
        try {
          const html = await server.transformIndexHtml('/__mochi', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/mochi/fixture.tsx"></script></body></html>')
          res.setHeader('Content-Type', 'text/html'); res.end(html)
        } catch (error) { next(error) }
      })
    } }] })
  let browser
  const sourceFiles = execFileSync('git', ['ls-files', '-z', '--', 'src', 'tests'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const fingerprint = () => Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')]))
  const report = { startedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)],
    baseline: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceBefore: fingerprint(),
    browser: process.env.MOCHI_QA_BROWSER_PATH || 'Chromium', browserVersion: null, touchDevice: false,
    planProvider: process.env.MOCHI_QA_MODEL_PLAN === '1' ? 'bounded JSON completion fixture (zero model calls)' : 'fixed mock',
    cases: [], scenarios: [], errors: [], consoleErrors: [], blockedRequests: [] }
  let activePage
  try {
    await mkdir(output, { recursive: true }); await vite.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.MOCHI_QA_BROWSER_PATH, args: ['--disable-background-networking'] })
    report.browserVersion = browser.version()
    for (const [width, height] of [[1366, 768], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, serviceWorkers: 'block' })
      activePage = page
      await page.route('**/*', route => {
        const request = route.request(), target = new URL(request.url())
        // The production #32 panel checks status on mount; keep it offline and disabled.
        if (target.origin === 'http://127.0.0.1:5197' && target.pathname === '/api/mochi-ai/status' && request.method() === 'GET') return route.fulfill({ json: { enabled: false, proactiveEnabled: false, modificationsEnabled: false, reason: 'ACCESS_UNAVAILABLE' } })
        if (target.origin === 'http://127.0.0.1:5197' && request.method() === 'GET' && !target.pathname.startsWith('/api')) return route.continue()
        report.blockedRequests.push({ url: target.href, method: request.method() })
        return route.abort('blockedbyclient')
      })
      page.on('pageerror', error => report.errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ width, text: message.text(), location: message.location() }) })
      page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`) })
      let outbound = 0
      page.on('request', req => { if (!new URL(req.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) outbound++ })
      const url = 'http://127.0.0.1:5197/__mochi'
      const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })
      const c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
      const block = page.locator('[data-block-key="builtin:registration-form"]')
      const input = page.getByRole('textbox', { name: '给 Mochi 发消息' })
      const send = page.locator('.mochi-ai').getByRole('button', { name: '发送', exact: true })
      const preview = page.getByRole('region', { name: '修改计划预览' })
      const state = () => page.evaluate(() => ({ snapshot: window.mochiQA.runtime.getSnapshot(), subscriptions: window.mochiQA.subscriptions, calls: window.mochiQA.calls, instance: window.mochiQA.host?.getSnapshot().context.instanceId }))
      const request = async (text = '固定测试计划') => { await input.fill(text); await send.click() }
      await page.goto(url + '?production')
      await expect(input).toBeDisabled()
      await expect(page.getByText(/AI 修改能力尚未启用：DeepSeek/)).toBeVisible()
      await expect(page.locator('.mochi-ai')).toHaveCount(1)
      const prod = await state()
      for (let i = 0; i < 3; i++) { await c.click(); await b.click() }
      assert.equal((await state()).subscriptions, prod.subscriptions, 'StrictMode and mode switches do not leak subscriptions')
      assert.equal((await state()).calls, 0)
      assert.equal(outbound, 0)
      await page.screenshot({ path: path.join(output, `production-${width}.png`), fullPage: true })
      await page.goto(url + (process.env.MOCHI_QA_MODEL_PLAN === '1' ? '?model-plan' : ''))
      await block.click()
      await expect(page.locator('.mochi-overlay')).toBeVisible()
      const original = await state()
      await page.getByRole('button', { name: '忽略建议：为表单补充联系方式', exact: true }).click()
      await expect(page.getByRole('button', { name: '忽略建议：为表单补充联系方式', exact: true })).toHaveCount(0)
      assert.deepEqual((await state()).snapshot, original.snapshot, 'ignore only dismisses the suggestion')
      // Cancel in-flight requests whose provider ignores abort, then settle them
      // after a newer preview. Both resolve and reject must leave the new UI intact.
      for (const lateFailure of [false, true]) {
        const pendingIndex = await page.evaluate(() => { window.mochiQA.defer = true; return window.mochiQA.pending.length })
        await request(`取消在途 ${lateFailure}`)
        await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'REQUESTING')
        await c.click(); await b.click()
        await expect(page.getByRole('button', { name: '取消请求', exact: true })).toBeVisible()
        await page.screenshot({ path: path.join(output, `requesting-${lateFailure}-${width}.png`), fullPage: true })
        await page.getByRole('button', { name: '取消请求', exact: true }).click()
        await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'CANCELLED')
        // Keep the next provider pending while the old promise settles: an old
        // catch/finally must not unlock the composer or overwrite the new request.
        const nextIndex = await page.evaluate(() => window.mochiQA.pending.length)
        await request('较新的有效计划')
        await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'REQUESTING')
        const newer = await page.evaluate(() => window.mochiQA.host.getSnapshot().requestId)
        await page.evaluate(async ({ index, failure }) => {
          window.mochiQA.pending[index][failure ? 'reject' : 'resolve']()
          await Promise.resolve(); await Promise.resolve()
        }, { index: pendingIndex, failure: lateFailure })
        await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'REQUESTING')
        assert.equal(await page.evaluate(() => window.mochiQA.host.getSnapshot().requestId), newer)
        await expect(input).toBeDisabled(); await expect(send).toBeDisabled()
        const calls = (await state()).calls
        await page.locator('.mochi-ai__composer').evaluate(form => form.requestSubmit())
        assert.equal((await state()).calls, calls, 'obsolete completion cannot unlock a newer submission')
        await expect(page.locator('.mochi-ai').getByRole('alert')).toHaveCount(0)
        await page.evaluate(async index => { window.mochiQA.defer = false; window.mochiQA.pending[index].resolve(); await Promise.resolve(); await Promise.resolve() }, nextIndex)
        await expect(preview).toBeVisible()
        report.scenarios.push({ id: `F1-late-${lateFailure ? 'failure' : 'success'}`, width, result: 'PASS', newerRequestId: newer, providerCalls: calls })
        await expect(input).toHaveValue('较新的有效计划')
        assert.deepEqual((await state()).snapshot, original.snapshot)
        await page.getByRole('button', { name: '取消', exact: true }).click()
      }
      const replacementIndex = await page.evaluate(() => { window.mochiQA.defer = true; return window.mochiQA.pending.length })
      await request('旧 host 的请求')
      await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'REQUESTING')
      const oldInstance = (await state()).instance
      await page.evaluate(() => window.mochiQA.replaceHost())
      await expect.poll(async () => (await state()).instance).not.toBe(oldInstance)
      await expect(input).toHaveValue('')
      await page.evaluate(async index => { window.mochiQA.defer = false; window.mochiQA.pending[index].reject(); await Promise.resolve(); await Promise.resolve() }, replacementIndex)
      await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'IDLE')
      await expect(page.locator('.mochi-ai').getByRole('alert')).toHaveCount(0)
      await block.click()
      const activeInstance = (await state()).instance
      await request()
      await expect(preview).toBeVisible()
      assert.deepEqual((await state()).snapshot, original.snapshot, 'preview makes zero writes')
      const cancelledId = await page.evaluate(() => window.mochiQA.host.getSnapshot().preview.planId)
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await expect(preview).toHaveCount(0)
      const cancelCode = await page.evaluate(async id => { try { await window.mochiQA.host.callbacks.onConfirm(id) } catch (e) { return e.code } }, cancelledId)
      assert.equal(cancelCode, 'PLAN_NOT_PENDING')
      assert.deepEqual((await state()).snapshot, original.snapshot)
      await request()
      await expect(preview).toBeVisible()
      const staleId = await page.evaluate(() => window.mochiQA.host.getSnapshot().preview.planId)
      await page.locator('[data-block-key="builtin:applicant-list"]').click()
      await expect(preview).toHaveCount(0)
      await page.screenshot({ path: path.join(output, `stale-${width}.png`), fullPage: true })
      const staleCode = await page.evaluate(async id => { try { await window.mochiQA.host.callbacks.onConfirm(id) } catch (e) { return e.code } }, staleId)
      assert.equal(staleCode, 'PLAN_NOT_PENDING')
      await block.click()
      await request()
      await expect(preview).toBeVisible()
      const modePlan = await page.evaluate(() => window.mochiQA.host.getSnapshot().preview.planId)
      await c.click(); await b.click()
      await expect(preview).toBeVisible()
      assert.equal(await page.evaluate(() => window.mochiQA.host.getSnapshot().preview.planId), modePlan)
      const beforeInvalid = await state()
      await request('x'.repeat(4001))
      await expect(page.locator('.mochi-ai').getByRole('alert')).toContainText('INVALID_PROMPT')
      await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'PREVIEW')
      assert.equal(await page.evaluate(() => window.mochiQA.host.getSnapshot().preview.planId), modePlan)
      assert.equal((await state()).calls, beforeInvalid.calls, 'invalid input never reaches provider')
      assert.deepEqual((await state()).snapshot, beforeInvalid.snapshot)
      await page.screenshot({ path: path.join(output, `f1-invalid-preview-${width}.png`), fullPage: true })
      await request('修正后的合法输入')
      await expect(preview).toBeVisible()
      await expect(page.locator('.mochi-ai').getByRole('alert')).toHaveCount(0)
      const correctedPlan = await page.evaluate(() => window.mochiQA.host.getSnapshot().preview.planId)
      assert.notEqual(correctedPlan, modePlan)
      assert.equal((await state()).calls, beforeInvalid.calls + 1)
      assert.deepEqual((await state()).snapshot, beforeInvalid.snapshot)
      await page.screenshot({ path: path.join(output, `f1-corrected-preview-${width}.png`), fullPage: true })
      report.scenarios.push({ id: 'F1-invalid-input-and-retry', width, result: 'PASS', preservedPlanId: modePlan, correctedPlanId: correctedPlan, revision: beforeInvalid.snapshot.revision })
      await page.screenshot({ path: path.join(output, `preview-${width}.png`), fullPage: true })
      const confirmedId = await page.evaluate(() => window.mochiQA.host.getSnapshot().preview.planId)
      await page.getByRole('button', { name: '确认', exact: true }).dblclick()
      await expect(preview).toHaveCount(0)
      await expect(page.getByText(/Runtime 已确认应用修改/)).toBeVisible()
      await page.screenshot({ path: path.join(output, `applied-${width}.png`), fullPage: true })
      const committed = await state()
      assert.equal(committed.snapshot.revision, original.snapshot.revision + 1)
      assert.deepEqual(committed.snapshot.records, original.snapshot.records)
      await page.evaluate(id => window.mochiQA.host.callbacks.onConfirm(id), confirmedId)
      assert.deepEqual((await state()).snapshot, committed.snapshot, 'duplicate confirmation is idempotent')
      await c.click()
      await expect(page.getByRole('region', { name: '报名表', exact: true }).getByLabel('Mock 备注')).toBeVisible()
      await expect(page.getByRole('cell', { name: '小林', exact: true })).toBeVisible()
      await b.click()
      assert.equal((await state()).instance, activeInstance)
      assert.deepEqual((await state()).snapshot, committed.snapshot)
      assert.equal((await state()).subscriptions, original.subscriptions)
      // Real pointer movement in chat cannot move canvas blocks or mutate records.
      await page.locator('.mochi-ai__header').scrollIntoViewIfNeeded()
      const box = await page.locator('.mochi-ai__header').boundingBox()
      await page.mouse.move(box.x + 20, box.y + 15); await page.mouse.down()
      await page.mouse.move(box.x + 95, box.y + 15, { steps: 8 }); await page.mouse.up()
      assert.deepEqual((await state()).snapshot, committed.snapshot)
      // Failure after commit preserves the application, receipt and user draft.
      await page.evaluate(() => { window.mochiQA.failure = true })
      await request('失败后保留已确认应用')
      await expect(page.locator('.mochi-ai').getByRole('alert')).toContainText('PLAN_PROVIDER_FAILED')
      await expect(input).toHaveValue('失败后保留已确认应用')
      await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'REQUEST_FAILED')
      await expect(page.getByText(/本次修改已应用/)).toHaveCount(0)
      await expect(page.getByText(/历史成功回执版本/)).toBeVisible()
      await page.screenshot({ path: path.join(output, `request-failed-${width}.png`), fullPage: true })
      assert.deepEqual((await state()).snapshot, committed.snapshot)
      await expect(page.getByText(/Runtime 已确认应用修改/)).toBeVisible()
      // History follows only at the bottom; reading older messages stays anchored.
      const history = page.getByRole('region', { name: '对话记录', exact: true })
      // Earlier pointer/focus scenarios may scroll the panel. Establish the
      // follow-at-bottom precondition explicitly before checking new messages.
      await history.evaluate(e => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')) })
      await expect.poll(() => history.evaluate(e => e.scrollHeight - e.scrollTop - e.clientHeight)).toBeLessThan(25)
      for (let i = 0; i < 8; i++) {
        await request(`离线失败 ${i} ${'保留数据。'.repeat(25)}`)
        await expect(send).toBeEnabled()
        await expect.poll(() => history.evaluate(e => e.scrollHeight - e.scrollTop - e.clientHeight)).toBeLessThan(25)
      }
      assert.ok(await history.evaluate(e => e.scrollHeight > e.clientHeight))
      await expect.poll(() => history.evaluate(e => e.scrollHeight - e.scrollTop - e.clientHeight)).toBeLessThan(25)
      await history.evaluate(e => { e.scrollTop = 0; e.dispatchEvent(new Event('scroll')) })
      await request('查看历史时保持滚动位置')
      await expect(send).toBeEnabled()
      assert.equal(await history.evaluate(e => e.scrollTop), 0)
      // Center first: a viewport edge intentionally changes Mochi's safe side.
      await block.evaluate(e => e.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(120)
      await expect(page.locator('.mochi-overlay')).toHaveAttribute('data-locomotion', 'rest')
      await expect(page.locator('.mochi-overlay')).toBeVisible()
      {
        const delta = () => page.evaluate(() => {
          const block = document.querySelector('[data-block-key="builtin:registration-form"]').getBoundingClientRect()
          const overlay = document.querySelector('.mochi-overlay').getBoundingClientRect()
          return { x: overlay.x - block.x, y: overlay.y - block.y }
        })
        const before = await delta()
        await page.mouse.wheel(0, -65)
        await expect.poll(async () => Math.abs((await delta()).y - before.y)).toBeLessThan(2)
      }
      await block.scrollIntoViewIfNeeded()
      const dragBox = await block.boundingBox()
      await page.screenshot({ path: path.join(output, `before-drag-${width}.png`) })
      await page.mouse.move(dragBox.x + 45, dragBox.y + 35); await page.mouse.down()
      await page.mouse.move(dragBox.x + 75, dragBox.y + (width === 390 ? -45 : 105), { steps: 12 }); await page.mouse.up()
      await expect.poll(async () => (await state()).snapshot.revision).toBeGreaterThan(committed.snapshot.revision)
      assert.deepEqual((await state()).snapshot.records, committed.snapshot.records)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await page.locator('.mochi-ai__avatar-image').evaluate(e => getComputedStyle(e).animationName), 'none')
      assert.equal(await page.locator('.mochi-emotion__image').evaluate(e => getComputedStyle(e).animationName), 'none')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      assert.equal(overflow, false, `${width}px horizontal overflow`)
      await page.screenshot({ path: path.join(output, `integrated-${width}.png`), fullPage: true })
      await c.click()
      await expect(page.getByRole('cell', { name: '小林', exact: true })).toBeVisible()
      // Exercise UI classification against real planner/Runtime, including a
      // loss of a receipt after Runtime publication. No fake successful receipts.
      await page.evaluate(() => { window.mochiQA.failure = false })
      await request('明确提交失败')
      await expect(preview).toBeVisible()
      const beforeFailure = (await state()).snapshot
      await page.evaluate(() => {
        const runtime = window.mochiQA.runtime, original = runtime.executeCommand
        window.mochiQA.restoreExecution = () => { runtime.executeCommand = original }
        runtime.executeCommand = () => ({ ok: false, error: { code: 'OFFLINE_REJECTED', message: '明确拒绝，无写入' } })
      })
      await page.getByRole('button', { name: '确认', exact: true }).click()
      await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'COMMIT_FAILED')
      await expect(page.locator('.mochi-ai').getByRole('alert')).toContainText('OFFLINE_REJECTED')
      assert.deepEqual((await state()).snapshot, beforeFailure)
      await page.screenshot({ path: path.join(output, `commit-failed-${width}.png`), fullPage: true })
      await page.evaluate(() => window.mochiQA.restoreExecution())
      await request('提交后回执异常')
      await expect(preview).toBeVisible()
      const unknownId = await page.evaluate(() => {
        const runtime = window.mochiQA.runtime, original = runtime.executeCommand
        window.mochiQA.restoreExecution = () => { runtime.executeCommand = original }
        runtime.executeCommand = (...args) => { original(...args); throw new Error('Receipt unavailable AFTER Runtime write') }
        return window.mochiQA.host.getSnapshot().preview.planId
      })
      await page.getByRole('button', { name: '确认', exact: true }).click()
      await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'COMMIT_OUTCOME_UNKNOWN')
      await expect(page.locator('.mochi-ai').getByRole('alert')).toContainText('勿重试旧计划')
      assert.equal((await state()).snapshot.revision, beforeFailure.revision + 1)
      await expect(page.getByText('本次修改已应用', { exact: true })).toHaveCount(0)
      await page.screenshot({ path: path.join(output, `commit-unknown-${width}.png`), fullPage: true })
      const unknownCode = await page.evaluate(async id => {
        window.mochiQA.restoreExecution()
        try { await window.mochiQA.host.callbacks.onConfirm(id) } catch (error) { return error.code }
      }, unknownId)
      assert.equal(unknownCode, 'PLAN_NOT_PENDING')
      await request('漏收通知后的确认')
      await expect(preview).toBeVisible()
      const missed = await page.evaluate(() => {
        const qa = window.mochiQA, view = qa.host.getSnapshot()
        qa.missNextNotification = true
        let result
        try { result = qa.runtime.moveBlock('applicant-list', { x: 0.31, y: 0.41 }) } finally { qa.missNextNotification = false }
        return { result, missed: qa.host.getSnapshot() === view, beforeRevision: view.context.revision, snapshot: qa.runtime.getSnapshot() }
      })
      assert.equal(missed.result.ok, true)
      assert.equal(missed.missed, true)
      assert.equal(missed.snapshot.revision, missed.beforeRevision + 1)
      await page.getByRole('button', { name: '确认', exact: true }).click()
      await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'STALE')
      await expect(preview).toHaveCount(0)
      await expect(page.locator('.mochi-ai').getByRole('alert')).toContainText('CONTEXT_CHANGED')
      await expect(page.getByText('上下文已变化，请重新预览', { exact: true })).toBeVisible()
      assert.deepEqual((await state()).snapshot, missed.snapshot, 'stale confirmation makes no write')
      await page.screenshot({ path: path.join(output, `f2-missed-notification-stale-${width}.png`), fullPage: true })
      report.scenarios.push({ id: 'F2-missed-notification', width, result: 'PASS', ...missed })
      const unmountIndex = await page.evaluate(() => { window.mochiQA.defer = true; return window.mochiQA.pending.length })
      await request('卸载后的迟到响应')
      await expect(page.locator('.mochi-ai')).toHaveAttribute('data-phase', 'REQUESTING')
      const current = await state()
      await page.evaluate(() => window.mochiQA.unmount())
      await page.evaluate(async index => { window.mochiQA.pending[index].reject(); await Promise.resolve(); await Promise.resolve() }, unmountIndex)
      await expect(page.locator('.mochi-ai')).toHaveCount(0)
      assert.equal((await state()).subscriptions, 0, 'unmount releases all Runtime subscriptions')
      // Original Demo uses its fixed suggestion flow, independently of M1 Host.
      // Reload a fresh real route for each branch; no replacement Demo or mock UI.
      for (const action of ['cancel', 'confirm']) {
        await page.goto('http://127.0.0.1:5197/')
        await page.getByLabel('描述你想创造的软件').fill('学习管理 App')
        await page.getByRole('button', { name: '开始创造', exact: true }).click()
        await page.getByRole('heading', { name: '先确定最重要的功能' }).waitFor()
        await page.getByRole('group', { name: '选择优先关注的功能' }).getByRole('button').first().click()
        await page.getByRole('heading', { name: '我的学习助手', exact: true }).waitFor()
        const demoB = page.getByRole('button', { name: 'B 功能积木', exact: true })
        const demoC = page.getByRole('button', { name: 'C 应用预览', exact: true })
        await demoC.click()
        const tasks = page.getByRole('list', { name: '学习任务列表', exact: true })
        const beforeTasks = await tasks.getByRole('checkbox').evaluateAll(items => items.map(item => ({ checked: item.checked, title: item.closest('label').textContent })))
        const statsBefore = await page.getByRole('region', { name: '学习统计', exact: true }).innerText()
        await expect(page.getByRole('combobox', { name: /的优先级$/ })).toHaveCount(0)
        await demoB.click()
        await page.locator('[data-block-key="module:tasks"]').click()
        await expect(page.getByRole('region', { name: 'Mochi 建议', exact: true })).toBeVisible()
        if (action === 'cancel') {
          await page.getByRole('button', { name: '暂时不用', exact: true }).click()
          await expect(page.getByText('好的，我先不打扰你。之后仍可以从任务积木继续开始。', { exact: true })).toBeVisible()
        } else {
          await page.getByRole('button', { name: '帮我添加', exact: true }).dblclick()
          await expect(page.getByText('已启用任务优先级，可在 C 模式为每项任务选择高、中、低优先级。', { exact: true })).toHaveCount(1)
        }
        await page.screenshot({ path: path.join(output, `demo-${action}-feedback-${width}.png`), fullPage: true })
        await demoC.click()
        assert.deepEqual(await tasks.getByRole('checkbox').evaluateAll(items => items.map(item => ({ checked: item.checked, title: item.closest('label').textContent }))), beforeTasks)
        assert.equal(await page.getByRole('region', { name: '学习统计', exact: true }).innerText(), statsBefore)
        await expect(page.getByRole('combobox', { name: /的优先级$/ })).toHaveCount(action === 'confirm' ? beforeTasks.length : 0)
        if (action === 'confirm') {
          const priority = page.getByRole('combobox', { name: /的优先级$/ }).first()
          await priority.selectOption('high')
          await demoB.click(); await demoC.click()
          await expect(priority).toHaveValue('high')
        }
        await page.screenshot({ path: path.join(output, `demo-${action}-result-${width}.png`), fullPage: true })
        report.scenarios.push({ id: `legacy-demo-${action}`, width, result: 'PASS', beforeTasks, statsBefore, expectedPrioritySelectors: action === 'confirm' ? beforeTasks.length : 0 })
      }
      assert.equal(outbound, 0)
      report.cases.push({ width, height, passed: true, confirmedRevision: committed.snapshot.revision, finalRevision: current.snapshot.revision, networkCalls: outbound,
        checks: ['production disabled', 'single host/UI', 'StrictMode cleanup', 'preview zero writes', 'cancel/reselect invalidation', 'B/C preserves plan', 'request cancel/late resolve/reject isolation', 'host replacement isolation', 'late failure after unmount', 'explicit commit failure', 'post-write subscriber exception is UNKNOWN', 'duplicate confirmation', 'real receipt', 'B/C records', 'ignore suggestion', 'chat drag isolation', 'canvas drag', 'error retains committed app/draft', 'history scroll anchor', 'overlay scroll anchor', 'reduced motion', 'no horizontal overflow'] })
      await page.close()
    }
    assert.deepEqual(report.errors, [])
    assert.deepEqual(report.consoleErrors, [], 'console.error listener recorded no errors')
    assert.deepEqual(report.blockedRequests, [], 'No unexpected network attempts')
    report.sourceAfter = fingerprint(); report.finishedAt = new Date().toISOString()
    assert.deepEqual(report.sourceAfter, report.sourceBefore, 'evidence matches unchanged tested source')
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    report.errors.push(error.stack || String(error))
    if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    throw error
  } finally { await browser?.close(); await vite.close() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
