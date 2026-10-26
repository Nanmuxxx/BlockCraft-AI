// Uses fresh browser contexts only. Blocks all external requests and every /api request.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const output = path.resolve(process.env.GALLERY_EVIDENCE_DIR || path.join(root, '.cache/gallery-offline-evidence/browser'))
const report = { mode: 'OFFLINE_CANVAS', passed: false, cases: Array.from({ length: 14 }, (_, n) => ({ id: `M${String(n).padStart(2, '0')}`, status: 'NOT RUN' })),
  notRun: ['M06 live-provider billing independence', 'M10 live-provider reservations, uncertain charges and credential rotation', 'real image-model quality/cost'],
  externalRequests: [], aiRequests: [], pageErrors: [] }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
async function main() {
  await fs.mkdir(output, { recursive: true })
  const { createServer } = await import('vite')
  const fontRoot = path.dirname(require.resolve('@fontsource/pixelify-sans/package.json'))
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [root, fontRoot] } },
    plugins: [{ name: 'offline-acceptance-api-denial', configureServer(s) {
      s.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/api/')) return next()
        res.statusCode = 503; res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ enabled: false, error: { code: 'OFFLINE_ACCEPTANCE' } }))
      })
    } }],
  })
  let browser
  const contexts = []
  const traces = new Map()
  async function closeContext(context) {
    const trace = traces.get(context)
    if (trace) { traces.delete(context); await context.tracing.stop({ path: trace }) }
    await context.close()
  }
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    report.environment = { platform: process.platform, node: process.version, browser: browser.version(), origin,
      head: execFileSync('git', ['--no-optional-locks', 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      branch: execFileSync('git', ['--no-optional-locks', 'branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
      status: execFileSync('git', ['--no-optional-locks', 'status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
    }
    assert.match(report.environment.head, /^[a-f0-9]{40}$/)
    // GitHub checks out PR commits detached; verify the tested commit, not a local branch name.
    if (process.env.GALLERY_EXPECTED_SHA) assert.equal(report.environment.head, process.env.GALLERY_EXPECTED_SHA)
    async function fresh({ trace = false, width = 1440 } = {}) {
      const context = await browser.newContext({ viewport: { width, height: 1100 }, acceptDownloads: true, serviceWorkers: 'block' })
      contexts.push(context)
      if (trace) {
        await context.tracing.start({ screenshots: true, snapshots: true })
        traces.set(context, path.join(output, `demo-${contexts.length}.trace.zip`))
      }
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin !== origin) { report.externalRequests.push(url.origin + url.pathname); return route.abort() }
        if (url.pathname.startsWith('/api/')) {
          if (!['/api/studio/status', '/api/mochi-plan/status'].includes(url.pathname) && route.request().method() !== 'GET') report.aiRequests.push(url.pathname)
          return route.fulfill({ status: 503, json: { enabled: false, error: { code: 'OFFLINE_ACCEPTANCE' } } })
        }
        return route.continue()
      })
      const page = await context.newPage()
      page.on('pageerror', error => report.pageErrors.push(error.message))
      page.on('dialog', dialog => dialog.accept())
      await page.goto(`${origin}/ai-create`)
      await expect(page.locator('#generation-mode')).toBeEnabled()
      return { page, context }
    }
    async function run(id, description, action) {
      const entry = report.cases.find(c => c.id === id); entry.description = description
      try { entry.evidence = await action(); entry.status = 'PASS'; console.log(`PASS ${id}: ${description}`) }
      catch (error) { entry.status = 'FAIL'; entry.error = error.stack; throw error }
    }
    async function download(page, name, file) {
      const wait = page.waitForEvent('download')
      await page.getByRole('button', { name, exact: true }).click()
      const item = await wait, target = path.join(output, file)
      await item.saveAs(target)
      return { path: target, bytes: await fs.readFile(target) }
    }
    async function project(page, file) { return JSON.parse((await download(page, '下载项目 JSON', file)).bytes).project }
    async function saved(page) { return page.evaluate(async () => (await import('/src/integrations/project-workspace/repository.ts')).workspaceRepository.read()) }
    async function screenshot(page, name) { await page.screenshot({ path: path.join(output, name), fullPage: true }) }
    await run('M00', 'local worktree identity and served source', async () => {
      const { page, context } = await fresh()
      const served = await page.evaluate(async () => (await fetch('/src/integrations/gallery-generation/controller.ts')).text())
      assert.match(served, /createGalleryImageController/)
      await closeContext(context); return report.environment
    })
    const { page, context } = await fresh({ trace: true })
    await page.locator('#generation-mode').selectOption('gallery-fixture')
    await page.getByRole('button', { name: '打开离线图库', exact: true }).click()
    await expect(page.getByRole('heading', { name: '我的图库练习', exact: true })).toBeVisible()
    const before = await project(page, '01-before.json')
    let candidate, adopted, stored, zip
    await run('M01', 'one candidate, no project change before confirmation; discard preserves original', async () => {
      await page.getByRole('button', { name: '生成一张离线示例', exact: true }).click()
      const preview = page.getByRole('img', { name: '待采用的离线图片预览', exact: true })
      await expect(preview).toBeVisible(); assert.equal(await preview.count(), 1)
      assert.deepEqual(await project(page, '02-preview-only.json'), before)
      assert.equal(await saved(page), null)
      await page.getByRole('button', { name: '放弃预览', exact: true }).click()
      await expect(preview).toHaveCount(0)
      assert.deepEqual(await project(page, '03-cancelled.json'), before)
      await page.getByRole('button', { name: '生成一张离线示例', exact: true }).click()
      await expect(preview).toBeVisible()
      return { revision: before.revision, assets: Object.keys(before.base.assets || {}).length, candidatesPerOperation: 1, discardedUnchanged: true }
    })
    await run('M02', 'preview decodes and identifies actual PNG bytes, size and destination', async () => {
      candidate = await page.getByRole('img', { name: '待采用的离线图片预览', exact: true }).evaluate(async img => {
        await img.decode(); return { src: img.src, width: img.naturalWidth, height: img.naturalHeight }
      })
      assert.equal(candidate.width, 320); assert.equal(candidate.height, 240)
      assert.equal(await page.getByRole('combobox', { name: '图片目标图库' }).inputValue(), 'practice-gallery')
      await screenshot(page, '02-candidate.png')
      return { width: candidate.width, height: candidate.height, mime: 'image/png', bytes: Buffer.from(candidate.src.split(',')[1], 'base64').length,
        sha256: sha(Buffer.from(candidate.src.split(',')[1], 'base64')), target: 'practice-gallery' }
    })
    await run('M03', 'confirm saves one asset and reference atomically; B and C expose identical bytes', async () => {
      await page.getByRole('button', { name: '确认采用并保存', exact: true }).click()
      await expect(page.locator('.gallery-generation')).toContainText('已采用并保存到本机')
      adopted = await project(page, '04-adopted.json'); stored = await saved(page)
      assert.equal(adopted.revision, before.revision + 1)
      const ids = adopted.base.spec.blocks.find(b => b.id === 'practice-gallery').imageIds
      assert.equal(ids.length, 1); assert.equal(Object.keys(adopted.base.assets).length, 1)
      assert.equal(adopted.base.assets[ids[0]].dataUrl, candidate.src)
      assert.deepEqual(JSON.parse(stored.text).project, adopted); assert.equal(stored.receipts.length, 1)
      await page.getByRole('button', { name: '我的图片', exact: true }).click()
      await expect(page.locator('.app-spec-gallery-editor__asset input[type=checkbox]')).toBeChecked()
      await screenshot(page, '03-adopted-b-configuration.png')
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      const image = page.locator('#generated-preview img').filter({ visible: true })
      await expect(image).toHaveCount(1); await expect(image).toHaveAttribute('src', candidate.src)
      await expect(image).toHaveJSProperty('naturalWidth', 320)
      assert.deepEqual(await project(page, '05-c-mode.json'), adopted)
      await screenshot(page, '03-adopted-c-mode.png')
      return { revision: adopted.revision, assetId: ids[0], receipt: stored.receipts[0], storageSequence: stored.sequence }
    })
    await run('M04', 'page reload restores the latest saved project, references and image bytes', async () => {
      await page.reload()
      await expect(page.getByRole('heading', { name: '我的图库练习', exact: true })).toBeVisible()
      await expect(page.locator('.workspace-save')).toContainText('已保存到本机')
      assert.deepEqual(await project(page, '06-reloaded.json'), adopted)
      assert.deepEqual(await saved(page), stored)
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      await expect(page.locator('#generated-preview img')).toHaveAttribute('src', candidate.src)
      await screenshot(page, '04-refresh-restored.png')
      return { fullProjectEqual: true, savedRecordEqual: true }
    })
    await run('M05', 'ZIP crosses an empty browser context; imported JSON/ZIP and decoded PNG match', async () => {
      zip = await download(page, '下载项目 ZIP', 'gallery-project.zip')
      const contents = await page.evaluate(async bytes => {
        const { decodePackageZip } = await import('/src/integrations/project-package/zip.ts')
        return [...decodePackageZip(new Uint8Array(bytes))].map(([path, bytes]) => ({ path, bytes: [...bytes] }))
      }, [...zip.bytes])
      const image = contents.find(f => f.path.startsWith('assets/'))
      assert.equal(sha(Buffer.from(image.bytes)), sha(Buffer.from(candidate.src.split(',')[1], 'base64')))
      await screenshot(page, '05-zip-export.png')
      await closeContext(context)
      const clean = await fresh({ trace: true, width: 390 })
      assert.equal(await saved(clean.page), null)
      await clean.page.locator('.project-json-landing-import input[type=file]').setInputFiles(zip.path)
      await expect(clean.page.getByRole('heading', { name: '我的图库练习', exact: true })).toBeVisible()
      assert.deepEqual(await project(clean.page, '07-zip-imported.json'), adopted)
      const reexport = await download(clean.page, '下载项目 ZIP', 'gallery-restored.zip')
      assert.deepEqual(reexport.bytes, zip.bytes)
      await clean.page.getByRole('button', { name: '保存到本机', exact: true }).click()
      await expect(clean.page.locator('.workspace-save')).toContainText('已保存到本机')
      await clean.page.reload()
      await expect(clean.page.getByRole('heading', { name: '我的图库练习', exact: true })).toBeVisible()
      await clean.page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      await expect(clean.page.locator('#generated-preview img')).toHaveAttribute('src', candidate.src)
      await expect(clean.page.locator('#generated-preview img')).toHaveJSProperty('naturalWidth', 320)
      await screenshot(clean.page, '06-isolated-import-restored.png')
      await closeContext(clean.context)
      return { zipSha256: sha(zip.bytes), members: contents.map(f => ({ path: f.path, bytes: f.bytes.length, sha256: sha(Buffer.from(f.bytes)) })),
        isolatedContext: true, reexportByteIdentical: true, importSaveReload: true }
    })
    for (const [id, method, description] of [
      ['M06', 'failures', 'provider, retrieval, decode, format and capacity failures preserve old project'],
      ['M07', 'storageFailures', 'quota/transaction abort preserve old head; activation failure recovers committed head'],
      ['M08', 'duplicates', 'duplicate confirmation, lost response and restored receipt never append twice'],
      ['M09', 'staleCandidates', 'edit, removed target, changed workspace and revoked permission reject stale candidates'],
      ['M10', 'cancellation', 'cancellation and timeout never adopt, retry or invoke a live provider'],
      ['M11', 'compatibility', 'old IndexedDB backups and absent/empty/existing assets retain compatibility'],
      ['M12', 'boundaries', 'exact and exceeded image, total, count, JSON and ZIP boundaries'],
      ['M13', 'multipleWriters', 'two tabs conflict instead of overwriting the newer saved head'],
    ]) await run(id, description, async () => {
      const item = await fresh()
      let evidence
      if (id === 'M13') {
        const other = await item.context.newPage(); await other.goto(`${origin}/ai-create`)
        await item.page.evaluate(async () => (await import('/tests/gallery-generation/browser-cases.js')).prepareWriter())
        await other.evaluate(async () => (await import('/tests/gallery-generation/browser-cases.js')).prepareWriter())
        const results = await Promise.all([item.page, other].map(p => p.evaluate(async () => (await import('/tests/gallery-generation/browser-cases.js')).writePrepared())))
        assert.equal(results.filter(r => r.ok).length, 1)
        assert.equal(results.filter(r => r.code === 'STORAGE_CONFLICT').length, 1)
        const record = await saved(item.page); assert.equal(record.sequence, 1)
        evidence = { results, sequence: record.sequence }
      } else evidence = await item.page.evaluate(async method => (await import('/tests/gallery-generation/browser-cases.js'))[method](), method)
      await closeContext(item.context); return evidence
    })
    assert.deepEqual(report.externalRequests, []); assert.deepEqual(report.aiRequests, []); assert.deepEqual(report.pageErrors, [])
    report.passed = true
  } catch (error) {
    report.error = error.stack
    throw error
  } finally {
    for (const c of contexts) await closeContext(c).catch(() => {})
    await browser?.close(); await server.close()
    report.finishedAt = new Date().toISOString()
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ passed: report.passed, cases: report.cases.map(c => ({ id: c.id, status: c.status })), output }, null, 2))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
