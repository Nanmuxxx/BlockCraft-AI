// Replay the exact sanitized DeepSeek response envelopes preserved by PR #44.
// Provider fetch is local fixture data; no credential or upstream call is possible.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const { readFile, mkdir, writeFile } = require('node:fs/promises')
const { once } = require('node:events')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const evidence = path.join(root, 'docs/acceptance/real-loop-qa/source-pr44')
const output = path.resolve(process.env.GENERATION_QA_OUTPUT || path.join(root, 'docs/acceptance/real-loop-qa'))
const canary = process.env.REAL_LOOP_SECRET_CANARY
const assertNoCanary = value => { if (canary) assert.ok(!String(value).includes(canary), 'synthetic canary leaked') }

async function run() {
  const { createServer: createViteServer } = await import('vite')
  const { unzip } = await import('../project-zip-export/fixtures.mjs')
  const { createAppServer } = await import('../../server/index.mjs')
  const { createHash: hash } = require('node:crypto')
  const live = JSON.parse(await readFile(path.join(evidence, 'live-browser.json'), 'utf8'))
  const replay = JSON.parse(await readFile(path.join(evidence, 'replay-browser.json'), 'utf8'))
  assert.equal(live.realCalls, 2)
  assert.equal(replay.live, false)
  const { cases: fixtures } = await import('./fixtures.mjs')
  const { createReadingLogExample } = require('../custom-block/fixtures.cjs')
  const mocks = [
    ...fixtures.filter(item => ['fitness-log', 'money-app'].includes(item.id)),
    { id: 'learning', idea: '学习记录：维护书目、日期、学习分钟与摘记，统计累计分钟', spec: createReadingLogExample().spec },
  ]
  const candidates = [...live.cases.map(item => ({ ...item, source: 'recorded-real-response-replay' })), ...mocks.map(item => ({ ...item, source: 'hand-authored-fixture' }))]
  let active, mode = 'success', upstreamCalls = 0
  const envelopes = {}
  for (const id of ['todo', 'club']) {
    const bytes = await readFile(path.join(evidence, `${id}.response.json`))
    assert.equal(hash('sha256').update(bytes).digest('hex'), live.cases.find(item => item.id === id).responseSha256)
    envelopes[id] = JSON.parse(bytes)
  }
  for (const item of mocks) envelopes[item.id] = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(item.spec) } }] }
  const options = { aiTimeoutMs: 500, generationAccess: () => mode !== 'unauthorized', apiKey: canary || 'offline-replay-only', model: 'offline-replay', fetchImpl: async () => {
    upstreamCalls++
    if (mode === 'timeout') return new Promise(() => {})
    if (mode === 'failure') return new Response('', { status: 503 })
    if (mode === 'budget') throw Object.assign(new Error('synthetic exhausted budget'), { code: 'BUDGET_EXHAUSTED' })
    if (mode === 'invalid') return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"version":999}' } }] })
    return Response.json(envelopes[active])
  } }
  let server = createAppServer(options)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const closeServer = () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })
  const vite = await createViteServer({ root, mode: 'local-export', server: { host: '127.0.0.1', port: 5195, strictPort: true, fs: { allow: [root, require('node:fs').realpathSync(path.join(root, 'node_modules'))] }, proxy: { '/api': { target: `http://127.0.0.1:${server.address().port}` } } } })
  let browser
  const report = { repositoryHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), provenance: 'two recorded real responses + three hand-authored fixtures; no live inference', sourceFiles: ['PR #44 sanitized todo.response.json', 'PR #44 sanitized club.response.json'], responseSha256: Object.fromEntries(Object.entries(live.cases).map(item => [item[1].id, item[1].responseSha256])), liveCalls: 0, replayProviderInvocations: 0, screenshots: [], cases: [] }
  const scans = []
  report.canary = { enabled: Boolean(canary), scope: 'offline replay server API credential; local browser responses, DOM, console and downloaded ZIP; not final paid principal composition', responseBodies: 0, responseHeaders: 0, dom: 0, zipFiles: 0, consoleMessages: 0 }
  try {
    await mkdir(output, { recursive: true }); await vite.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
    report.browser = browser.version()
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' })
      const page = await context.newPage(), errors = [], external = []
      page.setDefaultTimeout(10000)
      page.setDefaultNavigationTimeout(15000)
      page.on('pageerror', error => errors.push(error.message))
      if (canary) {
        page.on('console', msg => { assertNoCanary(msg.text()); report.canary.consoleMessages++ })
        page.on('response', response => scans.push((async () => {
          assertNoCanary(JSON.stringify(await response.allHeaders())); report.canary.responseHeaders++
          const type = response.headers()['content-type'] || ''
          if (/json|javascript|text|svg/.test(type) && response.status() !== 304) {
            assertNoCanary((await response.body()).toString('utf8')); report.canary.responseBodies++
          }
        })().then(() => null, error => ({ url: response.url(), status: response.status(), error: error.message }))))
      }
      await page.route('**/*', route => {
        if (new URL(route.request().url()).origin === 'http://127.0.0.1:5195') return route.continue()
        external.push(route.request().url()); return route.abort('blockedbyclient')
      })
      await page.goto('http://127.0.0.1:5195/ai-create')
      for (const item of candidates) {
        const id = item.id
        console.log(`RUN ${id} ${width}`)
        active = id
        mode = 'success'
        // Fresh real server per scenario isolates the unchanged 10/min rate limit.
        const port = server.address().port
        await closeServer(); server = createAppServer(options); server.listen(port, '127.0.0.1'); await once(server, 'listening')
        if (!await page.getByLabel('你想做什么软件？').isVisible()) await page.locator('.ai-create-regenerate > summary').click()
        await expect(page.locator('.ai-create-hint').filter({ hasText: '成功创建后会替换当前应用' })).toBeVisible()
        const spec = JSON.parse(envelopes[id].choices[0].message.content)
        const upstreamBefore = upstreamCalls
        await page.getByLabel('你想做什么软件？').fill(item.idea)
        await page.getByRole('button', { name: /^(生成应用|生成新应用|重试生成)$/ }).click()
        await expect(page.getByRole('heading', { name: spec.name, exact: true })).toBeVisible()
        assert.equal(upstreamCalls - upstreamBefore, 1)
        const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })
        const c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
        await expect(b).toHaveAttribute('aria-pressed', 'true')
        const rows = Object.fromEntries(spec.entities.map(entity => [entity.id, []]))
        const checks = []
        const metrics = async () => {
          for (const block of spec.blocks.filter(block => block.type === 'metric')) {
            const entityId = spec.relations.find(binding => binding.blockId === block.id).entityId
            const values = rows[entityId].map(row => row[block.fieldId]).filter(value => typeof value === 'number')
            const total = values.reduce((sum, value) => sum + value, 0)
            const expected = block.aggregation === 'count' ? rows[entityId].length : block.aggregation === 'sum' ? total : values.length ? total / values.length : 0
            await expect(page.getByRole('region', { name: block.name, exact: true }).locator('output')).toHaveText(String(expected))
          }
        }
        for (const entity of spec.entities) {
          const listBlock = spec.blocks.find(block => block.type === 'list' && spec.relations.some(binding => binding.blockId === block.id && binding.entityId === entity.id))
          assert.ok(listBlock, `QA needs a list for ${entity.id}`)
          await b.click()
          await page.getByRole('region', { name: '自定义与内置积木画布', exact: true }).getByRole('button', { name: listBlock.name, exact: true }).click()
          const inspector = page.getByRole('complementary', { name: '积木属性', exact: true })
          await expect(inspector.getByRole('heading', { name: listBlock.name, exact: true })).toBeVisible()
          await inspector.getByLabel('字段名称', { exact: true }).fill('验收扩展')
          await inspector.getByRole('button', { name: '新增字段', exact: true }).click()
          await inspector.getByRole('checkbox', { name: '展示 验收扩展', exact: true }).check()
          const shot = `${id}-${entity.id}-${width}-b.png`
          await page.screenshot({ path: path.join(output, shot), fullPage: true }); report.screenshots.push(shot)
          await c.click()
          const region = page.getByRole('region', { name: listBlock.name, exact: true })
          const values = Object.fromEntries(entity.fields.map(field => [field.id, field.type === 'text' ? 'QA回放记录' : field.type === 'boolean' ? true : field.type === 'select' ? field.options[0] : field.type === 'date' ? '2026-10-18' : 12]))
          await region.getByRole('button', { name: '新增记录', exact: true }).click()
          for (const field of entity.fields) {
            const input = region.getByLabel(field.name, { exact: false })
            if (field.type === 'select' || field.type === 'boolean') await input.selectOption(String(values[field.id]))
            else await input.fill(String(values[field.id]))
          }
          await region.getByRole('button', { name: '提交', exact: true }).click()
          rows[entity.id].push(values)
          await expect(region.locator('tbody tr')).toHaveCount(1); await metrics()
          await region.getByRole('button', { name: '编辑', exact: true }).click()
          const textField = entity.fields.find(field => field.type === 'text')
          const numberField = entity.fields.find(field => field.type === 'number')
          if (textField) { await region.getByLabel(textField.name, { exact: false }).fill('QA编辑完成'); values[textField.id] = 'QA编辑完成' }
          if (numberField) { await region.getByLabel(numberField.name, { exact: false }).fill('24'); values[numberField.id] = 24 }
          await region.getByLabel('验收扩展', { exact: true }).fill('字段与记录保留')
          await region.getByRole('button', { name: '保存修改', exact: true }).click()
          await expect(region.getByRole('cell', { name: '字段与记录保留', exact: true })).toBeVisible(); await metrics()
          for (let i = 0; i < 3; i++) {
            await b.click(); await expect(inspector.getByRole('checkbox', { name: '展示 验收扩展', exact: true })).toBeChecked()
            await c.click(); await expect(region.getByRole('cell', { name: '字段与记录保留', exact: true })).toBeVisible()
          }
          const cShot = `${id}-${entity.id}-${width}-c.png`
          await page.screenshot({ path: path.join(output, cShot), fullPage: true }); report.screenshots.push(cShot)
          if (entity === spec.entities[0]) {
            const downloadPromise = page.waitForEvent('download')
            await page.getByRole('button', { name: '导出 React 项目', exact: true }).click()
            const download = await downloadPromise
            const archive = path.join(output, `${id}-${width}.zip`)
            await download.saveAs(archive)
            assert.equal(await download.failure(), null)
            const bytes = await readFile(archive), files = unzip(bytes)
            for (const value of files.values()) { assertNoCanary(value); if (canary) report.canary.zipFiles++ }
            const dataText = files.get('src/data.ts')
            const data = JSON.parse(dataText.slice(dataText.indexOf(' = ') + 3, dataText.lastIndexOf(';')))
            assert.equal(data.base.spec.id, spec.id)
            assert.equal(data.base.records[entity.id].length, 1)
            assert.ok(dataText.includes('字段与记录保留'))
            assert.equal(data.custom.instances.length, 0, 'only data and fixed builtin scaffold are exported')
            checks.push({ zip: path.basename(archive), bytes: bytes.length, sha256: hash('sha256').update(bytes).digest('hex'), revision: data.revision, validatedEditedSnapshot: true })
            if (!await page.getByLabel('你想做什么软件？').isVisible()) await page.locator('.ai-create-regenerate > summary').click()
            for (const failure of ['failure', 'invalid', 'timeout', 'unauthorized', 'budget']) {
              mode = failure
              const providerBefore = upstreamCalls
              const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ai/generate')
              await page.getByRole('button', { name: /^(生成新应用|重试生成)$/ }).click()
              const response = await responsePromise
              const body = await Promise.race([response.json(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('response body deadline')), 5000); timer.unref() })])
              assert.equal(response.status(), failure === 'unauthorized' ? 401 : failure === 'timeout' ? 504 : failure === 'budget' ? 503 : 502)
              await expect(page.getByRole('alert')).toContainText('当前应用和数据已保留')
              await expect(region.getByRole('cell', { name: '字段与记录保留', exact: true })).toBeVisible(); await metrics()
              if (failure === 'unauthorized') assert.equal(upstreamCalls, providerBefore)
              checks.push({ failure, status: response.status(), code: body.error.code, retained: true, layer: failure === 'budget' ? 'injected provider budget rejection (gateway ledger tested separately)' : 'real local HTTP route' })
            }
            mode = 'success'
          }
          await region.getByRole('button', { name: '删除', exact: true }).click()
          rows[entity.id] = []
          await expect(region.locator('tbody tr')).toHaveCount(0); await metrics()
        }
        report.cases.push({ id, width, height: width === 390 ? 844 : 900, source: item.source, validatedFromAssistantContent: true, bSelectedAndEdited: true, cCreateReadUpdateDelete: true, metricsUpdatedAndRestored: true, bCRoundTrips: 3, failures: checks, errors, external })
        assertNoCanary(await page.content()); if (canary) report.canary.dom++
      }
      await page.waitForLoadState('networkidle')
      assert.deepEqual((await Promise.all(scans)).filter(Boolean), [], 'all local textual response bodies must be scanned')
      assert.deepEqual(errors, []); assert.deepEqual(external, [])
      await context.close()
    }
    report.replayProviderInvocations = upstreamCalls
    assert.equal(report.cases.length, 10)
    await writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } finally { await browser?.close(); await vite.close(); await closeServer() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
