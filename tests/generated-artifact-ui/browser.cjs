// Real /ai-create components. Test-only decorators delay the EXISTING session's
// install to observe pre-CAS navigation races; no production QA route or switch.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { mkdir, writeFile } = require('node:fs/promises')
const { realpathSync } = require('node:fs')
const { api, artifact, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const root = path.resolve(__dirname, '../..')
const output = process.env.GENERATED_UI_EVIDENCE || '/tmp/blockcraft-generated-ui'
const qa = 'const qa = ((globalThis as any).__generatedQA ??= { calls: 0, delayInstall: false });'

async function run() {
  await mkdir(output, { recursive: true })
  const { archivedInstallExport } = await import('./offline-export.mjs')
  const exported = await archivedInstallExport()
  await writeFile(path.join(output, 'offline-pomodoro.install.json'), JSON.stringify(exported, null, 2))
  const { createServer } = await import('vite')
  const vite = await createServer({ root, plugins: [{ name: 'acceptance-only-instrumentation', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/model/appRuntime.ts')) return code.replace('export function createAppRuntime(', 'function coreCreateAppRuntime(') + `
      export function createAppRuntime(...args: Parameters<typeof coreCreateAppRuntime>) {
        const runtime = coreCreateAppRuntime(...args); ${qa}
        const owner = runtime.customProject;
        runtime.customProject = { ...owner, async install(...args: Parameters<typeof owner.install>) {
          qa.calls++; if (qa.delayInstall) await new Promise<void>(resolve => { qa.releaseInstall = resolve });
          return owner.install(...args);
        } };
        qa.runtime = runtime; return runtime;
      }`
    if (id.endsWith('/src/integrations/generated-artifact/ui.ts')) return code.replace('export function createGeneratedArtifactUI(', 'function coreCreateGeneratedArtifactUI(') + `
      export function createGeneratedArtifactUI(...args: Parameters<typeof coreCreateGeneratedArtifactUI>) {
        const binding = coreCreateGeneratedArtifactUI(...args); ${qa} qa.binding = binding; return binding;
      }`
    if (id.endsWith('/src/main.tsx')) return code.replace("createRoot(document.getElementById('root')!).render(", `const qaRoot = createRoot(document.getElementById('root')!);
      ${qa} qa.unmount = () => { qa.binding?.dispose(); qaRoot.unmount() };
      qaRoot.render(`)
  } }], server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } } })
  await vite.listen()
  const browser = await chromium.launch({ headless: true })
  const report = { browser: browser.version(), baseline: '7e94dc9568501dd4ad218a43b5aca31026aed2b2', fixture: exported.importFile.instance, scope: 'offline archived real artifact, actual production UI; test-only session delay/introspection; zero paid calls or generated TSX execution', cases: [], errors: [] }
  try {
    for (const width of [1366, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, recordVideo: { dir: path.join(output, 'video'), size: { width, height: 900 } } })
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      const page = await context.newPage(), errors = [], external = []
      page.on('pageerror', error => errors.push(error.message))
      let requests = 0, deferGeneration = false, releaseGeneration
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { external.push(url.href); return route.abort() }
        if (url.pathname === '/api/ai/generate') {
          requests++
          if (deferGeneration) await new Promise(resolve => { releaseGeneration = resolve })
          return route.fulfill({ json: createClubRegistrationExample().spec })
        }
        if (url.pathname === '/api/mochi-ai/status') return route.fulfill({ json: { enabled: false, proactiveEnabled: false, modificationsEnabled: false, reason: 'ACCESS_UNAVAILABLE' } })
        if (url.pathname.startsWith('/api/')) { errors.push('Unexpected API: ' + url.pathname); return route.abort() }
        return route.continue()
      })
      const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }), c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
      const importer = page.locator('.custom-block-import'), preview = importer.getByLabel('AI 积木添加预览')
      const snapshot = () => page.evaluate(() => window.__generatedQA.runtime.customProject.getSnapshot())
      const choose = async value => {
        if (!await importer.evaluate(e => e.open)) await importer.locator('summary').click()
        await importer.getByLabel('积木制品 JSON').setInputFiles({ name: 'offline-pomodoro.install.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
      }
      const prepare = async value => { await choose(value); await preview.getByRole('button', { name: '预览添加', exact: true }).click() }
      await page.goto('http://127.0.0.1:5199/ai-create')
      await page.getByLabel('你想做什么软件？').fill('离线验收：社团报名工具')
      await page.getByRole('button', { name: '生成应用', exact: true }).click()
      await expect(page.locator('[data-block-key]')).toHaveCount(3)

      // Preserve a nonempty business record through installation (real existing CRUD).
      await c.click()
      const form = page.getByRole('region', { name: '报名表', exact: true })
      await form.getByLabel('姓名', { exact: false }).fill('安装前保留记录')
      await form.getByLabel('意向部门', { exact: false }).selectOption('技术部')
      await form.getByRole('button', { name: '提交', exact: true }).click()
      await b.click()
      // Exercise the preserved manual import UI with a different admitted version.
      const source = artifact(); source.manifest.name = '原有倒计时'
      const digest = await api.computeVersionDigest(source)
      await choose({ instance: { id: 'older-block', definitionId: source.manifest.definitionId, versionDigest: digest, props: { durationSeconds: 600 } }, artifact: { versionDigest: digest, artifact: source } })
      await importer.getByRole('button', { name: '确认添加积木', exact: true }).click()
      await expect(page.locator('[data-block-key="custom:older-block"]')).toBeVisible()
      await page.evaluate(digest => {
        const owner = window.__generatedQA.runtime.customProject, old = owner.getSnapshot(), next = structuredClone(old)
        next.revision++; next.custom.states['older-block'] = { versionDigest: digest, stateRevision: 0, value: { remainingSeconds: 560, status: 'paused' } }
        if (!owner.compareAndSwap(old, next, owner.getAuthorization()).ok) throw Error('Old state seed rejected')
      }, digest)
      await importer.getByLabel('导入方式').selectOption('ai')
      const before = await snapshot()
      await choose(exported)
      await expect(preview.getByRole('heading', { name: '中文番茄钟' })).toBeVisible()
      assert.deepEqual(await snapshot(), before, 'file selection cannot write')
      await preview.getByRole('button', { name: '预览添加', exact: true }).click()
      await expect(preview.getByRole('button', { name: '确认添加', exact: true })).toBeVisible()
      await expect(preview).toContainText('pending-build')
      await expect(preview).toContainText(exported.importFile.instance.versionDigest)
      assert.deepEqual(await snapshot(), before, 'preview cannot write')
      await page.screenshot({ path: path.join(output, `preview-${width}.png`), fullPage: true })
      await preview.getByRole('button', { name: '取消添加', exact: true }).click()
      assert.deepEqual(await snapshot(), before, 'cancel cannot write')
      await expect(page.locator('[data-block-key]')).toHaveCount(4)
      const bad = structuredClone(exported); bad.importFile.instance.versionDigest = 'sha256:' + '0'.repeat(64)
      await prepare(bad); await expect(preview.getByRole('alert')).toBeVisible(); assert.deepEqual(await snapshot(), before)
      await prepare(exported); await expect(preview.getByRole('button', { name: '确认添加', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '一键整理', exact: true }).click()
      await expect(preview.getByRole('alert')).toContainText('项目或授权已变化')
      await expect(preview.getByRole('button', { name: '确认添加', exact: true })).toHaveCount(0)
      await prepare(exported); await expect(preview.getByRole('button', { name: '确认添加', exact: true })).toBeVisible()
      await page.evaluate(() => window.__generatedQA.runtime.customProject.setReadOnly(true))
      await expect(preview.getByRole('alert')).toContainText('项目或授权已变化')
      await page.evaluate(() => window.__generatedQA.runtime.customProject.setReadOnly(false))

      const beforeInstall = await snapshot(), callsBefore = await page.evaluate(() => window.__generatedQA.calls)
      await prepare(exported); await expect(preview.getByRole('button', { name: '确认添加', exact: true })).toBeVisible()
      await page.locator('.ai-create-regenerate > summary').click()
      await page.getByLabel('你想做什么软件？').fill('确认期间禁止重新生成')
      const requestsBefore = requests
      const gateResult = await page.evaluate(() => {
        const qa = window.__generatedQA; qa.delayInstall = true
        const confirm = [...document.querySelectorAll('button')].find(e => e.textContent === '确认添加')
        confirm.click(); confirm.click() // same JS turn: React has not had a chance to disable anything.
        document.querySelector('[aria-label="C 模式 · 运行应用"]').click()
        document.querySelector('.workshop__nav a[href="/"]').click()
        document.querySelector('form.ai-create-prompt').requestSubmit()
        let unmountCode
        try { qa.unmount() } catch (error) { unmountCode = error.code }
        return { phase: qa.binding.getSnapshot().phase, unmountCode, url: location.pathname }
      })
      assert.deepEqual(gateResult, { phase: 'confirming', unmountCode: 'CONFIRM_BUSY', url: '/ai-create' })
      await expect(b).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.ai-create-error')).toContainText('CONFIRM_BUSY')
      assert.equal(requests, requestsBefore, 'regenerate blocked before network')
      assert.equal(await page.evaluate(() => window.__generatedQA.calls), callsBefore + 1)
      assert.deepEqual(await snapshot(), beforeInstall, 'delayed confirmation has not written')
      const unloadBlocked = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })
      assert.equal(unloadBlocked, true)
      await page.screenshot({ path: path.join(output, `confirm-busy-${width}.png`), fullPage: true })
      await page.evaluate(() => { const qa = window.__generatedQA; qa.delayInstall = false; qa.releaseInstall() })
      await expect(preview.getByRole('status')).toContainText('已添加积木')
      const after = await snapshot(), wanted = structuredClone(beforeInstall)
      wanted.revision++; wanted.custom.instances.push(exported.importFile.instance); wanted.custom.positions['offline-pomodoro'] = { x: .1, y: .7 }; wanted.renderOrder.push({ kind: 'custom', id: 'offline-pomodoro' })
      assert.deepEqual(after, wanted, 'only target append; records/state/positions/order preserved')
      const custom = page.locator('[data-block-key="custom:offline-pomodoro"]')
      await expect(custom).toBeVisible(); await custom.click()
      const inspector = page.getByRole('complementary', { name: '自定义积木属性', exact: true })
      await expect(inspector.getByLabel('initialMinutes', { exact: true })).toHaveValue('25')
      await custom.scrollIntoViewIfNeeded(); const box = await custom.boundingBox()
      if (width === 390) {
        const touch = await context.newCDPSession(page)
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 30, y: box.y + 30 }] })
        for (let i = 1; i <= 10; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 30 + 30 * i / 10, y: box.y + 30 + 80 * i / 10 }] })
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach()
      } else { await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 60, box.y + 110, { steps: 12 }); await page.mouse.up() }
      await expect(page.locator('.block-canvas-feedback')).toContainText(/位置已更新|拼上了|整组积木已移动/)
      await expect.poll(async () => (await snapshot()).revision).toBeGreaterThan(after.revision)
      await page.screenshot({ path: path.join(output, `installed-b-${width}.png`), fullPage: true })
      await c.click()
      const viewer = page.locator('[data-instance-id="offline-pomodoro"]')
      await expect(viewer).toHaveAttribute('data-viewer-status', 'unavailable')
      await expect(viewer).toContainText('暂不可用')
      await expect(page.getByRole('cell', { name: '安装前保留记录', exact: true })).toBeVisible()
      assert.equal(await page.locator('iframe').count(), 0)
      assert.equal(await page.locator('script[src*="Pomodoro"]').count(), 0)
      assert.equal(await page.locator('.mochi-ai').count(), 1)
      await page.screenshot({ path: path.join(output, `unavailable-c-${width}.png`), fullPage: true })

      // A regeneration already in flight must also fail before setApp/unmount.
      await b.click(); deferGeneration = true
      await page.getByRole('button', { name: /重试生成|生成新应用/, exact: true }).click()
      await expect.poll(() => Boolean(releaseGeneration)).toBe(true)
      const second = structuredClone(exported); second.importFile.instance.id = 'late-pomodoro'
      await prepare(second); await expect(preview.getByRole('button', { name: '确认添加', exact: true })).toBeVisible()
      await page.evaluate(() => { window.__generatedQA.delayInstall = true })
      await preview.getByRole('button', { name: '确认添加', exact: true }).click()
      const beforeLate = await snapshot(); releaseGeneration(); deferGeneration = false
      await expect(page.locator('.ai-create-error')).toContainText('CONFIRM_BUSY')
      assert.deepEqual(await snapshot(), beforeLate, 'late generation cannot replace old app while confirming')
      await page.evaluate(() => { const qa = window.__generatedQA; qa.delayInstall = false; qa.releaseInstall() })
      await expect(page.locator('[data-block-key="custom:late-pomodoro"]')).toBeVisible()
      await prepare(exported); await expect(preview.getByRole('alert')).toBeVisible() // duplicate ID is not a replacement.
      assert.equal(await page.locator('[data-block-key="custom:offline-pomodoro"]').count(), 1)
      assert.equal(await page.locator('body').evaluate(e => e.scrollWidth <= innerWidth), true, 'no horizontal page overflow')
      const switching = structuredClone(exported); switching.importFile.instance.id = 'cancelled-by-project-switch'
      await prepare(switching); await expect(preview.getByRole('button', { name: '确认添加', exact: true })).toBeVisible()
      await page.evaluate(() => { window.__oldOwner = window.__generatedQA.runtime.customProject; window.__oldSnapshot = window.__oldOwner.getSnapshot() })
      await page.getByRole('button', { name: /重试生成|生成新应用/, exact: true }).click()
      await expect(page.locator('[data-block-key]')).toHaveCount(3)
      assert.equal(await page.evaluate(() => window.__oldOwner.getSnapshot() === window.__oldSnapshot), true, 'project switch cancels pending preview without writing old owner')
      assert.equal(await page.evaluate(() => window.__generatedQA.runtime.customProject.getSnapshot().custom.instances.length), 0)
      const checks = ['real archived export', 'manual import retained', 'nonempty CRUD/older state preserved', 'read/preview zero write', 'cancel zero write', 'wrong digest rejected', 'revision invalidation', 'authorization invalidation', 'same-turn duplicate confirm installs once', 'mode/link/regenerate/unmount gated synchronously', 'beforeunload cancelled while busy', 'async generation completion gated before setApp', 'successful project replacement cancels preview without old project write', 'B selection/drag/Inspector', 'C unavailable/no execution', 'single Mochi', 'duplicate ID rejected', 'no external requests', 'no horizontal overflow']
      assert.deepEqual(external, []); assert.deepEqual(errors, [])
      await page.evaluate(() => window.__generatedQA.unmount())
      await expect(page.locator('.app-spec-workshop')).toHaveCount(0)
      await context.tracing.stop({ path: path.join(output, `trace-${width}.zip`) })
      const video = page.video(); await context.close()
      report.cases.push({ width, passed: true, checks, installCalls: callsBefore + 2, generationRequestsInterceptedOffline: requests, video: await video.path(), external, errors })
    }
  } catch (error) { report.errors.push(error.stack || String(error)); throw error }
  finally { await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); await vite.close() }
  console.log(JSON.stringify(report, null, 2))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
