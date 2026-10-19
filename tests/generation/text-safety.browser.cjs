// Model output remains AppSpec data: markup/URL text must never become DOM.
// Actual formal HTTP route; only the upstream completion transport is offline.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { mkdir, writeFile } = require('node:fs/promises')
const { realpathSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const output = path.resolve(process.env.GENERATION_QA_OUTPUT || '/tmp/blockcraft-generation-text-safety')
const text = {
  app: '<script data-ai-probe>window.__aiTextExecuted=1</script>',
  entity: '<iframe data-ai-probe src="https://ai-text-probe.invalid/entity">',
  list: '<img data-ai-probe src="https://ai-text-probe.invalid/list" onerror="window.__aiTextExecuted=2">',
  form: '<svg data-ai-probe onload="window.__aiTextExecuted=3">录入</svg>',
  field: '<b data-ai-probe title="引号 & 中文">记录</b>',
  select: '<a data-ai-probe href="javascript:window.__aiTextExecuted=4">类别</a>',
  option: '</option><img data-ai-probe src="https://ai-text-probe.invalid/option">',
  record: '<iframe data-ai-probe src="https://ai-text-probe.invalid/record"></iframe>',
  edited: 'javascript:window.__aiTextExecuted=5 & <script data-ai-probe>6</script>',
}
const spec = {
  version: 1, id: 'literal-text', name: text.app,
  entities: [{ id: 'entries', name: text.entity, fields: [
    { id: 'note', name: text.field, type: 'text', required: true },
    { id: 'category', name: text.select, type: 'select', required: true, options: [text.option, '普通文字'] },
  ] }],
  blocks: [
    { id: 'entry-list', name: text.list, type: 'list', fieldIds: ['note', 'category'] },
    { id: 'entry-form', name: text.form, type: 'form', fieldIds: ['note', 'category'] },
  ],
  relations: ['entry-list', 'entry-form'].map((blockId, index) => ({ id: `binding-${index}`, type: 'dataBinding', blockId, entityId: 'entries' })),
}

async function run() {
  const { createServer } = await import('vite')
  const { createAppServer } = await import('../../server/index.mjs')
  const { buildGenerationMessages } = await import('../../server/aiGenerationPrompt.mjs')
  const idea = '维护文字记录和类别，提供录入入口和可编辑的记录列表。'
  let calls = 0
  const backend = createAppServer({ apiKey: 'offline-test-key', model: 'offline-text-safety', fetchImpl: async (url, options) => {
    calls++
    assert.equal(url, 'https://api.deepseek.com/chat/completions')
    const request = JSON.parse(options.body)
    assert.equal(request.model, 'offline-text-safety')
    assert.deepEqual(request.messages, buildGenerationMessages(idea))
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(spec) } }] })
  } })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const vite = await createServer({ root, server: { host: '127.0.0.1', port: 5195, strictPort: true,
    fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] },
    proxy: { '/api': { target: `http://127.0.0.1:${backend.address().port}`, changeOrigin: false } } } })
  let browser
  try {
    await vite.listen()
    await mkdir(output, { recursive: true })
    browser = await chromium.launch({ headless: true })
    const report = { repositoryHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), browser: browser.version(),
      scope: 'formal /ai-create -> actual local HTTP -> offline completion -> B/C literal AppSpec labels/options/record values; no TSX', realModelCalls: 0, cases: [] }
    for (const width of [1366, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' })
      try {
        await context.tracing.start({ screenshots: true, snapshots: true })
        const page = await context.newPage(), external = [], errors = [], dialogs = [], assetFailures = [], http = []
        await page.route('**/*', route => {
          const target = new URL(route.request().url())
          if (target.origin === 'http://127.0.0.1:5195') return route.continue()
          external.push(target.href)
          return route.abort('blockedbyclient')
        })
        page.on('pageerror', error => errors.push(error.message))
        page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
        page.on('response', response => {
          const pathname = new URL(response.url()).pathname
          if (pathname === '/api/ai/generate') http.push(response.status())
          else if (!pathname.startsWith('/api/') && response.status() >= 400) assetFailures.push(response.url())
        })
        const assertInert = async () => {
          await expect(page.locator('[data-ai-probe]')).toHaveCount(0)
          assert.equal(await page.evaluate(() => window.__aiTextExecuted), undefined)
          assert.deepEqual(external, [])
          assert.deepEqual(dialogs, [])
        }
        await page.goto('http://127.0.0.1:5195/ai-create')
        await page.getByLabel('你想做什么软件？').fill(idea)
        await page.getByRole('button', { name: '生成应用', exact: true }).click()
        await expect(page.getByRole('heading', { name: text.app, exact: true })).toBeVisible()
        const canvas = page.getByRole('region', { name: '自定义与内置积木画布', exact: true })
        await canvas.getByRole('button', { name: text.list, exact: true }).click()
        const inspector = page.getByRole('complementary', { name: '积木属性', exact: true })
        await expect(inspector.getByRole('checkbox', { name: `展示 ${text.field}`, exact: true })).toBeChecked()
        await assertInert()
        await page.screenshot({ path: path.join(output, `literal-b-${width}.png`), fullPage: true })
        await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
        const form = page.getByRole('region', { name: text.form, exact: true })
        const list = page.getByRole('region', { name: text.list, exact: true })
        await expect(form.getByRole('option', { name: text.option, exact: true })).toHaveText(text.option)
        await form.getByLabel(text.field, { exact: false }).fill(text.record)
        await form.getByLabel(text.select, { exact: false }).selectOption(text.option)
        await form.getByRole('button', { name: '提交', exact: true }).click()
        await expect(list.getByRole('cell', { name: text.record, exact: true })).toBeVisible()
        await expect(list.getByRole('cell', { name: text.option, exact: true })).toBeVisible()
        await assertInert()
        await list.getByRole('button', { name: '编辑', exact: true }).click()
        await list.getByLabel(text.field, { exact: false }).fill(text.edited)
        await list.getByRole('button', { name: '保存修改', exact: true }).click()
        await page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }).click()
        await assertInert()
        await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
        await expect(list.getByRole('cell', { name: text.edited, exact: true })).toBeVisible()
        await expect(list.getByRole('cell', { name: text.option, exact: true })).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await assertInert()
        assert.deepEqual(http, [200]); assert.deepEqual(errors, []); assert.deepEqual(assetFailures, [])
        await page.screenshot({ path: path.join(output, `literal-c-${width}.png`), fullPage: true })
        await context.tracing.stop({ path: path.join(output, `literal-${width}.zip`) })
        report.cases.push({ width, http, literalAppAndBlockNames: true, literalLabelsAndSelectOptions: true, recordCreateEditAndBcRoundTrip: true,
          probeNodes: 0, executionMarker: false, errors, external, dialogs, assetFailures })
      } finally { await context.close() }
    }
    assert.equal(calls, 2)
    report.injectedUpstreamCalls = calls
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser?.close(); await vite.close()
    await new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve) })
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
