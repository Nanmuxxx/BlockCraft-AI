// Test-only transforms expose the EXISTING Runtime and delay existing fixture/
// install promises. No production QA switch, endpoint, alternate page or owner.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { realpathSync } = require('node:fs')
const { mkdir, writeFile } = require('node:fs/promises')
const { createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const root = path.resolve(__dirname, '../..')
const output = path.resolve(process.env.TRUSTED_UI_RACE_EVIDENCE || path.join(root, 'docs/acceptance/trusted-pomodoro-ui/races'))
const qa = 'const qa = ((globalThis as any).__entryQA ??= { created: 0, fixtureCalls: 0, installCalls: 0 });'
async function run() {
  await mkdir(output, { recursive: true })
  const { archivedInstallExport } = await import('../generated-artifact-ui/offline-export.mjs')
  const exported = await archivedInstallExport()
  const { createServer } = await import('vite')
  const vite = await createServer({ root, plugins: [{ name: 'trusted-ui-acceptance-only', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/model/appRuntime.ts')) return code.replace('export function createAppRuntime(', 'function coreCreateAppRuntime(') + `
      export function createAppRuntime(...args: Parameters<typeof coreCreateAppRuntime>) {
        const runtime = coreCreateAppRuntime(...args); ${qa}
        const owner = runtime.customProject;
        runtime.customProject = { ...owner, async install(...args: Parameters<typeof owner.install>) {
          qa.installCalls++; if (qa.delayInstall) await new Promise<void>(resolve => { qa.releaseInstall = resolve });
          return owner.install(...args);
        } };
        qa.created++; qa.runtime = runtime; return runtime;
      }`
    if (id.endsWith('/src/components/ai-create/trustedPomodoroFixture.ts')) return code
      .replace('export async function loadTrustedPomodoroFixture(', 'async function coreLoadFixture(')
      .replace('JSON.parse(fixtureJSON)', `((globalThis as any).__entryQA?.invalidFixture ? { ...JSON.parse(fixtureJSON), script: 'forbidden' } : JSON.parse(fixtureJSON))`) + `
      export async function loadTrustedPomodoroFixture(...args: Parameters<typeof coreLoadFixture>) {
        ${qa} qa.fixtureCalls++;
        if (qa.delayFixture) await new Promise<void>(resolve => { qa.releaseFixture = resolve });
        return coreLoadFixture(...args);
      }`
  } }], server: { host: '127.0.0.1', port: 5211, strictPort: true, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] } } })
  await vite.listen()
  const browser = await chromium.launch({ headless: true })
  const report = { browser: browser.version(), base: '1a45d748027dea8e8e00dba336ed03b7d117284b', scope: 'actual /ai-create, test-only promise delays/invalid fixture and Runtime introspection; original owner CAS', paidCalls: 0, cases: [], errors: [] }
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 })
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      const page = await context.newPage(), errors = [], external = []
      let legacyCalls = 0
      page.on('pageerror', e => errors.push(e.message))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname !== '127.0.0.1') { external.push(url.href); return route.abort() }
        if (url.pathname === '/api/ai/generate') { legacyCalls++; assert.deepEqual(Object.keys(route.request().postDataJSON()), ['idea']); return route.fulfill({ json: createClubRegistrationExample().spec }) }
        if (url.pathname === '/api/mochi-ai/status') return route.fulfill({ json: { enabled: false, proactiveEnabled: false, modificationsEnabled: false, reason: 'ACCESS_UNAVAILABLE' } })
        if (url.pathname.startsWith('/api/')) { errors.push(url.pathname); return route.abort() }
        return route.continue()
      })
      const mode = page.getByLabel('创建方式', { exact: true }), source = page.getByLabel('当前应用来源', { exact: true })
      const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }), c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
      const load = page.getByRole('button', { name: '加载离线番茄钟', exact: true })
      const snapshot = () => page.evaluate(() => window.__entryQA.runtime.customProject.getSnapshot())
      const sameOwner = () => page.evaluate(() => window.__entryQA.runtime === window.__retainedRuntime && window.__entryQA.runtime.customProject === window.__retainedOwner)
      const importer = page.locator('.custom-block-import'), preview = importer.getByLabel('AI 积木添加预览')
      const prepare = async value => {
        if (!await importer.evaluate(e => e.open)) await importer.locator('summary').click()
        await importer.getByLabel('导入方式').selectOption('ai')
        await importer.getByLabel('积木制品 JSON').setInputFiles({ name: 'offline.install.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
        await preview.getByRole('button', { name: '预览添加', exact: true }).click()
        await expect(preview.getByRole('button', { name: '确认添加', exact: true })).toBeVisible()
      }
      await page.goto('http://127.0.0.1:5211/ai-create')
      await page.getByLabel('你想做什么软件？').fill('离线验收旧项目保留')
      await page.getByRole('button', { name: '生成应用', exact: true }).click()
      await expect(page.locator('[data-block-key]')).toHaveCount(3)
      await c.click()
      const form = page.getByRole('region', { name: '报名表', exact: true })
      await form.getByLabel('姓名', { exact: false }).fill('竞态拒绝后保留')
      await form.getByLabel('意向部门', { exact: false }).selectOption('技术部')
      await form.getByRole('button', { name: '提交', exact: true }).click()
      await b.click()
      await page.locator('.ai-create-regenerate > summary').click()
      await mode.selectOption('trusted-fixture')
      await page.evaluate(() => { window.__retainedRuntime = window.__entryQA.runtime; window.__retainedOwner = window.__entryQA.runtime.customProject })
      await prepare(exported)
      const before = await snapshot()
      await page.evaluate(() => { window.__entryQA.delayInstall = true })
      await preview.getByRole('button', { name: '确认添加', exact: true }).click()
      await load.click()
      await expect(page.locator('.ai-create-error')).toContainText('CONFIRM_BUSY')
      await mode.selectOption('legacy-v1')
      await expect(mode).toHaveValue('trusted-fixture')
      await c.click(); await expect(b).toHaveAttribute('aria-pressed', 'true')
      assert.equal(await page.evaluate(() => window.__entryQA.fixtureCalls), 0, 'first gate prevents even loading fixture')
      assert.equal(await page.evaluate(() => window.__entryQA.created), 1)
      assert.equal(await sameOwner(), true)
      assert.deepEqual(await snapshot(), before)
      await page.screenshot({ path: path.join(output, `confirm-gate-${width}.png`), fullPage: true })
      await page.evaluate(() => { window.__entryQA.delayInstall = false; window.__entryQA.releaseInstall() })
      await expect(preview.getByRole('status')).toContainText('已添加积木')

      // Start fixture loading, THEN enter a pending install confirmation. Completion
      // must be rejected BEFORE constructing/discarding either Runtime/owner.
      await page.evaluate(() => { window.__entryQA.delayFixture = true })
      await load.click()
      await expect.poll(() => page.evaluate(() => window.__entryQA.fixtureCalls)).toBe(1)
      const late = structuredClone(exported); late.importFile.instance.id = 'late-confirmed'
      await prepare(late)
      await page.evaluate(() => { window.__entryQA.delayInstall = true })
      await preview.getByRole('button', { name: '确认添加', exact: true }).click()
      const lateBefore = await snapshot()
      await page.evaluate(() => { window.__entryQA.delayFixture = false; window.__entryQA.releaseFixture() })
      await expect(page.locator('.ai-create-error')).toContainText('CONFIRM_BUSY')
      assert.equal(await sameOwner(), true)
      assert.equal(await page.evaluate(() => window.__entryQA.created), 1)
      assert.deepEqual(await snapshot(), lateBefore)
      await expect(source).toContainText('原有 AppSpec v1')
      await page.evaluate(() => { window.__entryQA.delayInstall = false; window.__entryQA.releaseInstall() })
      await expect(page.locator('[data-block-key="custom:late-confirmed"]')).toBeVisible()
      const withBoth = await snapshot()
      assert.equal(withBoth.custom.instances.length, 2)
      assert.equal(withBoth.base.records.applicants.at(-1).values['applicant-name'], '竞态拒绝后保留')

      // Strict full-schema failure must not replace the old project or its source.
      await page.evaluate(() => { window.__entryQA.invalidFixture = true })
      await load.click()
      await expect(page.locator('.ai-create-error')).toContainText('当前应用和数据已保留')
      assert.equal(await sameOwner(), true); assert.deepEqual(await snapshot(), withBoth)
      await expect(source).toContainText('原有 AppSpec v1')
      await page.screenshot({ path: path.join(output, `invalid-fixture-${width}.png`), fullPage: true })

      // Cancel a delayed fixture; a new request may succeed before the stale one
      // resolves. The stale completion must never overwrite the new app.
      await page.evaluate(() => { window.__entryQA.invalidFixture = false; window.__entryQA.delayFixture = true })
      await load.click()
      await expect.poll(() => page.evaluate(() => window.__entryQA.fixtureCalls)).toBe(3)
      await page.getByRole('button', { name: '取消生成', exact: true }).click()
      await expect(page.locator('.ai-create-error')).toContainText('已取消生成')
      assert.equal(await sameOwner(), true); assert.deepEqual(await snapshot(), withBoth)
      await page.evaluate(() => { window.__entryQA.delayFixture = false })
      await load.click()
      await expect(page.locator('[data-block-key]')).toHaveCount(1)
      await expect(source).toHaveText('离线固定 Fixture，非真实 DeepSeek 调用')
      const replacement = await snapshot()
      assert.equal(replacement.base.spec.version, 2)
      assert.deepEqual(replacement.custom.instances, [])
      assert.equal(await page.evaluate(() => window.__entryQA.created), 2)
      assert.equal(await page.evaluate(() => window.__retainedOwner.getSnapshot().base.records.applicants.at(-1).values['applicant-name']), '竞态拒绝后保留')
      await page.evaluate(() => { window.__entryQA.releaseFixture() })
      await page.waitForTimeout(100)
      assert.deepEqual(await snapshot(), replacement)
      assert.equal(await page.evaluate(() => window.__entryQA.created), 2)

      await c.click()
      const timer = page.getByRole('region', { name: '数学专注', exact: true })
      await timer.getByRole('button', { name: '开始', exact: true }).click()
      const running = await snapshot()
      await b.click(); await c.click()
      assert.deepEqual(await snapshot(), running, 'B/C does not write or replace timer owner')
      assert.equal(await page.evaluate(() => window.__entryQA.runtime.customProject.getSnapshot().base.timers === window.__entryQA.runtime.getSnapshot().timers), true)
      assert.equal(await page.locator('iframe').count(), 0)
      assert.equal(legacyCalls, 1)
      assert.deepEqual(errors, []); assert.deepEqual(external, [])
      await context.tracing.stop({ path: path.join(output, `trace-${width}.zip`) })
      await context.close()
      report.cases.push({ width, passed: true, legacyHTTPIntercepted: legacyCalls, trustedGenerationHTTP: 0, fixtureLoads: 4, runtimeCreations: 2, errors, external, checks: ['first beforeContextChange blocks fixture load and mode selection during confirming', 'second gate rejects late fixture BEFORE Runtime construction', 'same Runtime/owner and exact snapshot retained on rejection', 'invalid fixture full schema rejects before replacing old records/custom blocks/source', 'cancel and stale completion preserve old/new owner', 'explicit successful replacement only creates one Runtime', 'trusted path does not install source artifacts', 'timer B/C uses same owner with no extra writes'] })
    }
  } catch (error) { report.errors.push(error.stack || String(error)); throw error }
  finally { await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); await vite.close() }
  console.log(JSON.stringify({ passed: report.cases.length, paidCalls: 0, evidence: output }))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
