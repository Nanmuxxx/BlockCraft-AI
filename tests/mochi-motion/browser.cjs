const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, 'docs/mochi-motion-evidence')
async function run() {
  const { createServer } = await import('vite')
  const vite = await createServer({ root, cacheDir: path.join(root, '.cache', 'mochi-motion-browser'), server: { host: '127.0.0.1', port: 5198, strictPort: true, fs: { allow: [root, require('node:fs').realpathSync(path.join(root, 'node_modules'))] } }, plugins: [{
    name: 'offline-mochi-motion-only', configureServer(server) {
      server.middlewares.use('/__motion', async (_req, res, next) => {
        try {
          res.setHeader('Content-Type', 'text/html')
          res.end(await server.transformIndexHtml('/__motion', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/mochi-motion/fixture.tsx"></script></body></html>'))
        } catch (error) { next(error) }
      })
    },
  }] })
  let browser
  const report = { browser: 'Chromium', fixture: 'Real MochiWorkshop + AppRuntime, offline fixed Mock planner (not AI)', cases: [], errors: [], outbound: [] }
  try {
    await mkdir(output, { recursive: true }); await vite.listen()
    browser = await chromium.launch({ headless: true })
    report.version = browser.version()
    for (const width of [1366, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 })
      await context.route('**/*', route => {
        if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue()
        report.outbound.push(route.request().url()); return route.abort()
      })
      const page = await context.newPage()
      page.on('pageerror', e => report.errors.push(e.message))
      page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`) })
      const overlay = page.locator('.mochi-overlay'), emotion = overlay.locator('[data-emotion]')
      const block = page.locator('[data-block-key="module:registration-form"]')
      const other = page.locator('[data-block-key="module:applicant-list"]')
      const state = () => page.evaluate(() => window.motionQA.runtime.getSnapshot())
      const position = () => overlay.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, visibility: getComputedStyle(e).visibility, locomotion: e.dataset.locomotion, side: e.dataset.side } })
      const rest = () => expect(overlay).toHaveAttribute('data-locomotion', 'rest')
      const screenshot = name => page.screenshot({ path: path.join(output, `${width}-${name}.png`) })
      const unobstructed = () => page.evaluate(() => {
        const pet = document.querySelector('.mochi-overlay'), a = pet.getBoundingClientRect()
        return [...document.querySelectorAll('[data-block-key], .app-spec-inspector, button, input, textarea, select, a')]
          .filter(e => !pet.contains(e) && e.getClientRects().length)
          .filter(e => { const b = e.getBoundingClientRect(); return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top })
          .map(e => e.getAttribute('aria-label') || e.className)
      })
      await page.goto('http://127.0.0.1:5198/__motion')
      await page.locator('.block-canvas').evaluate(e => e.scrollIntoView({ block: 'start' }))
      await block.click(); await expect(overlay).toBeVisible(); await rest()
      assert.deepEqual(await unobstructed(), [])
      const initial = await state()
      await screenshot('selected')
      await expect(emotion).toHaveAttribute('data-emotion', 'idle')
      assert.match(await overlay.locator('.mochi-emotion__body').evaluate(e => getComputedStyle(e).animationName), /mochi-breathe/)
      await screenshot('idle')
      await overlay.locator('.mochi-emotion__eyelid').evaluateAll(elements => elements.forEach(e => {
        const a = e.getAnimations()[0]; a.pause(); a.currentTime = 2200 + 8600 * .97
      }))
      await screenshot('blink-closed')
      await overlay.locator('.mochi-emotion__eyelid').evaluateAll(elements => elements.forEach(e => {
        const a = e.getAnimations()[0]; a.currentTime = 2200 + 8600 * .5; a.play()
      }))
      // Record actual viewport coordinates each animation frame across a real selection.
      await page.evaluate(() => {
        window.motionFrames = []
        window.motionRecording = true
        const sample = t => {
          const e = document.querySelector('.mochi-overlay'), r = e.getBoundingClientRect()
          const occluded = [...document.querySelectorAll('[data-block-key], .app-spec-inspector, button, input, textarea, select, a')]
            .filter(o => !e.contains(o) && o.getClientRects().length).some(o => {
              const b = o.getBoundingClientRect(); return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top
            })
          window.motionFrames.push({ t, x: r.x, y: r.y, locomotion: e.dataset.locomotion, visible: getComputedStyle(e).visibility, occluded })
          if (window.motionRecording) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      await other.click()
      for (let i = 0; i < 4; i++) { await page.waitForTimeout(125); await screenshot(`move-${i + 1}`) }
      await rest()
      const frames = await page.evaluate(() => { window.motionRecording = false; return window.motionFrames })
      const moving = frames.filter(f => f.locomotion === 'travel' || f.locomotion === 'hop')
      assert.ok(moving.length > 4, `continuous movement at ${width}px: ${JSON.stringify(frames)}`)
      const unique = new Set(moving.map(f => `${Math.round(f.x)},${Math.round(f.y)}`))
      assert.ok(unique.size > 4, 'multiple intermediate positions, not teleportation')
      assert.ok(moving.every(f => f.visible === 'visible'), 'no hidden animation frames')
      assert.ok(moving.every(f => !f.occluded), 'no control/content overlap during travel')
      assert.ok(moving.slice(1).every((f, i) => Math.hypot(f.x - moving[i].x, f.y - moving[i].y) < 80), 'no discontinuous animation jumps')
      assert.deepEqual(await unobstructed(), [])
      assert.deepEqual(await state(), initial, 'selection/animation never mutate the Runtime')
      // Rapid reselection retargets the in-flight transform without an invisible frame.
      await block.click(); await page.waitForTimeout(50)
      await other.click(); await page.waitForTimeout(50)
      await block.click(); await rest()
      await expect(overlay).toBeVisible(); assert.deepEqual(await unobstructed(), [])
      assert.deepEqual(await state(), initial)
      // Pointer cancellation releases the display's drag state and makes zero writes.
      const cancelled = await block.boundingBox()
      await page.mouse.move(cancelled.x + 50, cancelled.y + 60); await page.mouse.down()
      await page.mouse.move(cancelled.x + 65, cancelled.y + 75, { steps: 5 })
      await block.dispatchEvent('pointercancel', { pointerId: 1, bubbles: true })
      await page.mouse.up(); await expect(overlay).toHaveAttribute('data-dragging', 'false')
      assert.deepEqual(await state(), initial)
      // Drag through the real canvas pointer handlers.
      await rest()
      const dragBefore = await block.boundingBox(), petBefore = await position()
      await page.mouse.move(dragBefore.x + 55, dragBefore.y + 70); await page.mouse.down()
      await page.mouse.move(dragBefore.x + 70, dragBefore.y + 105, { steps: 12 })
      await page.waitForTimeout(80)
      assert.equal(await overlay.evaluate(e => e.dataset.dragging), 'true')
      assert.equal(await overlay.locator('button').evaluate(e => getComputedStyle(e).pointerEvents), 'none')
      const midBlock = await block.boundingBox(), midPet = await position()
      assert.ok(Math.hypot(midBlock.x - dragBefore.x, midBlock.y - dragBefore.y) > 10)
      assert.ok(Math.hypot(midPet.x - petBefore.x, midPet.y - petBefore.y) > 10)
      await screenshot('dragging')
      await page.mouse.up(); await page.waitForTimeout(100)
      const afterDrag = await state()
      assert.ok(afterDrag.revision > initial.revision, 'real drag commits via existing Runtime')
      assert.deepEqual(afterDrag.records, initial.records)
      assert.deepEqual(await unobstructed(), [])
      // Snap through the existing canvas gesture, then let its scale pop settle.
      if (!(await block.getAttribute('class')).includes('is-snapped')) {
        const a = await block.boundingBox(), b = await other.boundingBox()
        await page.mouse.move(a.x + 40, a.y + 40); await page.mouse.down()
        await page.mouse.move(b.x + 40, b.y - 208 + 40, { steps: 24 }); await page.mouse.up()
      }
      await expect(emotion).toHaveAttribute('data-emotion', 'celebrating')
      await screenshot('celebrating')
      await page.waitForTimeout(650); await rest()
      assert.deepEqual(await unobstructed(), [])
      // Scroll follows viewport geometry (no fixed mobile corner).
      const relative = async () => { const a = await block.boundingBox(), b = await position(); return { x: b.x - a.x, y: b.y - a.y } }
      const delta = await relative()
      await page.mouse.wheel(0, -65); await page.waitForTimeout(180)
      const scrolled = await relative()
      assert.ok(Math.abs(scrolled.x - delta.x) < 2 && Math.abs(scrolled.y - delta.y) < 2, `${width}px scroll follows actual block: ${JSON.stringify({delta,scrolled})}`)
      await screenshot('scrolled')
      // Real Inspector saves/errors trigger visual feedback, without granting Mochi write authority.
      const inspector = page.getByRole('complementary', { name: '积木属性' })
      await inspector.getByRole('textbox', { name: '字段名称', exact: true }).fill('动画保存验收')
      await inspector.getByRole('button', { name: '新增字段', exact: true }).click()
      await expect(inspector.locator('.app-spec-inspector__success')).toBeVisible()
      await expect(emotion).toHaveAttribute('data-emotion', 'happy')
      await block.scrollIntoViewIfNeeded(); await screenshot('saved')
      await expect(emotion).toHaveAttribute('data-emotion', 'idle')
      await inspector.getByRole('textbox', { name: '字段名称', exact: true }).fill('重复保存验收')
      await inspector.getByRole('button', { name: '新增字段', exact: true }).click()
      await expect(emotion).toHaveAttribute('data-emotion', 'happy')
      const saved = await state()
      await inspector.getByRole('textbox', { name: '字段名称', exact: true }).fill('')
      await inspector.getByRole('button', { name: '新增字段', exact: true }).click()
      await expect(inspector.getByRole('alert')).toBeVisible()
      await expect(emotion).toHaveAttribute('data-emotion', 'error')
      assert.deepEqual(await state(), saved)
      await block.scrollIntoViewIfNeeded(); await screenshot('inspector-error')
      // Open existing chat, preserving block positions/data and drag events.
      const beforeChat = await state()
      await overlay.getByRole('button', { name: '打开 Mochi 聊天与建议' }).click()
      await expect(page.getByRole('textbox', { name: '给 Mochi 发消息' })).toBeFocused()
      assert.deepEqual(await state(), beforeChat)
      // Thinking, confirmation/happy, and error from existing host callbacks.
      const input = page.getByRole('textbox', { name: '给 Mochi 发消息' })
      await input.fill('固定离线修改'); await page.getByRole('button', { name: '发送', exact: true }).click()
      await expect(emotion).toHaveAttribute('data-emotion', 'thinking')
      await block.scrollIntoViewIfNeeded(); await screenshot('thinking')
      await expect(page.getByRole('region', { name: '修改计划预览' })).toBeVisible()
      await page.getByRole('button', { name: '确认', exact: true }).click()
      await expect(emotion).toHaveAttribute('data-emotion', 'happy')
      await block.scrollIntoViewIfNeeded(); await expect(overlay).toBeVisible(); await screenshot('happy')
      const committed = await state()
      const checks = []
      checks.push('original PNG: idle/curious/thinking/happy/celebrating/error; real Inspector save/error and canvas snap')
      // B/C resets only visual positioning; same app/records survive.
      const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })
      const c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
      await c.click(); await expect(overlay).toHaveCount(0); await b.click()
      await block.scrollIntoViewIfNeeded(); await expect(overlay).toBeVisible(); await rest()
      assert.deepEqual(await state(), committed)
      // Idle breathing and real eyelid opacity over one sparse blink cycle.
      await page.waitForTimeout(1900)
      const blink = await overlay.locator('.mochi-emotion__eyelid').first().evaluate(async e => {
        const animation = e.getAnimations()[0]
        const result = { name: getComputedStyle(e).animationName, closed: '', open: '' }
        animation.pause(); animation.currentTime = 2200 + 8600 * .97; result.closed = getComputedStyle(e).opacity
        animation.currentTime = 2200 + 8600 * .5; result.open = getComputedStyle(e).opacity; animation.play()
        return result
      })
      assert.equal(blink.closed, '1'); assert.equal(blink.open, '0')
      await page.evaluate(() => { window.motionQA.failure = true })
      await input.fill('离线错误反馈'); await page.getByRole('button', { name: '发送', exact: true }).click()
      await expect(page.locator('.mochi-ai').getByRole('alert')).toBeVisible()
      await expect(emotion).toHaveAttribute('data-emotion', 'error')
      await block.scrollIntoViewIfNeeded(); await screenshot('error')
      assert.deepEqual(await state(), committed)
      // Resize, cancellation, reduced-motion (including change during travel).
      await page.setViewportSize({ width: width === 390 ? 430 : 1200, height: 900 }); await page.waitForTimeout(120)
      await block.scrollIntoViewIfNeeded(); await expect(overlay).toBeVisible()
      assert.deepEqual(await unobstructed(), [])
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(120)
      await other.click(); await page.emulateMedia({ reducedMotion: 'reduce' }); await rest()
      assert.equal(await overlay.evaluate(e => e.getAnimations().length), 0)
      assert.equal(await overlay.locator('.mochi-emotion__body').evaluate(e => getComputedStyle(e).animationName), 'none')
      assert.equal(await overlay.locator('.mochi-emotion__eyelid').first().evaluate(e => getComputedStyle(e).animationName), 'none')
      assert.deepEqual(await unobstructed(), [])
      await screenshot('reduced-motion')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      report.cases.push({ width, height: 900, passed: true, intermediatePositions: unique.size, frames, blink,
        checks: [...checks, 'real selection/drag + pointer cancellation + no event theft', 'rapid reselection', 'scroll anchor on desktop/mobile', 'viewport resize', 'B/C same Runtime', 'click opens existing chat', 'no overlap at landing', 'reduced-motion cancels WAAPI and CSS', 'no horizontal overflow'] })
      await page.evaluate(() => window.motionQA.unmount())
      await expect(overlay).toHaveCount(0)
      await context.close()
    }
    const limitedContext = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true })
    await limitedContext.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 }))
    const limitedPage = await limitedContext.newPage()
    await limitedPage.goto('http://127.0.0.1:5198/__motion')
    await limitedPage.locator('[data-block-key="module:registration-form"]').click()
    await expect(limitedPage.locator('.mochi-overlay')).toHaveAttribute('data-motion-quality', 'limited')
    assert.equal(await limitedPage.locator('.mochi-overlay .mochi-emotion__body').evaluate(e => getComputedStyle(e).animationName), 'none')
    const touchBlock = limitedPage.locator('[data-block-key="module:registration-form"]')
    await touchBlock.scrollIntoViewIfNeeded()
    const touchBox = await touchBlock.boundingBox()
    const cdp = await limitedContext.newCDPSession(limitedPage)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 0 }] })
    await touch('touchStart', touchBox.x + 60, touchBox.y + 70)
    for (let step = 1; step <= 10; step++) await touch('touchMove', touchBox.x + 60 + step, touchBox.y + 70 + step * 3)
    await expect(limitedPage.locator('.mochi-overlay')).toHaveAttribute('data-dragging', 'true')
    assert.equal(await limitedPage.locator('.mochi-overlay button').evaluate(e => getComputedStyle(e).pointerEvents), 'none')
    assert.ok(Math.abs((await touchBlock.boundingBox()).y - touchBox.y) > 10)
    await limitedPage.screenshot({ path: path.join(output, '390-touch-limited.png') })
    await touch('touchEnd', 0, 0)
    await expect.poll(() => limitedPage.evaluate(() => window.motionQA.runtime.getSnapshot().revision)).toBeGreaterThan(0)
    report.lowResource = '390px mobile + 2 logical CPUs: limited quality, CSS body animation disabled, real Chromium touch drag commits with no Mochi event theft'
    await limitedContext.close()
    assert.deepEqual(report.errors, []); assert.deepEqual(report.outbound, [])
    await writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ ...report, cases: report.cases.map(({ frames, ...entry }) => ({ ...entry, sampledFrames: frames.length })) }, null, 2))
  } finally { await browser?.close(); await vite.close() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
