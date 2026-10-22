// Real Chromium + production UI/HTTP provider/Host/Runtime/ZIP. All model JSON is offline.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path')
const root = path.resolve(__dirname, '../..')
const output = process.env.CONTROLLED_EDIT_OUTPUT || path.join(root, '.cache/controlled-edit/browser')
const withoutRevision = value => { const next = structuredClone(value); delete next.revision; return next }
async function run() {
  const { createServer } = await import('vite')
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } })
  let browser, page, context
  const report = { startedAt: new Date().toISOString(), realAiCalls: 0, cases: [], errors: [], externalRequests: [], plans: [] }
  try {
    await fs.mkdir(output, { recursive: true }); await server.listen()
    const origin = server.resolvedUrls.local[0].endsWith('/') ? server.resolvedUrls.local[0].slice(0, -1) : server.resolvedUrls.local[0]
    browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'] })
    report.browserVersion = browser.version()
    for (const width of [1440, 390]) {
      context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' })
      page = await context.newPage()
      let expected = null, operation = 'form'
      const snapshots = () => page.evaluate(() => structuredClone(window.controlledEditQA.runtime.customProject.getSnapshot()))
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url())
        if (url.origin !== origin) { report.externalRequests.push(url.origin); return route.abort('blockedbyclient') }
        if (!url.pathname.startsWith('/api/')) return route.continue()
        if (url.pathname === '/api/mochi-plan/status') return route.fulfill({ json: { enabled: true } })
        if (url.pathname === '/api/mochi-ai/status') return route.fulfill({ json: { enabled: false, proactiveEnabled: false, modificationsEnabled: true } })
        if (url.pathname === '/api/mochi-plan') {
          const input = request.postDataJSON(), before = await snapshots(), id = input.block.id
          assert.equal(JSON.stringify(input).includes('data:image'), false, 'model sees asset metadata only')
          assert.equal(JSON.stringify(input).includes('小林'), false, 'model must not receive business records')
          let commands = [], capabilityIds = []
          expected = structuredClone(before); expected.revision++
          const block = expected.base.spec.blocks.find(item => item.id === id)
          if (operation === 'form') {
            commands = [{ type: 'configureBlockPresentation', blockId: id, presentation: { buttonText: '保存作品', backgroundColor: '#E9F3EF' } }]
            block.presentation = { ...block.presentation, ...commands[0].presentation }
          } else if (operation === 'gallery') {
            commands = [{ type: 'configureGallery', blockId: id, imageIds: ['fixture-png'], layout: 'grid' }]
            block.imageIds = ['fixture-png']
          } else if (operation === 'metric') {
            commands = [{ type: 'configureMetric', blockId: id, aggregation: 'sum', fieldId: 'quantity' }]
            block.aggregation = 'sum'; block.fieldId = 'quantity'
          } else if (operation === 'add') {
            const added = { id: 'gallery-2', name: '推荐图库', type: 'gallery', protocolVersion: 1, imageIds: ['fixture-png'], layout: 'grid', interaction: 'preview' }
            commands = [{ type: 'addBlock', block: added }]; capabilityIds = ['gallery']
            expected.base.spec.blocks.push(added); expected.renderOrder.push({ kind: 'builtin', id: added.id })
          } else if (operation === 'remove') {
            commands = [{ type: 'removeBlock', blockId: id }]
            expected.base.spec.blocks = expected.base.spec.blocks.filter(item => item.id !== id)
            expected.base.spec.relations = expected.base.spec.relations.filter(item => item.blockId !== id)
            delete expected.base.blockPositions[id]
            expected.renderOrder = expected.renderOrder.filter(item => item.id !== id)
          } else if (operation === 'order') {
            const ids = expected.renderOrder.filter(item => item.kind === 'builtin').map(item => item.id)
            const order = [id, ...ids.filter(item => item !== id)]
            commands = [{ type: 'reorderBlocks', blockIds: order }]
            expected.base.spec.blocks = order.map(id => expected.base.spec.blocks.find(item => item.id === id))
            expected.renderOrder = order.map(id => ({ kind: 'builtin', id }))
          } else if (operation === 'invalid') {
            commands = [{ type: 'configureBlockPresentation', blockId: id, presentation: { borderRadius: 8 } }, { type: 'configureGallery', blockId: id, imageIds: ['unknown-resource'] }]
          } else if (operation === 'failure' || operation === 'stale') {
            commands = [{ type: 'configureGallery', blockId: id, imageIds: [] }]
            block.imageIds = []
          }
          report.plans.push({ width, operation, type: input.block.type, revision: input.baseRevision, commands })
          return route.fulfill({ json: { source: 'offline-fixture', model: 'deterministic-controlled-edit', candidate: { request: { requestId: input.requestId, baseRevision: input.baseRevision, commands }, capabilityIds } } })
        }
        report.errors.push('Unexpected local API: ' + url.pathname); return route.abort('blockedbyclient')
      })
      page.on('pageerror', error => report.errors.push(error.message))
      await page.goto(origin + '/tests/controlled-edit/index.html')
      await expect(page.locator('[data-block-key="builtin:registration-form"]')).toBeVisible()
      const select = async id => { await page.locator('[data-block-key="builtin:' + id + '"]').click(); await page.mouse.move(0, 0) }
      const input = page.getByRole('textbox', { name: '给 Mochi 发消息', exact: true })
      const preview = page.getByRole('region', { name: '修改计划预览', exact: true })
      const submit = async (op, id, prompt) => {
        operation = op; await select(id); await expect(input).toBeEnabled(); const before = await snapshots()
        await input.fill(prompt); await page.locator('.mochi-ai').getByRole('button', { name: '发送', exact: true }).click()
        await expect(preview).toBeVisible(); assert.deepEqual(await snapshots(), before, 'request/preview performs zero writes')
        return before
      }
      for (const [op, id, prompt, diffText] of [
        ['form', 'registration-form', '把报名表按钮改成保存作品，并使用浅绿色背景', '保存作品'],
        ['gallery', 'gallery-1', '把项目已有的四像素图片放进作品图库', 'fixture-png'],
        ['metric', 'applicant-total', '把报名人数改成数量合计，使用数量字段', 'sum'],
        ['add', 'gallery-1', '新增一个推荐图库，使用现有图片资源', '推荐图库'],
        ['remove', 'gallery-2', '删除选中的推荐图库，保留资源', '推荐图库'],
        ['order', 'gallery-1', '把选中的作品图库移到所有积木之前', 'gallery-1'],
      ]) {
        const before = await submit(op, id, prompt)
        await expect(preview).toContainText(diffText)
        await page.screenshot({ path: path.join(output, width + '-' + op + '-preview.png'), fullPage: true })
        await preview.getByRole('button', { name: '确认', exact: true }).click(); await expect(preview).toHaveCount(0)
        assert.deepEqual(await snapshots(), expected, 'committed project equals independently computed visible preview')
        const applied = await snapshots()
        await page.getByRole('button', { name: '撤销结构修改', exact: true }).click()
        await expect.poll(async () => (await snapshots()).revision).toBe(applied.revision + 1)
        assert.deepEqual(withoutRevision(await snapshots()), withoutRevision(before))
        // Reapply after proving undo so the final ZIP contains each intended change.
        await submit(op, id, prompt)
        await preview.getByRole('button', { name: '确认', exact: true }).click()
        await expect(preview).toHaveCount(0)
        assert.deepEqual(await snapshots(), expected)
        report.cases.push({ width, operation: op, isolatedPreview: true, exactCommit: true, fullUndo: true, passed: true })
      }
      operation = 'invalid'; await select('gallery-1'); const invalidBefore = await snapshots()
      await input.fill('引用不存在的图片'); await page.locator('.mochi-ai').getByRole('button', { name: '发送', exact: true }).click()
      await expect(page.locator('.mochi-ai').getByRole('alert')).toBeVisible(); await expect(preview).toHaveCount(0)
      assert.deepEqual(await snapshots(), invalidBefore)
      await submit('failure', 'gallery-1', '清空图库')
      await page.evaluate(() => window.controlledEditQA.runtime.customProject.setReadOnly(true))
      await expect(preview).toHaveCount(0)
      assert.deepEqual(await snapshots(), invalidBefore)
      await page.evaluate(() => window.controlledEditQA.runtime.customProject.setReadOnly(false))
      await submit('stale', 'gallery-1', '清空图库')
      await page.evaluate(() => window.controlledEditQA.runtime.moveBlock('registration-form', { x: .25, y: .2 }))
      await expect(preview).toHaveCount(0)
      const modified = await snapshots()
      assert.deepEqual(modified.base.spec.blocks.find(b => b.id === 'gallery-1').imageIds, ['fixture-png'])
      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: '下载项目 ZIP', exact: true }).click()
      const download = await downloadPromise, zipPath = path.join(output, width + '-modified-project.zip')
      await download.saveAs(zipPath)
      await page.locator('.workshop-json-controls input[type=file]').setInputFiles(zipPath)
      await expect.poll(() => page.evaluate(() => window.controlledEditQA.imports)).toBe(1)
      assert.deepEqual(await snapshots(), modified, 'ZIP UI restore retains every configuration, resource data URL and order')
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      await expect(page.locator('#generated-preview .renderer-block--gallery img')).toBeVisible()
      await expect(page.locator('#generated-preview .renderer-block--metric')).toContainText('12')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.screenshot({ path: path.join(output, width + '-zip-restored.png'), fullPage: true })
      report.cases.push({ width, operation: 'rejection-and-zip', invalidNoWrites: true, authorizationRejects: true, staleRejects: true, exactZipRestore: true, passed: true })
      await context.close(); context = null
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true
  } catch (error) {
    report.failure = error.message
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    report.completedAt = new Date().toISOString(); await context?.close(); await browser?.close(); await server.close()
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  }
  console.log(JSON.stringify(report, null, 2))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
