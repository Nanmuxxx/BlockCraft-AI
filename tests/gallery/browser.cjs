// Run with a Playwright Chromium installation:
// PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium node tests/gallery/browser.cjs
// The test uses a fixed offline AppSpec response; it does not call a model or a
// remote service. The local ZIP endpoint is enabled only by Vite's local-export mode.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')

async function downloadProject(page, filePath) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载项目 JSON', exact: true }).click()
  const file = await download
  assert.equal(file.suggestedFilename(), 'blockcraft-project.json')
  await file.saveAs(filePath)
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function gallerySpec() {
  return {
    version: 1,
    id: 'gallery-offline-app',
    name: '离线图片画廊',
    entities: [],
    relations: [],
    blocks: [{ id: 'gallery-1', name: '作品画廊', type: 'gallery', protocolVersion: 1, imageIds: [], layout: 'grid', interaction: 'preview' }],
  }
}

async function main() {
  const { createServer } = await import('vite')
  const { unzip } = await import('../project-zip-export/fixtures.mjs')
  const fontRoot = path.dirname(require.resolve('@fontsource/pixelify-sans/package.json'))
  const server = await createServer({ root, mode: 'local-export', server: { host: '127.0.0.1', port: 5227, strictPort: true, fs: { allow: [root, fontRoot] } } })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'blockcraft-gallery-'))
  const screenshotDir = process.env.GALLERY_SCREENSHOT_DIR
  if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true })
  const report = { passed: true, browser: browser.version(), cases: [], externalRequests: [], pageErrors: [] }
  try {
    await server.listen()
    for (const viewport of [{ name: 'desktop', width: 1280, height: 920 }, { name: 'mobile', width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.name === 'mobile', hasTouch: viewport.name === 'mobile', acceptDownloads: true })
      const planRequests = []
      page.on('pageerror', error => report.pageErrors.push(`${viewport.name}: ${error.message}`))
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname !== '127.0.0.1') { report.externalRequests.push(url.href); return route.abort() }
        if (url.pathname === '/api/ai/generate') return route.fulfill({ json: gallerySpec() })
        if (url.pathname === '/api/mochi-ai/status') return route.fulfill({ status: 503, json: { error: { code: 'AI_UNAVAILABLE' } } })
        if (url.pathname === '/api/mochi-plan/status') return route.fulfill({ json: { enabled: true } })
        if (url.pathname === '/api/mochi-plan') {
          assert.equal(route.request().method(), 'POST')
          const input = route.request().postDataJSON()
          assert.equal(input.block.type, 'gallery')
          assert.match(input.block.id, /^gallery-[12]$/)
          assert.equal(input.assets.length, 1)
          assert.deepEqual(Object.keys(input.assets[0]).sort(), ['altText', 'id', 'mimeType', 'name'])
          assert.equal(JSON.stringify(input).includes('data:image'), false)
          planRequests.push(input)
          const command = input.prompt.startsWith('新增')
            ? { type: 'addBlock', block: { id: 'gallery-2', name: '推荐画廊', type: 'gallery', protocolVersion: 1, imageIds: input.assets.map(asset => asset.id), layout: 'grid', interaction: 'preview' } }
            : input.prompt.startsWith('删除')
              ? { type: 'removeBlock', blockId: input.block.id }
              : { type: 'configureGallery', blockId: input.block.id, imageIds: input.prompt.startsWith('隐藏') ? [] : input.assets.map(asset => asset.id), layout: 'grid' }
          const capabilityIds = command.type === 'addBlock' ? ['gallery'] : []
          return route.fulfill({ json: {
            source: 'offline-fixture', model: 'gallery-browser-fixture',
            candidate: { request: { requestId: input.requestId, baseRevision: input.baseRevision,
              commands: [command] }, capabilityIds },
          } })
        }
        if (url.pathname.startsWith('/api/') && url.pathname !== '/api/local-project-export') return route.fulfill({ status: 503, json: { enabled: false } })
        return route.continue()
      })

      await page.goto('http://127.0.0.1:5227/ai-create')
      await page.getByLabel('你想做什么软件？').fill('离线图片画廊验收')
      await page.getByRole('button', { name: '生成应用', exact: true }).click()
      await expect(page.getByRole('heading', { name: '离线图片画廊', exact: true })).toBeVisible()

      const galleryCard = page.locator('[data-block-key="builtin:gallery-1"]')
      await page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }).click()
      await galleryCard.click()
      const inspector = page.getByRole('complementary', { name: '积木属性', exact: true })
      await expect(inspector).toContainText('项目图片')
      const upload = inspector.locator('input[type=file]')
      await upload.setInputFiles({ name: '1px.png', mimeType: 'image/png', buffer: pngBytes })
      await expect(inspector).toContainText('1px.png')
      const assetCheckbox = inspector.locator('fieldset input[type=checkbox]').first()
      await assetCheckbox.check()
      await expect(assetCheckbox).toBeChecked()
      await expect(inspector).toContainText('布局：网格')

      const baseline = await downloadProject(page, path.join(temp, `${viewport.name}-baseline.json`))
      const originalImageIds = baseline.project.base.spec.blocks[0].imageIds
      const mochi = page.locator('.mochi-ai')
      const planPreview = mochi.getByRole('region', { name: '修改计划预览', exact: true })
      for (const [index, prompt] of ['隐藏当前画廊图片', '恢复当前画廊图片'].entries()) {
        const before = await downloadProject(page, path.join(temp, `${viewport.name}-before-${index}.json`))
        await mochi.getByRole('textbox', { name: '给 Mochi 发消息', exact: true }).fill(prompt)
        await mochi.getByRole('button', { name: '发送', exact: true }).click()
        await expect(planPreview).toBeVisible()
        await expect(planPreview).toContainText('configureGallery')
        const pending = await downloadProject(page, path.join(temp, `${viewport.name}-pending-${index}.json`))
        assert.deepEqual(pending, before, 'preview must not mutate project state')
        await expect(assetCheckbox).toBeChecked({ checked: index === 0 })
        await planPreview.getByRole('button', { name: '确认', exact: true }).click()
        await expect(planPreview).toBeHidden()
        await expect(mochi.getByRole('region', { name: '计划状态', exact: true })).toContainText('本次修改已应用')
        await expect(assetCheckbox).toBeChecked({ checked: index === 1 })
        const applied = await downloadProject(page, path.join(temp, `${viewport.name}-applied-${index}.json`))
        assert.equal(applied.project.revision, before.project.revision + 1)
        assert.deepEqual(applied.project.base.spec.blocks[0].imageIds, index === 0 ? [] : originalImageIds)
        assert.deepEqual(applied.project.base.assets, before.project.base.assets)
      }
      assert.equal(planRequests.length, 2)
      assert.equal(planRequests[0].baseRevision, baseline.project.revision)
      assert.equal(planRequests[1].baseRevision, baseline.project.revision + 1)
      assert.notEqual(planRequests[0].requestId, planRequests[1].requestId)

      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      const preview = page.getByRole('region', { name: '作品画廊', exact: true })
      await expect(preview).toBeVisible()
      const imageButton = preview.getByRole('button', { name: '预览 1px.png', exact: true })
      await expect(imageButton).toBeVisible()
      await expect(imageButton.locator('img')).toHaveJSProperty('naturalWidth', 1)
      await imageButton.click()
      const dialog = page.getByRole('dialog', { name: '预览 1px.png', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: '关闭图片预览', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: '关闭图片预览', exact: true })).toBeFocused()
      await dialog.getByRole('button', { name: '关闭图片预览', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(imageButton).toBeFocused()
      await imageButton.click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(imageButton).toBeFocused()

      // Save the exact runtime, then refresh and restore through the landing import.
      const jsonPath = path.join(temp, `${viewport.name}-gallery.json`)
      const saved = await downloadProject(page, jsonPath)
      assert.equal(saved.project.base.spec.blocks[0].imageIds.length, 1)
      assert.equal(Object.keys(saved.project.base.assets ?? {}).length, 1)

      await page.reload()
      const landingImport = page.locator('.project-json-landing-import input[type=file]')
      await landingImport.setInputFiles(jsonPath)
      await expect(page.getByRole('heading', { name: '离线图片画廊', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      const restoredPreview = page.getByRole('region', { name: '作品画廊', exact: true })
      await expect(restoredPreview.getByRole('button', { name: '预览 1px.png', exact: true })).toBeVisible()

      const zipDownload = page.waitForEvent('download')
      await page.getByRole('button', { name: '导出 React 项目', exact: true }).click()
      const zip = await zipDownload
      assert.equal(zip.suggestedFilename(), 'blockcraft-project.zip')
      const zipPath = path.join(temp, `${viewport.name}-gallery.zip`)
      await zip.saveAs(zipPath)
      assert((await fs.stat(zipPath)).size > 0)
      const zipFiles = unzip(await fs.readFile(zipPath))
      assert(zipFiles.has('src/components/GalleryBlock.tsx'))
      const dataText = zipFiles.get('src/data.ts')
      const dataStart = dataText.indexOf(' = ') + 3
      const exported = JSON.parse(dataText.slice(dataStart).split('\n', 1)[0].replace(/;$/, ''))
      assert.deepEqual(Object.fromEntries(Object.entries(exported.base.assets).map(([id, asset]) => [id, { ...asset, dataUrl: undefined }])),
        Object.fromEntries(Object.entries(saved.project.base.assets).map(([id, asset]) => [id, { ...asset, dataUrl: undefined }])))
      for (const asset of Object.values(saved.project.base.assets)) {
        const matchingChunks = [...zipFiles.entries()]
          .filter(([name]) => name.startsWith('src/assets/asset-') && name.endsWith('.ts'))
          .map(([, source]) => source.match(/export default (.*);/)?.[1] ?? '')
        assert(matchingChunks.some(chunk => chunk.includes(asset.dataUrl.slice(0, 32))), `missing exported asset chunk for ${asset.id}`)
      }
      assert.deepEqual(exported.base.spec.blocks, saved.project.base.spec.blocks)
      await expect(page.locator('#workshop-export-feedback')).toContainText('已发起下载')
      // Exercise Mochi's structural gallery commands through the same preview and
      // explicit confirmation UI used for configuration edits.
      await page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }).click()
      await page.locator('[data-block-key="builtin:gallery-1"]').click()
      await mochi.getByRole('textbox', { name: '给 Mochi 发消息', exact: true }).fill('新增一个画廊积木')
      await mochi.getByRole('button', { name: '发送', exact: true }).click()
      await expect(planPreview).toBeVisible()
      await expect(planPreview).toContainText('addBlock')
      await planPreview.getByRole('button', { name: '确认', exact: true }).click()
      await expect(page.locator('[data-block-key="builtin:gallery-2"]')).toBeVisible()
      await page.locator('[data-block-key="builtin:gallery-2"]').click()
      await mochi.getByRole('textbox', { name: '给 Mochi 发消息', exact: true }).fill('删除当前画廊积木')
      await mochi.getByRole('button', { name: '发送', exact: true }).click()
      await expect(planPreview).toBeVisible()
      await expect(planPreview).toContainText('removeBlock')
      await planPreview.getByRole('button', { name: '确认', exact: true }).click()
      await expect(page.locator('[data-block-key="builtin:gallery-2"]')).toHaveCount(0)
      assert.equal(planRequests.length, 4)
      assert.equal(planRequests[2].block.id, 'gallery-1')
      assert.equal(planRequests[3].block.id, 'gallery-2')
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${viewport.name}.png`), fullPage: true })
      report.cases.push({ viewport: viewport.name, passed: true, mochiPlans: planRequests.length, mochiStructuralCommands: ['addBlock', 'removeBlock'], confirmedRevision: saved.project.revision, jsonBytes: (await fs.stat(jsonPath)).size, zipBytes: (await fs.stat(zipPath)).size })
      await page.close()
    }
    assert.deepEqual(report.externalRequests, [])
    assert.deepEqual(report.pageErrors, [])
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
    await server.close()
    await fs.rm(temp, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
