// Optional Playwright regression against the real local HTTP route and Vite proxy.
// Only DeepSeek fetch is injected; no real key or paid upstream request.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const { mkdir } = require('node:fs/promises')
const { once } = require('node:events')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')

async function run() {
  const { cases } = await import('./fixtures.mjs')
  const { createServer: createViteServer } = await import('vite')
  const { createAppServer } = await import('../../server/index.mjs')
  const { buildGenerationMessages } = await import('../../server/aiGenerationPrompt.mjs')
  let candidate
  let mode = 'success'
  let calls = 0
  const backendOptions = { apiKey: 'offline-test-key', model: 'offline-browser-model', fetchImpl: async (url, options) => {
    calls++
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    const request = JSON.parse(options.body)
    assert.deepEqual(request.messages, buildGenerationMessages(candidate.idea))
    assert.equal(request.model, 'offline-browser-model')
    if (mode === 'failure') return new Response('', { status: 503 })
    if (mode === 'network') throw new TypeError('offline simulated connection failure')
    let spec = candidate.spec
    if (mode === 'invalid') spec = { version: 999 }
    if (mode === 'empty') spec = { version: 1, id: 'empty', name: '空应用', entities: [], blocks: [], relations: [] }
    if (mode === 'no-input') {
      spec = structuredClone(spec)
      spec.blocks = [{ id: spec.blocks[0].id, type: 'metric', name: '条数', aggregation: 'count' }]
    }
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec) } }] })
  } }
  let backend = createAppServer(backendOptions)
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const backendPort = backend.address().port
  const closeBackend = () => new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve) })
  const vite = await createViteServer({ root, server: { host: '127.0.0.1', port: 5193, strictPort: true, fs: { allow: [root, require('node:fs').realpathSync(path.join(root, 'node_modules'))] },
    proxy: { '/api': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: false } } } })
  let browser
  try {
    await vite.listen()
    await mkdir('/tmp/blockcraft-g2-audit', { recursive: true })
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const failures = []
    const assetFailures = []
    page.on('response', response => {
      if (!new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) assetFailures.push(response.url())
    })
    page.on('pageerror', error => failures.push(error.message))
    const responses = []
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/api/ai/generate') responses.push(response.status())
    })
    await page.goto('http://127.0.0.1:5193/ai-create')
    for (candidate of cases) {
      const prompt = page.getByLabel('你想做什么软件？')
      if (!await prompt.isVisible()) await page.locator('.ai-create-regenerate > summary').click()
      await prompt.fill(candidate.idea)
      await page.getByRole('button', { name: /^(生成应用|生成新应用|重试生成)$/ }).click()
      await expect(page.getByRole('heading', { name: candidate.spec.name, exact: true })).toBeVisible()
      // Current Workshop intentionally starts in B mode. Explicitly enter C.
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      for (const [entityId, records] of Object.entries(candidate.records)) {
        const entity = candidate.spec.entities.find(entity => entity.id === entityId)
        const binding = candidate.spec.relations.find(binding => binding.entityId === entityId
          && candidate.spec.blocks.some(block => block.id === binding.blockId && block.type === 'list'))
        const block = candidate.spec.blocks.find(block => block.id === binding.blockId)
        const region = page.getByRole('region', { name: block.name, exact: true })
        for (const values of records) {
          await region.getByRole('button', { name: '新增记录', exact: true }).click()
          for (const field of entity.fields) {
            const control = region.getByLabel(field.name, { exact: false })
            if (field.type === 'select' || field.type === 'boolean') await control.selectOption(String(values[field.id]))
            else await control.fill(String(values[field.id]))
          }
          await region.getByRole('button', { name: '提交', exact: true }).click()
        }
        assert.equal(await region.locator('tbody tr').count(), records.length)
      }
      for (const [blockId, value] of Object.entries(candidate.expectedMetrics)) {
        const block = candidate.spec.blocks.find(block => block.id === blockId)
        await expect(page.getByRole('region', { name: block.name, exact: true }).locator('output')).toHaveText(String(value))
      }
    }
    // Isolate failure scenarios from the seven successes; production rate limits stay intact.
    await closeBackend()
    backend = createAppServer(backendOptions)
    backend.listen(backendPort, '127.0.0.1')
    await once(backend, 'listening')
    candidate = cases.find(candidate => candidate.id === 'movie-log')
    await page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }).click()
    await page.getByRole('region', { name: '自定义与内置积木画布', exact: true }).getByRole('button', { name: '已看电影记录', exact: true }).click()
    const inspector = page.getByRole('complementary', { name: '积木属性', exact: true })
    await inspector.getByLabel('字段名称', { exact: true }).fill('导演')
    await inspector.getByRole('button', { name: '新增字段', exact: true }).click()
    await inspector.getByRole('checkbox', { name: '展示 导演', exact: true }).check()
    await page.screenshot({ path: '/tmp/blockcraft-g2-audit/generated-b.png', fullPage: true })
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    const region = page.getByRole('region', { name: '已看电影记录', exact: true })
    await region.getByRole('button', { name: '编辑', exact: true }).click()
    await region.getByLabel('电影名', { exact: false }).fill('保留的电影')
    await region.getByLabel('导演', { exact: true }).fill('宫崎骏')
    await region.getByRole('button', { name: '保存修改', exact: true }).click()
    await page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }).click()
    await expect(inspector.getByRole('checkbox', { name: '展示 导演', exact: true })).toBeChecked()
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    await expect(region.getByRole('cell', { name: '宫崎骏', exact: true })).toBeVisible()
    await page.screenshot({ path: '/tmp/blockcraft-g2-audit/generated-c.png', fullPage: true })
    if (!await page.getByLabel('你想做什么软件？').isVisible()) await page.locator('.ai-create-regenerate > summary').click()
    for (mode of ['failure', 'invalid', 'empty', 'no-input', 'network']) {
      await page.getByRole('button', { name: /^(生成新应用|重试生成)$/ }).click()
      await expect(page.getByRole('alert')).toContainText('当前应用和数据已保留')
      await expect(region.getByRole('cell', { name: '保留的电影', exact: true })).toBeVisible()
      await expect(region.getByRole('cell', { name: '宫崎骏', exact: true })).toBeVisible()
    }
    await region.getByRole('button', { name: '删除', exact: true }).click()
    await expect(region.getByText('暂无记录')).toBeVisible()
    mode = 'success'
    await page.getByRole('button', { name: '重试生成', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
    await expect(region.getByText('暂无记录')).toBeVisible()
    assert.deepEqual(responses, [...cases.map(() => 200), ...Array(5).fill(502), 200])
    assert.equal(calls, responses.length)
    await page.evaluate(() => document.fonts.ready)
    assert.deepEqual(assetFailures, [], 'styles, fonts and images load without HTTP errors')
    assert.deepEqual(failures, [])
    console.log(`PASS: ${cases.length} distinct offline apps rendered and recorded data; aggregates, B Inspector edits / C records, edit/delete, 5 failures retain old app, retry; ${calls} real local HTTP requests with injected DeepSeek; zero paid calls.`)
  } finally {
    await browser?.close()
    await vite.close()
    await closeBackend()
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
