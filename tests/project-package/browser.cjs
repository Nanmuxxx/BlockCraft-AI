// Offline acceptance: no generated AppSpec, model calls, keys, or remote services.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { makeGalleryRuntime, createLegacyFixture, pngBytes } = require('./fixtures.cjs')
const { createProjectJson, serializeProjectJson } = require('../../src/integrations/project-json/format.ts')
const { parseProjectPackage } = require('../../src/integrations/project-package/format.ts')
const { encodePackageZip, decodePackageZip, PACKAGE_LIMITS } = require('../../src/integrations/project-package/zip.ts')
const root = path.resolve(__dirname, '../..')

async function download(page, button, filePath) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const result = await pending
  await result.saveAs(filePath)
  return { bytes: await fs.readFile(filePath), name: result.suggestedFilename() }
}
function repack(files) { return encodePackageZip([...files].map(([path, data]) => ({ path, data }))) }
async function backups(page) {
  return page.evaluate(async () => (await import('/src/integrations/project-json/backups.ts')).listProjectBackups().then(entries => entries.length))
}
async function assertRuns(page, expectedName = 'ZIP 保留记录') {
  await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
  await expect(page.getByRole('cell', { name: expectedName, exact: true })).toBeVisible()
  const image = page.getByRole('region', { name: '项目图片', exact: true }).getByRole('button', { name: '预览 红绿蓝白四像素', exact: true })
  await expect(image).toBeVisible()
  await expect(image.locator('img')).toHaveJSProperty('naturalWidth', 2)
  await expect(image.locator('img')).toHaveJSProperty('naturalHeight', 2)
  assert.equal(await image.locator('img').evaluate(async element => { await element.decode(); return element.complete }), true)
  await image.click()
  const dialog = page.getByRole('dialog', { name: '预览 红绿蓝白四像素', exact: true })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(image).toBeFocused()
  assert.deepEqual(await page.locator('#generated-preview .renderer-block > h2').allTextContents(), ['项目图片', '报名表', '报名名单', '离线计时器', '报名人数'])
  await expect(page.getByRole('region', { name: '离线计时器', exact: true }).getByLabel('剩余时间')).toHaveText('01:01')
}

async function main() {
  const { createServer } = await import('vite')
  const fontRoot = path.dirname(require.resolve('@fontsource/pixelify-sans/package.json'))
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [root, fontRoot] } } })
  let browser
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'blockcraft-package-'))
  const report = { passed: false, cases: [], externalRequests: 0, aiRequests: 0, pageErrors: [] }
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
    report.browser = browser.version()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    async function freshPage(width) {
      const context = await browser.newContext({ viewport: { width, height: 1100 }, acceptDownloads: true, serviceWorkers: 'block' })
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) { report.externalRequests++; return route.abort() }
        if (url.pathname.startsWith('/api/')) {
          if (['/api/ai/generate', '/api/mochi-plan', '/api/mochi-ai/chat'].includes(url.pathname)) report.aiRequests++
          return route.fulfill({ status: 503, json: { enabled: false, error: { code: 'OFFLINE_FIXTURE' } } })
        }
        return route.continue()
      })
      const page = await context.newPage()
      page.on('pageerror', error => report.pageErrors.push(error.message))
      await page.goto(`${origin}/ai-create`)
      assert.equal(await page.evaluate(() => localStorage.length), 0)
      assert.equal(await backups(page), 0)
      return { page, context }
    }
    const fixture = makeGalleryRuntime()
    const document = await createProjectJson(fixture.customProject.getSnapshot(), fixture.customProject.registry)
    const jsonPath = path.join(temp, 'fixture.json')
    await fs.writeFile(jsonPath, serializeProjectJson(document))
    const source = await freshPage(1280)
    await source.page.locator('.project-json-landing-import input[type=file]').setInputFiles(jsonPath)
    await expect(source.page.getByRole('heading', { name: '项目包离线验收', exact: true })).toBeVisible()
    await assertRuns(source.page)
    const zipPath = path.join(temp, 'project.zip')
    const exported = await download(source.page, '下载项目 ZIP', zipPath)
    assert.match(exported.name, /\.zip$/)
    const restored = await parseProjectPackage(exported.bytes)
    assert.deepEqual(restored.project, fixture.customProject.getSnapshot())
    assert.deepEqual(decodePackageZip(exported.bytes).get('assets/fixture-png.png'), new Uint8Array(pngBytes))
    report.cases.push('real PNG + records + positions + timer + render order ZIP export')
    await source.context.close()

    // The source browser context is destroyed. Only the downloaded ZIP crosses
    // this boundary; no localStorage, IndexedDB, cache, or runtime object does.
    const clean = await freshPage(390)
    await clean.page.locator('.project-json-landing-import input[type=file]').setInputFiles(zipPath)
    await expect(clean.page.getByRole('heading', { name: '项目包离线验收', exact: true })).toBeVisible()
    await assertRuns(clean.page)
    const second = await download(clean.page, '下载项目 ZIP', path.join(temp, 'restored.zip'))
    assert.deepEqual(await parseProjectPackage(second.bytes), restored)
    assert.deepEqual([...decodePackageZip(second.bytes)], [...decodePackageZip(exported.bytes)])
    report.cases.push('clean mobile context ZIP import, image decode/preview, exact re-export')

    // Prove the restored declarative runtime still accepts normal user actions.
    const timer = clean.page.getByRole('region', { name: '离线计时器', exact: true })
    await timer.getByRole('button', { name: '开始', exact: true }).click()
    await expect(timer.getByRole('status', { name: '', exact: true })).toHaveText('计时中')
    await timer.getByRole('button', { name: '暂停', exact: true }).click()
    await expect(timer.getByRole('status', { name: '', exact: true })).toHaveText('已暂停 / 待开始')
    const form = clean.page.getByRole('region', { name: '报名表', exact: true })
    await form.getByLabel('姓名', { exact: false }).fill('干净环境新增记录')
    await form.getByLabel('意向部门', { exact: false }).selectOption('技术部')
    await form.getByRole('button', { name: '提交', exact: true }).click()
    await expect(clean.page.getByRole('cell', { name: '干净环境新增记录', exact: true })).toBeVisible()
    const beforeFailure = await download(clean.page, '下载项目 JSON', path.join(temp, 'before-failure.json'))
    const backupCount = await backups(clean.page)
    const files = decodePackageZip(exported.bytes)
    const missing = new Map(files); missing.delete('assets/fixture-png.png')
    const damaged = new Map(files); damaged.set('assets/fixture-png.png', new Uint8Array([137, 80, 78, 71]))
    const undecodable = new Map(files)
    const brokenPng = Buffer.from(files.get('assets/fixture-png.png'))
    brokenPng[brokenPng.indexOf(Buffer.from('IDAT')) + 4] ^= 0xff
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    manifest.resources[0].sha256 = createHash('sha256').update(brokenPng).digest('hex')
    manifest.resources[0].byteLength = brokenPng.length
    undecodable.set('assets/fixture-png.png', brokenPng)
    undecodable.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
    const undecodableZip = repack(undecodable)
    assert.equal(await clean.page.evaluate(async bytes => {
      try { await (await import('/src/integrations/project-package/format.ts')).parseProjectPackage(new Uint8Array(bytes)); return null }
      catch (error) { return error.code }
    }, [...undecodableZip]), 'RESOURCE_INVALID')
    const malicious = Buffer.from(exported.bytes)
    const originalName = Buffer.from('project.json'), evilName = Buffer.from('../evil.json')
    for (let offset = 0; (offset = malicious.indexOf(originalName, offset)) !== -1; offset += originalName.length) evilName.copy(malicious, offset)
    const badFiles = [
      ['missing.zip', repack(missing)], ['damaged.zip', repack(damaged)],
      ['undecodable-rehashed.zip', undecodableZip],
      ['malicious.zip', malicious], ['oversized.zip', Buffer.alloc(PACKAGE_LIMITS.maxZipBytes + 1)],
      ['invalid.json', Buffer.from('{invalid')],
      ['duplicate.json', Buffer.from('{"formatVersion":2,"formatVersion":99}')],
    ]
    for (const [name, bytes] of badFiles) {
      await clean.page.locator('.workshop-json-controls input[type=file]').setInputFiles({ name, mimeType: name.endsWith('.zip') ? 'application/zip' : 'application/json', buffer: Buffer.from(bytes) })
      await expect(clean.page.getByRole('alert').filter({ hasText: '当前项目未更改' })).toBeVisible()
      await expect(clean.page.getByRole('cell', { name: '干净环境新增记录', exact: true })).toBeVisible()
      assert.equal(await backups(clean.page), backupCount, `${name} must not create a backup`)
    }
    const afterFailure = await download(clean.page, '下载项目 JSON', path.join(temp, 'after-failure.json'))
    assert.deepEqual(JSON.parse(afterFailure.bytes), JSON.parse(beforeFailure.bytes))
    report.cases.push('restored timer/form execute; invalid/missing/damaged/rehashed-undecodable/oversized/path imports preserve project and backup count')
    await clean.context.close()

    const legacy = await freshPage(1280)
    await legacy.page.locator('.project-json-landing-import input[type=file]').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createLegacyFixture())) })
    await expect(legacy.page.getByRole('heading', { name: '旧版离线项目', exact: true })).toBeVisible()
    await legacy.page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    await expect(legacy.page.getByRole('cell', { name: '旧项目保留记录', exact: true })).toBeVisible()
    const legacyZip = await download(legacy.page, '下载项目 ZIP', path.join(temp, 'legacy.zip'))
    assert.equal((await parseProjectPackage(legacyZip.bytes)).project.base.spec.version, 1)
    report.cases.push('bare v1 legacy JSON migrates, runs, exports valid v1 package')
    await legacy.context.close()
    assert.equal(report.externalRequests, 0)
    assert.equal(report.aiRequests, 0)
    assert.deepEqual(report.pageErrors, [])
    report.passed = true
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser?.close()
    await server.close()
    await fs.rm(temp, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
