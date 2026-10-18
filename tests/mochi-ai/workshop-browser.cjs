// Production /ai-create + sole Host/owner + actual server route/provider chain.
// Fixed offline envelopes only: no keys, external fetch or generated code execution.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { realpathSync } = require('node:fs')
const { mkdir, writeFile } = require('node:fs/promises')
const { api, artifact, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const root = path.resolve(__dirname, '../..')
const output = process.env.MOCHI_WORKSHOP_QA_OUTPUT || '/tmp/mochi-workshop-chat-audit'
const origin = 'http://127.0.0.1:5199'
async function run() {
  const { createServer } = await import('vite')
  const { createAppServer } = await import('../../server/index.mjs')
  const { grant } = await import('./fixtures.mjs')
  let sessionId = 'offline-workshop-1366', backend, call = 0, denyBudget = false, failProvider = false
  const inputs = [], reservations = [], report = { browser: 'Chromium', route: '/ai-create', provider: 'injected fixed offline HTTP envelopes', paidCalls: 0, cases: [], errors: [], outbound: [] }
  const disabled = createAppServer({ apiKey: '', fetchImpl: async () => { throw new Error('forbidden') } })
  const enabled = createAppServer({ apiKey: 'OFFLINE FIXTURE ONLY', model: 'offline-fixture-model', mochi: {
    enabled: true, approval: grant(Date.now()), allowedOrigin: origin,
    // TEST ONLY: closed-over session and fixture project, not a production auth substitute.
    resolveAccess: () => ({ sessionId, appId: 'club-registration' }),
    reserveBudget: input => { reservations.push(Object.keys(input)); return !denyBudget },
  }, fetchImpl: async (_url, init) => {
    call++; const wire = JSON.parse(init.body), input = JSON.parse(wire.messages[1].content); inputs.push(input)
    assert.equal(wire.model, 'offline-fixture-model')
    if (failProvider) return new Response('{}', { status: 503 })
    const advice = { message: '可以让倒计时结束后的提示更清楚。', suggestions: [{ text: `要不要补充结束提示？（离线验证 ${call}）`, reason: '让使用者知道接下来该做什么。', blockId: 'custom-1', priority: 'medium', requiresUserAction: true, kind: 'design-change' }] }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(advice) } }] }))
  } })
  backend = disabled
  const vite = await createServer({ root, plugins: [{ name: 'offline-real-mochi-route', configureServer(server) {
    server.middlewares.use((req, res, next) => req.url.startsWith('/api/mochi-ai/') ? backend.emit('request', req, res) : next())
  } }], server: { host: '127.0.0.1', port: 5199, strictPort: true, fs: { allow: [root, path.dirname(realpathSync(path.join(root, 'node_modules/react')))] } } })
  let browser
  try {
    await mkdir(output, { recursive: true }); await vite.listen(); browser = await chromium.launch({ headless: true })
    for (const width of [1366, 390]) {
      backend = disabled; sessionId = `offline-workshop-${width}`
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 })
      page.on('pageerror', e => report.errors.push(e.message))
      let failInitialStatus = true
      const requests = []
      await page.route('**/*', async route => {
        const url = new URL(route.request().url())
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { report.outbound.push(url.href); return route.abort() }
        if (url.pathname === '/api/ai/generate') return route.fulfill({ json: createClubRegistrationExample().spec })
        if (url.pathname === '/api/mochi-ai/status' && failInitialStatus) {
          return route.fulfill({ status: 503, json: { error: { code: 'AI_UNAVAILABLE' } } })
        }
        if (url.pathname.startsWith('/api/')) requests.push(url.pathname)
        return route.continue()
      })
      await page.goto(`${origin}/ai-create`)
      await page.getByLabel('你想做什么软件？').fill('离线 Workshop 聊天验证')
      await page.getByRole('button', { name: '生成应用', exact: true }).click()
      const panel = page.getByRole('region', { name: '和 Mochi 聊聊', exact: true })
      const card = id => page.locator(`[data-block-key="${id}"]`)
      await expect(panel).toBeVisible()
      await expect(panel).toContainText('Mochi 暂时无法连接')
      failInitialStatus = false
      await panel.getByRole('button', { name: '检查连接', exact: true }).click()
      await expect(panel).toContainText('可信会话认证与项目权限尚未配置')
      await expect(panel).not.toContainText('Mochi 暂时无法连接')
      await expect(panel.getByLabel('向 Mochi 提问', { exact: true })).toBeDisabled()
      const source = artifact(), versionDigest = await api.computeVersionDigest(source)
      const importer = page.locator('.custom-block-import')
      await importer.locator('summary').click()
      await importer.getByLabel('积木制品 JSON').setInputFiles({ name: 'inert.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ instance: { id: 'custom-1', definitionId: source.manifest.definitionId, versionDigest, props: { durationSeconds: 600 } }, artifact: { versionDigest, artifact: source } })) })
      await importer.getByRole('button', { name: '确认添加积木', exact: true }).click()
      await card('custom:custom-1').click(); await card('builtin:registration-form').click()
      await page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true }).click()
      await page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }).click()
      await expect(panel).toContainText('可信会话认证与项目权限尚未配置')
      assert.equal(await page.locator('.mochi-ai').count(), 1)
      assert.equal(await page.getByRole('textbox', { name: '给 Mochi 发消息' }).isDisabled(), true)
      assert.equal(requests.filter(p => p.endsWith('/analyze')).length, 0)
      await importer.locator('summary').click()
      await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, `disabled-${width}.png`), fullPage: true })
      backend = enabled
      await panel.getByRole('button', { name: '检查连接', exact: true }).click()
      await expect(panel.getByLabel('向 Mochi 提问', { exact: true })).toBeEnabled()
      const start = call
      // Selection and manual layout editing before opt-in must not call AI.
      await card('custom:custom-1').click(); await card('builtin:registration-form').click()
      await page.getByRole('button', { name: '一键整理', exact: true }).click()
      await page.waitForTimeout(900); assert.equal(call, start)
      await panel.getByLabel('向 Mochi 提问', { exact: true }).fill('请看看这个混合应用的下一步。')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      await expect(panel.getByRole('log')).toContainText('可以让倒计时结束后的提示更清楚')
      const c = inputs.at(-1).context, custom = c.blocks.find(b => b.id === 'custom-1')
      assert.deepEqual(custom.parameters, [{ name: 'durationSeconds', type: 'integer', required: true }])
      assert(!c.relations.some(r => r.blockId === 'custom-1'))
      for (const secret of ['600', 'sources', 'remainingSeconds', 'fixture must never execute', '小林']) assert(!JSON.stringify(inputs.at(-1)).includes(secret))
      await panel.getByRole('button', { name: '定位积木', exact: true }).click()
      await expect(page.getByRole('complementary', { name: '自定义积木属性', exact: true })).toBeVisible()
      await page.waitForTimeout(2100)
      await panel.getByLabel('向 Mochi 提问', { exact: true }).fill('倒计时提示应该放在哪？')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      await expect(panel.getByRole('button', { name: '聊聊这个', exact: true })).toBeVisible()
      await page.waitForTimeout(2100)
      await panel.getByRole('button', { name: '聊聊这个', exact: true }).click()
      await expect.poll(() => inputs.at(-1).prompt).toContain('请解释这条建议')
      await expect(panel.getByRole('button', { name: '忽略', exact: true })).toBeVisible()
      await panel.getByRole('button', { name: '忽略', exact: true }).click()
      await expect(panel.getByRole('list', { name: 'Mochi 的建议' }).getByRole('listitem')).toHaveCount(0)
      // Explicit consent, one meaningful settled selection event, no polling.
      await panel.getByRole('checkbox', { name: '主动建议', exact: true }).click()
      await expect(panel.getByRole('checkbox', { name: '主动建议', exact: true })).toBeChecked()
      const beforeEvent = call
      await card('builtin:registration-form').click()
      // Retire this pending settled event, then grant consent again before its
      // original deadline. Regranting must not revive the old selection work.
      await panel.getByRole('checkbox', { name: '主动建议', exact: true }).click()
      await expect(panel.getByRole('checkbox', { name: '主动建议', exact: true })).not.toBeChecked()
      await panel.getByRole('checkbox', { name: '主动建议', exact: true }).click()
      await expect(panel.getByRole('checkbox', { name: '主动建议', exact: true })).toBeChecked()
      await page.waitForTimeout(900); assert.equal(call, beforeEvent)
      await card('custom:custom-1').click()
      await expect.poll(() => call).toBe(beforeEvent + 1)
      assert.equal(inputs.at(-1).kind, 'proactive')
      await expect(panel.getByRole('button', { name: '定位积木', exact: true })).toBeVisible()
      await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, `chat-${width}.png`), fullPage: true }); await panel.screenshot({ path: path.join(output, `panel-${width}.png`) })
      await panel.getByRole('checkbox', { name: '主动建议', exact: true }).click()
      await expect(panel.getByRole('checkbox', { name: '主动建议', exact: true })).not.toBeChecked()
      await card('builtin:registration-form').click(); await page.waitForTimeout(900); assert.equal(call, beforeEvent + 1)
      // Fee adapter denies: UI reports budget error; provider never runs.
      denyBudget = true; await page.waitForTimeout(2100)
      await panel.getByLabel('向 Mochi 提问', { exact: true }).fill('费用保护验证')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      await expect(panel).toContainText('本次 AI 预算已用完')
      assert.equal(call, beforeEvent + 1); denyBudget = false
      failProvider = true; await page.waitForTimeout(2100)
      await panel.getByLabel('向 Mochi 提问', { exact: true }).fill('离线错误验证')
      await panel.getByRole('button', { name: '发送', exact: true }).click()
      await expect(panel).toContainText('Mochi 暂时无法回答'); failProvider = false
      await expect(page.getByRole('textbox', { name: '给 Mochi 发消息' })).toBeDisabled()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      assert.equal(await page.locator('iframe').count(), 0)
      report.cases.push({ width, mobile: width === 390 ? 'Chromium mobile viewport and touch emulation; not a physical phone' : false, passed: true, analyzeRequests: requests.filter(p => p.endsWith('/analyze')).length, checks: ['status failure and retry recovery', 'production disabled reason persists', 'one Mochi Host UI', 'mixed immutable metadata privacy', 'no unconsented selection/layout/mode egress', 'manual chat through real server/provider/schema/client', 'trusted focus', 'continue and ignore', 'revoked settled event cannot revive after regrant', 'new explicit opt-in event', 'opt-out', 'durable fee rejection zero provider calls', 'provider failure visible', 'modification composer remains disabled', 'no overflow or iframe'] })
      await page.close()
      // Test-session isolation for the second browser: discard in-memory fixture session.
      if (width === 1366) await new Promise(resolve => setTimeout(resolve, 2100))
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.outbound, [])
    report.offlineProviderCalls = call; report.reservations = reservations.length
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
  } finally { await browser?.close(); await vite.close() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
