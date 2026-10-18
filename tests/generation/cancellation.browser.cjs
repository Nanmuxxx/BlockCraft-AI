// Formal page -> Vite proxy -> actual local service. Only the upstream model
// transport is injected; deferred completions deliberately ignore AbortSignal.
// No production test switch, generated TSX, credentials, or paid model calls.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { mkdir, writeFile } = require('node:fs/promises')
const { realpathSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const output = path.resolve(process.env.GENERATION_QA_OUTPUT || '/tmp/blockcraft-generation-cancellation')
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

async function run() {
  const { cases } = await import('./fixtures.mjs')
  const { createServer } = await import('vite')
  const { createAppServer } = await import('../../server/index.mjs')
  const { buildGenerationMessages } = await import('../../server/aiGenerationPrompt.mjs')
  const report = { repositoryHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), scope: 'formal /ai-create, real local HTTP/proxy, injected offline upstream ignoring abort', realModelCalls: 0, cases: [] }
  const nodeErrors = []
  const onUnhandled = error => nodeErrors.push(String(error))
  process.on('unhandledRejection', onUnhandled)
  await mkdir(output, { recursive: true })
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    report.browser = browser.version()
    for (const width of [1366, 390]) {
      let planned, upstreamCalls = 0, httpCalls = 0
      const pending = []
      const backend = createAppServer({ apiKey: 'offline-test-key', model: 'offline-cancellation-model', fetchImpl: async (url, options) => {
        upstreamCalls++
        assert.equal(url, 'https://api.deepseek.com/chat/completions')
        const plan = planned
        assert.ok(plan, 'every upstream call has a hand-authored plan')
        const request = JSON.parse(options.body)
        assert.deepEqual(request.messages, buildGenerationMessages(plan.fixture.idea))
        assert.equal(request.model, 'offline-cancellation-model')
        plan.signal = options.signal
        plan.started.resolve()
        if (plan.completion) return plan.completion.promise
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan.fixture.spec) } }] })
      } })
      backend.on('request', req => { if (req.url === '/api/ai/generate') httpCalls++ })
      backend.listen(0, '127.0.0.1')
      await once(backend, 'listening')
      const vite = await createServer({ root, server: { host: '127.0.0.1', port: 5194, strictPort: true, fs: { allow: [root, realpathSync(path.join(root, 'node_modules'))] }, proxy: { '/api': { target: `http://127.0.0.1:${backend.address().port}`, changeOrigin: false } } } })
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: 'block' })
      try {
        await vite.listen()
        await context.tracing.start({ screenshots: true, snapshots: true })
        const page = await context.newPage(), errors = [], external = [], assetFailures = []
        page.on('pageerror', error => errors.push(error.message))
        page.on('response', response => { if (!new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) assetFailures.push(response.url()) })
        await page.route('**/*', route => {
          if (new URL(route.request().url()).origin === 'http://127.0.0.1:5194') return route.continue()
          external.push(route.request().url()); return route.abort('blockedbyclient')
        })
        const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })
        const c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
        const source = page.getByLabel('当前应用来源', { exact: true })
        const start = async (id, delayed = false) => {
          const fixture = cases.find(item => item.id === id)
          planned = { fixture, started: deferred(), ...(delayed ? { completion: deferred() } : {}) }
          const plan = planned
          if (delayed) pending.push(plan)
          const prompt = page.getByLabel('你想做什么软件？')
          if (!await prompt.isVisible()) await page.locator('.ai-create-regenerate > summary').click()
          await prompt.fill(fixture.idea)
          await page.getByRole('button', { name: /^(生成应用|生成新应用|重试生成)$/ }).click()
          await plan.started.promise
          return plan
        }
        const current = async id => {
          const fixture = cases.find(item => item.id === id)
          await expect(page.getByRole('heading', { name: fixture.spec.name, exact: true })).toBeVisible()
          await expect(source).toContainText('响应未提供可验证的模型来源')
        }
        await page.goto('http://127.0.0.1:5194/ai-create')
        await start('movie-log'); await current('movie-log')
        await expect(b).toHaveAttribute('aria-pressed', 'true')
        await c.click()
        const movies = page.getByRole('region', { name: '已看电影记录', exact: true })
        await movies.getByRole('button', { name: '新增记录', exact: true }).click()
        await movies.getByLabel('电影名', { exact: false }).fill('取消后仍保留的记录')
        await movies.getByRole('button', { name: '提交', exact: true }).click()
        const late = await start('club-app', true)
        await expect(page.getByLabel('创建方式', { exact: true })).toBeDisabled()
        await page.getByRole('button', { name: '取消生成', exact: true }).click()
        await expect(page.getByRole('alert')).toContainText('当前应用和数据已保留')
        await expect(movies.getByRole('cell', { name: '取消后仍保留的记录', exact: true })).toBeVisible()
        await expect.poll(() => late.signal.aborted).toBe(true)
        // Replace before the cancelled upstream settles, then deliver its old body.
        await start('book-log'); await current('book-log')
        let bodyCancels = 0
        late.completion.resolve(new Response(new ReadableStream({ cancel() { bodyCancels++ } })))
        await expect.poll(() => bodyCancels).toBe(1)
        await current('book-log')
        await expect(b).toHaveAttribute('aria-pressed', 'true')
        await expect(page.getByRole('heading', { name: cases[0].spec.name, exact: true })).toHaveCount(0)
        await page.screenshot({ path: path.join(output, `late-success-${width}.png`), fullPage: true })
        // A late rejection is consumed and cannot overwrite a subsequent success.
        const rejected = await start('club-app', true)
        await page.getByRole('button', { name: '取消生成', exact: true }).click()
        await expect.poll(() => rejected.signal.aborted).toBe(true)
        await start('movie-log'); await current('movie-log')
        rejected.completion.reject(new TypeError('offline late upstream rejection'))
        // Round-trip B/C gives queued promise reactions time without a fixed sleep.
        await c.click(); await expect(movies.getByText('暂无记录')).toBeVisible(); await b.click()
        await expect(page.getByRole('alert')).toHaveCount(0)
        // Full navigation unmounts the creation page and cancels its owner.
        const navigation = await start('club-app', true)
        await page.goto('http://127.0.0.1:5194/')
        await expect.poll(() => navigation.signal.aborted).toBe(true)
        navigation.completion.reject(new TypeError('offline disposed upstream rejection'))
        await page.goto('http://127.0.0.1:5194/ai-create')
        await expect(source).toHaveCount(0)
        await expect(page.getByRole('button', { name: '生成应用', exact: true })).toBeVisible()
        await expect(b).toHaveCount(0)
        await page.screenshot({ path: path.join(output, `disposed-${width}.png`), fullPage: true })
        assert.equal(httpCalls, 6)
        assert.equal(upstreamCalls, httpCalls)
        assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(assetFailures, [])
        report.cases.push({ width, httpCalls, upstreamCalls, bodyCancels, cancelledRecordsRetained: true, lateSuccessCannotReplace: true, lateRejectionConsumed: true, navigationCancels: true, reloadPersistence: false, errors, external, assetFailures })
        await context.tracing.stop({ path: path.join(output, `trace-${width}.zip`) })
      } finally {
        for (const plan of pending) plan.completion.resolve(new Response(''))
        await context.close(); await vite.close()
        await new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve) })
      }
    }
    assert.deepEqual(nodeErrors, [])
    report.nodeUnhandledRejections = nodeErrors
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } finally { await browser?.close(); process.off('unhandledRejection', onUnhandled) }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
