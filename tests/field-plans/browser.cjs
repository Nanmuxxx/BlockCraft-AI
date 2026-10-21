const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises'), path = require('node:path')
const root = path.resolve(__dirname, '../..'), live = process.argv.includes('--live')
const output = path.resolve(process.env.MVP_EVIDENCE || path.join(root, '.cache/field-plans', live ? 'live' : 'offline'))
async function run() {
  let server, browser, context
  const report = { startedAt: new Date().toISOString(), live, cases: [], errors: [], modelResponses: [] }
  try {
    await fs.mkdir(output, { recursive: true })
    let origin = process.env.MVP_ORIGIN
    if (!live) {
      const { startMvpServer } = await import('../../tools/mvp-fields/serve.mjs')
      server = await startMvpServer({ fixture: true, fetchImpl: async (_url, init) => {
        const input = JSON.parse(JSON.parse(init.body).messages[1].content)
        const note = input.entity.fields.find(f => f.name === '备注')
        const hide = input.prompt.includes('隐藏'), id = note?.id || 'optional-note'
        const commands = [...(!note ? [{ type: 'addField', entityId: input.entity.id, field: { id, name: '备注', type: 'text', required: false } }] : []),
          { type: 'configureBlockFields', blockId: input.block.id, fieldIds: hide ? input.block.fieldIds.filter(f => f !== id) : [...new Set([...input.block.fieldIds, id])] }]
        return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ request: { requestId: input.requestId, baseRevision: input.baseRevision, commands }, capabilityIds: [] }) } }] })
      } }); origin = server.origin
    }
    assert.ok(origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'explicit loopback MVP_ORIGIN required for live run')
    report.origin = origin
    browser = await chromium.launch({ headless: true })
    for (const width of live ? [1440] : [1440, 390]) {
      context = await browser.newContext({ viewport: { width, height: 1000 }, recordVideo: { dir: output }, serviceWorkers: 'block' })
      const page = await context.newPage()
      page.on('pageerror', e => report.errors.push(e.message))
      page.on('response', async r => {
        if (r.url().endsWith('/api/mochi-plan') || r.url().endsWith('/api/ai/generate')) {
          try { const body = await r.json(); report.modelResponses.push({ path: new URL(r.url()).pathname, status: r.status(), source: body.source, candidate: body.candidate }) } catch {}
        }
      })
      await page.goto(origin + '/__field-plans' + (live ? '?generate' : ''))
      if (live) await page.getByRole('button', { name: '生成社团报名应用', exact: true }).click()
      await expect.poll(() => page.evaluate(() => Boolean(window.fieldQA?.runtime)), { timeout: 40000 }).toBe(true)
      const snapshot = () => page.evaluate(() => ({ base: window.fieldQA.runtime.getSnapshot(), project: window.fieldQA.runtime.customProject.getSnapshot() }))
      const initial = await snapshot(), form = initial.base.spec.blocks.find(b => b.type === 'form')
      assert.ok(form)
      const entityId = initial.base.spec.relations.find(r => r.blockId === form.id && r.type === 'dataBinding').entityId
      const entity = initial.base.spec.entities.find(e => e.id === entityId)
      const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })
      const c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
      const seedRecord = async withNote => {
        await c.click()
        const ui = page.locator('#generated-preview .renderer-block--form form')
        for (const field of entity.fields) {
          const control = ui.getByLabel(field.name, { exact: false })
          if (field.type === 'select') await control.selectOption(field.options[0])
          else if (field.type === 'boolean') await control.check()
          else await control.fill(field.type === 'number' ? '1' : field.type === 'date' ? '2026-10-21' : field.name.includes('邮箱') ? 'demo@example.com' : '演示用户')
        }
        if (withNote) await ui.getByLabel('备注', { exact: false }).fill('隐藏后仍保留的备注')
        await ui.getByRole('button', { name: /添加|提交|报名|保存/ }).click()
        await b.click()
      }
      if (live) await seedRecord(false)
      const block = page.locator(`[data-block-key="builtin:${form.id}"]`)
      await block.click(); await page.mouse.move(0, 0); await page.waitForTimeout(200)
      if (live) {
        await block.scrollIntoViewIfNeeded(); const box = await block.boundingBox()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 700, { steps: 30 }); await page.mouse.up()
        await expect.poll(async () => (await snapshot()).project.renderOrder.at(-1).id).toBe(form.id)
      }
      let preserved = await snapshot(), noteId
      const input = page.getByRole('textbox', { name: '给 Mochi 发消息' })
      await expect(input).toBeEnabled({ timeout: 10000 })
      const prompts = [
        ['add', '请在选中的报名表末尾新增一个可选文本字段，名称为“备注”，保留已有字段。'],
        ['hide', '请隐藏选中表单的“备注”字段，只隐藏展示，保留字段及所有数据。'],
        ['restore', '请恢复展示已有的“备注”字段，使用现有字段 ID，不要新增字段，保留其他字段。'],
      ]
      for (const [action, prompt] of prompts) {
        const before = await snapshot()
        await input.fill(prompt); await page.locator('.mochi-ai').getByRole('button', { name: '发送', exact: true }).click()
        const preview = page.getByRole('region', { name: '修改计划预览' })
        await expect(preview).toBeVisible({ timeout: 40000 })
        assert.deepEqual(await snapshot(), before, 'preview must not write project')
        await page.screenshot({ path: path.join(output, `${width}-${action}-preview.png`), fullPage: true })
        await page.getByRole('button', { name: '确认', exact: true }).click()
        await expect(preview).toHaveCount(0)
        await expect.poll(async () => (await snapshot()).base.revision).toBe(before.base.revision + 1)
        const after = await snapshot(), fields = after.base.spec.entities.find(e => e.id === entityId).fields
        noteId ||= fields.find(f => f.name === '备注')?.id
        assert.ok(noteId); assert.equal(fields.filter(f => f.id === noteId).length, 1)
        assert.equal(fields.length, entity.fields.length + 1)
        assert.equal(after.base.spec.blocks.find(b => b.id === form.id).fieldIds.includes(noteId), action !== 'hide')
        assert.deepEqual(after.base.records, preserved.base.records)
        assert.deepEqual(after.project.renderOrder, preserved.project.renderOrder)
        assert.deepEqual(after.base.blockPositions, preserved.base.blockPositions)
        await c.click()
        await expect(page.locator('#generated-preview .renderer-block--form').getByLabel('备注', { exact: false })).toHaveCount(action === 'hide' ? 0 : 1)
        await page.screenshot({ path: path.join(output, `${width}-${action}-C.png`), fullPage: true })
        await b.click()
        report.cases.push({ width, action, revision: after.base.revision, noteId, previewNoWrites: true, recordPreserved: true, orderPreserved: true, passed: true })
        if (live && action === 'add') { await seedRecord(true); preserved = await snapshot(); assert.ok(preserved.base.records[entityId].some(r => r.values[noteId] === '隐藏后仍保留的备注')) }
      }
      const saved = await snapshot(), loaded = await page.evaluate(async () => window.fieldQA.roundTrip())
      assert.deepEqual(loaded.renderOrder, saved.project.renderOrder)
      assert.deepEqual(loaded.base, saved.project.base)
      await c.click()
      if (live) {
        const expectedNames = saved.project.renderOrder.map(item => saved.base.spec.blocks.find(b => b.id === item.id).name)
        assert.deepEqual(await page.locator('#generated-preview .renderer-block > h2').allTextContents(), expectedNames)
        await page.setViewportSize({ width: 390, height: 844 })
        await expect(page.locator('#generated-preview .renderer-block--form').getByLabel('备注', { exact: false })).toBeVisible()
        assert.deepEqual((await snapshot()).project.renderOrder, saved.project.renderOrder)
        await page.screenshot({ path: path.join(output, '390-live-restored-C.png'), fullPage: true })
      }
      await context.close(); context = null
    }
    report.budget = await fetch(origin + '/api/mvp-audit').then(r => r.json())
    if (live) {
      assert.equal(report.budget.source, 'deepseek'); assert.equal(report.budget.halted, false)
      assert.ok(report.budget.calls >= 4 && report.budget.calls <= 6)
      assert.ok(report.budget.reservedCny <= 1 && report.budget.estimatedCny <= 5)
      assert.equal(report.modelResponses.filter(r => r.path === '/api/mochi-plan' && r.source === 'deepseek' && r.status === 200).length, 3)
    }
    assert.deepEqual(report.errors, []); report.passed = true
  } catch (e) { report.failure = e.message; throw e }
  finally {
    report.completedAt = new Date().toISOString()
    await context?.close(); await browser?.close(); await server?.close()
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  }
  console.log(JSON.stringify({ passed: report.passed, live, cases: report.cases.length, budget: report.budget, output }))
}
run().catch(e => { console.error(e); process.exitCode = 1 })
