// Offline browser acceptance for generated filter/chart/details blocks.
// The model response is a local fixture; no upstream AI or external request is allowed.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

const spec = {
  version: 1,
  id: 'interactive-browser-fixture',
  name: '交互报名管理',
  entities: [{ id: 'applicants', name: '报名者', fields: [
    { id: 'name', name: '姓名', type: 'text', required: true },
    { id: 'department', name: '部门', type: 'select', required: true, options: ['技术部', '宣传部'] },
    { id: 'quantity', name: '人数', type: 'number', required: false },
  ] }],
  blocks: [
    { id: 'form', name: '报名表单', type: 'form', fieldIds: ['name', 'department', 'quantity'] },
    { id: 'list', name: '报名列表', type: 'list', fieldIds: ['name', 'department', 'quantity'] },
    { id: 'metric', name: '报名人数', type: 'metric', aggregation: 'count' },
    { id: 'filter', name: '搜索报名', type: 'filter', fieldIds: ['name', 'department'], targetBlockIds: ['list', 'metric', 'chart'] },
    { id: 'chart', name: '部门统计', type: 'chart', chartType: 'bar', groupFieldId: 'department', aggregation: 'count', targetBlockIds: ['list', 'metric'] },
    { id: 'details', name: '报名详情', type: 'details', fieldIds: ['name', 'department', 'quantity'], sourceBlockId: 'list' },
  ],
  relations: ['form', 'list', 'metric', 'filter', 'chart', 'details'].map(id => ({ id: id + '-binding', type: 'dataBinding', blockId: id, entityId: 'applicants' })),
}

async function run() {
  const { createServer } = await import('vite')
  const nodeModules = await import('node:fs').then(fs => fs.realpathSync(path.join(root, 'node_modules')))
  const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, fs: { allow: [root, nodeModules] } } })
  let browser
  const external = [], errors = []
  try {
    await server.listen()
    const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' })
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) { external.push(url.href); return route.abort('blockedbyclient') }
      if (url.pathname === '/api/studio/status') return route.fulfill({ status: 503, json: { error: 'offline fixture' } })
      if (url.pathname === '/api/mochi-plan/status') return route.fulfill({ json: { enabled: false } })
      if (url.pathname === '/api/mochi-ai/status') return route.fulfill({ json: { enabled: false, proactiveEnabled: false, modificationsEnabled: false } })
      if (url.pathname === '/api/ai/generate') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(spec) })
      return route.continue()
    })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin + '/ai-create')
    await page.getByLabel('你想做什么软件？').fill('创建一个可搜索、可统计并能查看详情的报名工具')
    await page.getByRole('button', { name: '生成应用', exact: true }).click()
    await expect(page.getByRole('heading', { name: '交互报名管理', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()

    const list = page.getByRole('region', { name: '报名列表', exact: true })
    await list.getByRole('button', { name: '新增记录', exact: true }).click()
    await list.getByLabel('姓名', { exact: false }).fill('小林')
    await list.getByLabel('部门', { exact: false }).selectOption('技术部')
    await list.getByLabel('人数', { exact: true }).fill('2')
    await list.getByRole('button', { name: '提交', exact: true }).click()
    await list.getByRole('button', { name: '新增记录', exact: true }).click()
    await list.getByLabel('姓名', { exact: false }).fill('小王')
    await list.getByLabel('部门', { exact: false }).selectOption('宣传部')
    await list.getByLabel('人数', { exact: true }).fill('1')
    await list.getByRole('button', { name: '提交', exact: true }).click()
    await expect(list.locator('tbody tr')).toHaveCount(2)
    await expect(page.getByRole('region', { name: '报名人数', exact: true }).locator('output')).toHaveText('2')

    const filter = page.getByRole('region', { name: '搜索报名', exact: true })
    await filter.getByRole('searchbox').fill('小林')
    await expect(list.locator('tbody tr')).toHaveCount(1)
    await expect(page.getByRole('region', { name: '报名人数', exact: true }).locator('output')).toHaveText('1')
    await expect(page.getByRole('region', { name: '部门统计', exact: true })).toContainText('技术部：1')

    const chart = page.getByRole('region', { name: '部门统计', exact: true })
    await chart.getByRole('button', { name: /技术部：1/ }).click()
    await expect(list.locator('tbody tr')).toHaveCount(1)
    await list.getByRole('button', { name: '查看详情', exact: true }).click()
    await expect(page.getByRole('region', { name: '报名详情', exact: true })).toContainText('小林')
    await expect(page.getByRole('region', { name: '报名详情', exact: true })).toContainText('技术部')
    assert.deepEqual(external, [])
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ passed: true, generated: ['filter', 'chart', 'details'], records: 2, filteredRecords: 1, externalRequests: external, pageErrors: errors }, null, 2))
  } finally {
    await browser?.close()
    await server.close()
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
