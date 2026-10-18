// Real product UI + real local Node ZIP response. Only generation is offline.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { api, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const root = path.resolve(__dirname, '../..')
const output = process.env.EXPORT_QA_OUTPUT || path.join(root, 'docs/workshop-export-evidence')
const downloads = path.join(root, '.cache/workshop-export-downloads')

async function run() {
  const { createServer, preview } = await import('vite')
  const { trustedSample } = await import('../../tools/custom-block-compiler/trusted-samples.mjs')
  const { unzip } = await import('../project-zip-export/fixtures.mjs')
  const vite = await createServer({ root, mode: 'local-export', server: { host: '127.0.0.1', port: 5196, strictPort: true, watch: { ignored: ['**/.cache/**', '**/docs/workshop-export-evidence/**'] } } })
  const report = { browser: 'Chromium', generation: 'fixed offline HTTP response on real /ai-create; no model calls', cases: [], errors: [], paidCalls: 0 }
  let browser
  try {
    await fs.mkdir(output, { recursive: true }); await fs.mkdir(downloads, { recursive: true })
    await vite.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
    report.version = browser.version()
    for (const width of [1366, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, acceptDownloads: true })
      const outbound = [], downloadsSeen = [], sent = []
      page.on('pageerror', error => report.errors.push(error.message))
      page.on('download', item => downloadsSeen.push(item))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { outbound.push(url.href); return route.abort() }
        if (url.pathname === '/api/ai/generate') return route.fulfill({ json: createClubRegistrationExample().spec })
        if (url.pathname === '/api/local-project-export') sent.push(route.request().postDataJSON())
        else if (url.pathname.startsWith('/api/')) return route.abort()
        return route.continue()
      })
      await page.goto('http://127.0.0.1:5196/ai-create')
      await page.getByLabel('你想做什么软件？').fill('社团报名，受控离线验收')
      await page.getByRole('button', { name: '生成应用', exact: true }).click()
      const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })
      const c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
      const button = page.getByRole('button', { name: '导出 React 项目', exact: true })
      const feedback = page.locator('#workshop-export-feedback')
      const card = id => page.locator(`[data-block-key="${id}"]`)
      await expect(card('builtin:registration-form')).toBeVisible()
      await card('builtin:applicant-list').click()
      const inspector = page.getByRole('complementary', { name: '积木属性', exact: true })
      await inspector.getByLabel('字段名称', { exact: true }).fill('备注')
      await inspector.getByRole('button', { name: '新增字段', exact: true }).click()
      await inspector.getByRole('checkbox', { name: '展示 备注', exact: true }).check()
      await c.click()
      const form = page.getByRole('region', { name: '报名表', exact: true })
      const list = page.getByRole('region', { name: '报名名单', exact: true })
      const metric = page.getByRole('region', { name: '报名人数', exact: true }).locator('output')
      await form.getByLabel('姓名', { exact: false }).fill('录屏验收')
      await form.getByLabel('意向部门', { exact: false }).selectOption('技术部')
      await form.getByRole('button', { name: '提交', exact: true }).click()
      await list.getByRole('button', { name: '编辑', exact: true }).click()
      await list.getByLabel('姓名', { exact: false }).fill('已编辑的报名人')
      await list.getByLabel('备注', { exact: true }).fill('导出当前快照')
      await list.getByRole('button', { name: '保存修改', exact: true }).click()
      await expect(metric).toHaveText('1')
      const saveZip = async label => {
        const downloaded = page.waitForEvent('download')
        await button.click()
        const download = await downloaded
        assert.equal(download.suggestedFilename(), 'blockcraft-project.zip')
        const file = path.join(downloads, `${width}-${label}.zip`)
        await download.saveAs(file)
        assert.equal(await download.failure(), null)
        await expect(feedback).toContainText('已发起下载')
        const bytes = await fs.readFile(file)
        const files = unzip(bytes)
        const last = sent.at(-1)
        const provenance = JSON.parse(files.get('provenance.json'))
        assert.equal(provenance.projectRevision, last.project.revision)
        assert(files.get('src/data.ts').includes('已编辑的报名人'))
        assert(files.get('src/data.ts').includes('导出当前快照'))
        for (const required of ['package.json', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/model.ts', 'src/components/FormBlock.tsx', 'src/components/ListBlock.tsx', 'src/components/MetricBlock.tsx']) assert(files.has(required))
        assert(![...files.keys()].some(p => /node_modules|\.env|server\//.test(p)))
        return { label, revision: provenance.projectRevision, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), files: [...files.keys()] }
      }
      const builtinZip = await saveZip('builtin-c')
      assert.equal(builtinZip.files.length, 14)
      await page.screenshot({ path: path.join(output, `workshop-c-${width}.png`), fullPage: true })
      await b.click()
      const entry = await trustedSample('counter')
      const importer = page.locator('.custom-block-import')
      const install = async registered => {
        if (!await importer.evaluate(e => e.open)) await importer.locator('summary').click()
        await importer.getByLabel('积木制品 JSON').setInputFiles({ name: 'reviewed-counter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
          instance: { id: 'export-counter', definitionId: registered.artifact.manifest.definitionId, versionDigest: registered.versionDigest, props: { initial: 7 } }, artifact: registered,
        })) })
        await importer.getByRole('button', { name: /确认(添加积木|替换版本)/ }).click()
        await expect(importer.getByRole('status')).toContainText('制品已校验并登记')
      }
      await install(entry)
      const custom = card('custom:export-counter')
      await custom.click()
      const customInspector = page.getByRole('complementary', { name: '自定义积木属性', exact: true })
      await customInspector.getByLabel('initial', { exact: true }).fill('11')
      await customInspector.getByRole('button', { name: '保存参数', exact: true }).click()
      const mixedZip = await saveZip('mixed-b')
      assert.equal(mixedZip.files.length, 15)
      assert(mixedZip.files.some(p => p.endsWith('/Counter.tsx')))
      const mixedInput = sent.at(-1)
      assert.equal(mixedInput.artifacts.length, 1)
      assert.equal(mixedInput.artifacts[0].versionDigest, entry.versionDigest)
      assert.equal(mixedInput.project.custom.instances[0].props.initial, 11)
      // Repeated export alone cannot increment revision or change the source snapshot.
      await saveZip('mixed-repeat')
      assert.deepEqual(sent.at(-1), mixedInput)
      assert.equal(await page.locator('[data-workshop-panel="mochi"]').count(), 1)
      assert.equal(await page.locator('.mochi-ai').count(), 1)
      assert.equal(await page.locator('iframe').count(), 0)
      assert.equal(await page.locator('script[src*="Counter"]').count(), 0)
      await importer.locator('summary').click()
      await page.screenshot({ path: path.join(output, `workshop-b-${width}.png`), fullPage: true })
      // Keep a real Node response in flight, edit through the real owner, reject it.
      let release, received
      const held = new Promise(resolve => { release = resolve })
      const ready = new Promise(resolve => { received = resolve })
      const hold = async route => { const response = await route.fetch(); received(); await held; await route.fulfill({ response }) }
      await page.route('**/api/local-project-export', hold)
      const countBeforeStale = downloadsSeen.length
      await button.click(); await ready
      await c.click()
      await list.getByRole('button', { name: '删除', exact: true }).click()
      await expect(metric).toHaveText('0')
      release()
      await expect(feedback).toContainText('项目已变化')
      assert.equal(downloadsSeen.length, countBeforeStale)
      await page.unroute('**/api/local-project-export', hold)
      // Rehash metadata with a forbidden host event, import it inertly, refuse ZIP.
      await b.click()
      const unsupported = structuredClone(entry)
      unsupported.artifact.manifest.events = { changed: { type: 'object', properties: {}, required: [], additionalProperties: false } }
      unsupported.versionDigest = await api.computeVersionDigest(unsupported.artifact)
      await install(unsupported)
      const beforeRefusal = downloadsSeen.length
      await button.click()
      await expect(feedback).toContainText('暂不支持的宿主状态、事件或能力协议')
      assert.equal(downloadsSeen.length, beforeRefusal)
      await page.screenshot({ path: path.join(output, `refused-${width}.png`), fullPage: true })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.deepEqual(outbound, [])
      report.cases.push({ width, passed: true, builtinZip, mixedZip, checks: ['creation', 'Inspector field edit', 'form/list create-update-delete', 'metric updates', 'B/C retention', 'B and C real ZIP downloads + CRC + central directory + required files', 'exact digest and edited props', 'export revision unchanged', 'stale snapshot blocks download', 'unsupported protocol blocks whole ZIP', 'single Mochi mount', 'no CustomBlock execution', 'no horizontal overflow', 'no external requests'] })
      await page.close()
    }
    await vite.close()
    // Neither ordinary dev nor the production preview may enable the local capability.
    for (const production of [false, true]) {
      const app = production ? await preview({ root, preview: { host: '127.0.0.1', port: 5196, strictPort: true } }) : await createServer({ root, server: { host: '127.0.0.1', port: 5196, strictPort: true } })
      try {
        if (!production) await app.listen()
        const page = await browser.newPage()
        await page.route('**/api/ai/generate', route => route.fulfill({ json: createClubRegistrationExample().spec }))
        await page.goto('http://127.0.0.1:5196/ai-create')
        await page.getByLabel('你想做什么软件？').fill('未开放导出检查')
        await page.getByRole('button', { name: '生成应用', exact: true }).click()
        await page.getByRole('button', { name: '导出 React 项目', exact: true }).click()
        await expect(page.locator('#workshop-export-feedback')).toContainText('公网部署仍需身份与项目读取授权')
        const denied = await page.request.post('http://127.0.0.1:5196/api/local-project-export', { data: {} })
        assert.notEqual(denied.headers()['content-type'], 'application/zip')
        report.cases.push({ surface: production ? 'production preview' : 'ordinary dev', passed: true, enabled: false, endpointStatus: denied.status() })
        await page.close()
      } finally { if (production) await new Promise(resolve => app.httpServer.close(resolve)); else await app.close() }
    }
    assert.deepEqual(report.errors, [])
    await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally { await browser?.close(); await vite.close() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
