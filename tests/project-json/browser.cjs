const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createClubRegistrationExample, createAppRuntime } = require('../custom-block/fixtures.cjs')
const { parseProjectJsonText } = require('../../src/integrations/project-json/format.ts')

const root = path.resolve(__dirname, '../..')

async function main() {
  const { createServer } = await import('vite')
  const fontRoot = path.dirname(require.resolve('@fontsource/pixelify-sans/package.json'))
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 5218, strictPort: true, fs: { allow: [root, fontRoot] } } })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'blockcraft-project-json-'))
  try {
    await server.listen()
    const page = await browser.newPage({ viewport: { width: 1280, height: 920 }, acceptDownloads: true })
    const external = [], errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.hostname !== '127.0.0.1') { external.push(url.href); return route.abort() }
      if (url.pathname === '/api/ai/generate') return route.fulfill({ json: createClubRegistrationExample().spec })
      if (url.pathname === '/api/mochi-ai/status') return route.fulfill({ status: 503, json: { error: { code: 'AI_UNAVAILABLE' } } })
      if (url.pathname.startsWith('/api/')) return route.abort()
      return route.continue()
    })

    const generationInput = page.getByLabel('你想做什么软件？')
    await page.goto('http://127.0.0.1:5218/ai-create')
    await generationInput.fill('JSON 往返离线验收')
    await page.getByRole('button', { name: '生成应用', exact: true }).click()
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    const form = page.getByRole('region', { name: '报名表', exact: true })
    await form.getByLabel('姓名', { exact: false }).fill('JSON 保留记录')
    await form.getByLabel('意向部门', { exact: false }).selectOption('技术部')
    await form.getByRole('button', { name: '提交', exact: true }).click()
    await expect(page.getByRole('cell', { name: 'JSON 保留记录', exact: true })).toBeVisible()

    const saved = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载项目 JSON', exact: true }).click()
    const download = await saved
    assert.equal(download.suggestedFilename(), 'blockcraft-project.json')
    const projectFile = path.join(temp, 'blockcraft-project.json')
    await download.saveAs(projectFile)
    const raw = JSON.parse(await fs.readFile(projectFile, 'utf8'))
    assert.equal(raw.format, 'blockcraft-project')
    const entity = raw.project.base.spec.entities[0]
    const nameField = entity.fields.find(field => field.name === '姓名')
    assert(nameField)
    assert.equal(raw.project.base.records[entity.id][0].values[nameField.id], 'JSON 保留记录')
    await parseProjectJsonText(await fs.readFile(projectFile, 'utf8'))
    const browserParse = await page.evaluate(async text => {
      try { await import('/src/integrations/project-json/format.ts').then(module => module.parseProjectJsonText(text)); return null }
      catch (error) { return { message: error.message, code: error.code, stack: error.stack } }
    }, await fs.readFile(projectFile, 'utf8'))
    assert.equal(browserParse, null, JSON.stringify(browserParse))

    await page.reload()
    await page.locator('.project-json-landing-import input[type=file]').setInputFiles(projectFile)
    await expect(page.getByRole('heading', { name: '社团迎新报名' })).toBeVisible()
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    await expect(page.getByRole('cell', { name: 'JSON 保留记录', exact: true })).toBeVisible()

    // A failed backup must abort replacement and leave the live records intact.
    await page.evaluate(() => {
      window.__blockcraftIndexedDb = window.indexedDB
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined })
    })
    await page.locator('.workshop-json-controls input[type=file]').setInputFiles(projectFile)
    await expect(page.getByRole('alert').filter({ hasText: '本地备份' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'JSON 保留记录', exact: true })).toBeVisible()
    await page.evaluate(() => Object.defineProperty(window, 'indexedDB', { configurable: true, value: window.__blockcraftIndexedDb }))
    await page.locator('.workshop-json-controls input[type=file]').setInputFiles(projectFile)
    await expect(page.getByRole('button', { name: '下载备份 JSON', exact: true })).toBeVisible()
    const backup = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载备份 JSON', exact: true }).click()
    const backupDownload = await backup
    assert.equal(backupDownload.suggestedFilename(), 'blockcraft-project-backup.json')
    const backupPath = path.join(temp, backupDownload.suggestedFilename())
    await backupDownload.saveAs(backupPath)
    const backupJson = JSON.parse(await fs.readFile(backupPath, 'utf8'))
    assert.equal(backupJson.project.base.records[entity.id][0].values[nameField.id], 'JSON 保留记录')
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()

    const corrupted = path.join(temp, 'corrupted.json')
    await fs.writeFile(corrupted, '{ invalid')
    await page.locator('.workshop-json-controls input[type=file]').setInputFiles(corrupted)
    await expect(page.getByRole('alert').filter({ hasText: '当前项目未更改' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'JSON 保留记录', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '恢复所选备份', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '恢复所选备份', exact: true }).click()
    await expect(page.getByRole('heading', { name: '社团迎新报名' })).toBeVisible()
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    await expect(page.getByRole('cell', { name: 'JSON 保留记录', exact: true })).toBeVisible()
    assert.deepEqual(external, [])
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ passed: true, cases: ['JSON download contains records', 'refresh then landing import restores records', 'replacement persists and downloads full local backup', 'refresh then local backup restore preserves records', 'invalid import preserves current records', 'no external requests', 'no page errors'] }))
  } finally {
    await browser.close()
    await server.close()
    await fs.rm(temp, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
