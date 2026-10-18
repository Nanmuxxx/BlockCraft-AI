// Native Chromium default context + noDefaults:true: no Playwright focus/visibility override.
// Verifies real hidden tabs, and deliberate interval throttling.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { mkdtemp, readFile, rm, mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, 'docs/acceptance/trusted-interactive')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function run() {
  const { createServer } = await import('vite')
  const vite = await createServer({ root, server: { host: '127.0.0.1', port: 5201, strictPort: true } })
  const directory = await mkdtemp(path.join(os.tmpdir(), 'blockcraft-p0-native-chromium-'))
  const proc = spawn(chromium.executablePath(), ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${directory}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank'], { stdio: 'ignore' })
  let browser
  const cases = [], errors = []
  try {
    await vite.listen(); await mkdir(output, { recursive: true })
    let port
    for (let n = 0; n < 100; n++) {
      try { port = (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break }
      catch { await sleep(100) }
    }
    assert.ok(port, 'Native Chromium CDP endpoint available')
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
    const context = browser.contexts()[0]
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.hostname === '127.0.0.1' || url.protocol === 'about:') return route.continue()
      errors.push(`Unexpected external request ${url.origin}`); return route.abort()
    })
    for (const width of [1440, 390]) {
      const page = await context.newPage(), cover = await context.newPage()
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      page.on('pageerror', error => errors.push(error.message))
      await page.addInitScript(() => {
        window.__timerTicks = 0
        const original = window.setInterval.bind(window)
        window.setInterval = (callback, delay, ...args) => original(() => {
          if (delay === 100) window.__timerTicks++
          callback(...args)
        }, delay === 100 ? 2000 : delay)
      })
      await page.goto('http://127.0.0.1:5201/tests/trusted-interactive/reliability.html')
      await page.bringToFront()
      await expect(page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      const timer = page.getByRole('region', { name: '可靠性番茄钟', exact: true })
      const remaining = timer.getByLabel('剩余时间'), status = timer.locator('p[role="status"]')
      const start = timer.getByRole('button', { name: '开始', exact: true })
      const pause = timer.getByRole('button', { name: '暂停', exact: true })
      const reset = timer.getByRole('button', { name: '重置', exact: true })
      const snapshot = async () => JSON.parse(await page.getByTestId('reliability-snapshot').textContent())
      const initial = await snapshot()
      await expect(remaining).toHaveText('00:06')
      // Duplicate real mouse clicks must not restart an active timer.
      await start.scrollIntoViewIfNeeded()
      const box = await start.boundingBox()
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2, { delay: 10 })
      await expect.poll(async () => (await snapshot()).revision).toBe(initial.revision + 1)
      const started = await snapshot()
      assert.equal(started.revision, initial.revision + 1)
      await pause.click(); const paused = await snapshot()
      await sleep(1100); assert.deepEqual((await snapshot()).timers, paused.timers)
      for (let i = 0; i < 5; i++) { await start.click(); await pause.click(); await reset.click() }
      await expect(remaining).toHaveText('00:06')
      // Observe one completed DISPLAY transition per reset/start cycle, not an event/notification API.
      await status.evaluate(element => {
        window.__completionTransitions = 0; window.__lastCompletion = false
        new MutationObserver(() => {
          const complete = element.textContent === '本轮专注已完成'
          if (complete && !window.__lastCompletion) window.__completionTransitions++
          window.__lastCompletion = complete
        }).observe(element, { childList: true, characterData: true, subtree: true })
      })
      await start.click()
      const running = await snapshot(), beforeBackgroundTicks = await page.evaluate(() => window.__timerTicks)
      await cover.goto('about:blank'); await cover.bringToFront()
      assert.equal(await page.evaluate(() => document.visibilityState), 'hidden', 'Real browser background tab')
      await sleep(2400)
      await page.bringToFront()
      assert.equal(await page.evaluate(() => document.visibilityState), 'visible')
      await expect(remaining).not.toHaveText('00:06')
      const observed = await remaining.textContent()
      const time = observed.split(':').map(Number), displayMs = (time[0] * 60 + time[1]) * 1000
      const anchor = running.timers['reliable-timer']
      const expectedMs = Math.max(0, anchor.remainingMs - (Date.now() - anchor.startedAt))
      const errorMs = Math.abs(displayMs - expectedMs)
      assert.ok(errorMs <= 1100, `Recovery display rounding error ${errorMs}`)
      assert.equal((await snapshot()).revision, running.revision, 'Background/refresh must not commit')
      await pause.click(); await reset.click()
      // Finish while actually hidden, restore, and wait through further callbacks.
      await start.click(); const completionRun = await snapshot()
      await cover.bringToFront()
      assert.equal(await page.evaluate(() => document.visibilityState), 'hidden')
      await sleep(6600)
      await page.bringToFront()
      await expect(status).toHaveText('本轮专注已完成')
      await expect(remaining).toHaveText('00:00')
      await expect(start).toBeDisabled()
      await expect(pause).toBeDisabled()
      const firstCompletion = await page.evaluate(() => window.__completionTransitions)
      assert.equal(firstCompletion, 1)
      await sleep(2200)
      assert.equal(await page.evaluate(() => window.__completionTransitions), 1)
      assert.equal((await snapshot()).revision, completionRun.revision)
      const after = await snapshot()
      assert.deepEqual(after.records, initial.records)
      assert.deepEqual(after.spec, initial.spec)
      assert.deepEqual(after.blockPositions, initial.blockPositions)
      // Existing Viewer stays unavailable, even with a forged runnable observation.
      const denied = page.getByTestId('untrusted-viewer')
      await expect(denied.locator('[data-viewer-status]')).toHaveAttribute('data-viewer-status', 'unavailable')
      await expect(denied).toContainText('暂时无法运行或交互')
      assert.equal(await page.locator('iframe').count(), 0)
      await timer.screenshot({ path: path.join(output, `reliability-completed-${width}.png`) })
      await reset.click(); await expect(remaining).toHaveText('00:06')
      const result = { width, realVisibility: ['visible', 'hidden', 'visible'], intervalPolicy: '100ms repaint callbacks deliberately slowed to 2000ms', recoveryDisplayErrorMs: Math.round(errorMs), beforeBackgroundTicks,
        completionDisplayTransitions: firstCompletion, completedOwnerWrites: 0, oldRecordsAndBlocksPreserved: true, forgedRunnableViewer: 'unavailable', checks: ['start-pause-resume-reset', 'real-double-click', 'five-rapid-cycles', 'paused-anchor-stable', 'real-hidden-tab-resume', 'deliberate-20x-throttle', 'hidden-tab-completion-once', 'read-only-derived-completion', 'old-data-preserved', 'untrusted-viewer-denied'] }
      cases.push(result)
      await cover.close(); await page.close()
    }
    assert.deepEqual(errors, [])
    await writeFile(path.join(output, 'reliability-browser-results.json'), JSON.stringify({ browser: await browser.version(), method: 'native Chromium headless default context; connectOverCDP noDefaults:true; no synthetic document.visibilityState', paidCalls: 0, cases, errors,
      limits: ['No audio, Notification API, service worker or OS alarm implemented.', 'Completion is a stable derived UI transition, not a durable exactly-once business event.', 'Second display rounds up; restore repaint is browser-scheduled.', 'System clock changes can affect wall-clock anchors; no monotonic/OS sleep guarantee.', 'No long-duration five-minute intensive-throttling, renderer-freeze, or real mobile device/OS-sleep acceptance.'] }, null, 2) + '\n')
    console.log(JSON.stringify({ passed: cases.length, realHiddenTabs: true, deliberateThrottle: '20x', paidCalls: 0, errors }))
  } finally {
    await browser?.close(); proc.kill(); await vite.close(); await rm(directory, { recursive: true, force: true })
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
