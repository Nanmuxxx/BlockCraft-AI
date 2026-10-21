// Actual local launcher -> cookie -> HTTP -> /ai-create -> B/C; no paid transport.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startLocalOwnerServer } from '../../server/local-owner-launcher.mjs'
const spec = JSON.parse(readFileSync(new URL('../trusted-interactive/pomodoro.json', import.meta.url)))
const stateDirectory = join(mkdtempSync(join(tmpdir(), 'bc-owner-browser-')), 'private')
let calls = 0, invalid = false
const profile = { policy: { maxCalls: 3, maxOutputTokens: 2048, concurrency: 1, retries: 0, conservativeNano: 500000000, maxInputBytes: 65536, framingTokens: 8192 }, pricing: { expiresAt: Date.now() + 60000, model: 'deepseek-flash', inputNanoPerToken: 2000, outputNanoPerToken: 9000 } }
const started = await startLocalOwnerServer({ env: { BLOCKCRAFT_LOCAL_OWNER_APPROVED: '1', BLOCKCRAFT_LOCAL_PORT: '3217', DEEPSEEK_API_KEY: 'synthetic-key-never-real' }, profile, stateDirectory, signalHandlers: false,
  runtimeFactory: options => {
    assert.equal(options.profile, 'local-smoke'); assert.equal(options.policy, profile.policy)
    assert.equal(options.env.DEEPSEEK_BUDGET_LEDGER_PATH, join(stateDirectory, 'smoke-ledger.json'))
    return { close() {}, forRequest({ principal, payload, idempotencyKey }) {
      assert.equal(principal, 'local-owner'); assert.equal(payload.protocol, 'trusted-interactive/1'); assert.match(idempotencyKey, /^[A-Za-z0-9_-]{32,128}$/)
      return { apiKey: 'synthetic-key-never-real', model: 'offline-owner-mock', fetchImpl: async (_url, init) => {
        calls++; assert.equal(JSON.parse(init.body).max_tokens, 2048)
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(invalid ? { version: 999 } : spec) } }] })
      } }
    } }
  } })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const external = [], errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort() } return route.continue() })
try {
  const anonymous = await fetch('http://127.0.0.1:3217/api/ai/generate', { method: 'POST' }); assert.equal(anonymous.status, 401)
  await page.goto('http://127.0.0.1:3217/local-owner/start')
  const cookies = await page.context().cookies(); const cookie = cookies.find(c => c.name === 'bc_local_owner')
  assert.ok(cookie); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict')
  assert.equal(await page.evaluate(() => document.cookie.includes('bc_local_owner')), false)
  await page.getByLabel('创建方式', { exact: true }).selectOption('trusted-interactive')
  await page.getByLabel('你想做什么软件？').fill('帮我做一个25分钟番茄钟')
  await page.getByRole('button', { name: '生成应用', exact: true }).click()
  const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }), c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
  await b.waitFor(); assert.equal(await b.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('[data-block-key]').count(), 1)
  await page.screenshot({ path: join(stateDirectory, 'b.png'), fullPage: true })
  await c.click()
  const time = page.getByLabel('剩余时间')
  assert.equal(await time.textContent(), '25:00')
  await page.getByRole('button', { name: '开始', exact: true }).click(); await page.waitForTimeout(1200)
  assert.notEqual(await time.textContent(), '25:00')
  await page.getByRole('button', { name: '暂停', exact: true }).click(); const paused = await time.textContent()
  await page.waitForTimeout(1100); assert.equal(await time.textContent(), paused)
  await b.click(); await c.click(); assert.equal(await time.textContent(), paused)
  await page.getByRole('button', { name: '重置', exact: true }).click(); assert.equal(await time.textContent(), '25:00')
  await page.screenshot({ path: join(stateDirectory, 'c.png'), fullPage: true })
  await page.locator('.ai-create-regenerate > summary').click(); invalid = true
  await page.getByRole('button', { name: '生成新应用', exact: true }).click()
  await page.locator('.ai-create-error').waitFor(); assert.match(await page.locator('.ai-create-error').textContent(), /当前应用和数据已保留/)
  assert.equal(await time.textContent(), '25:00'); assert.equal(calls, 2)
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  const report = { result: 'Mock PASS', paidCalls: 0, mockCalls: calls, actualLauncher: true, cookie: { httpOnly: cookie.httpOnly, sameSite: cookie.sameSite }, checks: ['anonymous 401', 'cookie bootstrap', 'actual v2 UI HTTP request', 'automatic B', 'C start/pause/reset', 'B/C retained state', 'invalid Schema retains previous app', 'zero external browser requests'], evidence: stateDirectory }
  writeFileSync(join(stateDirectory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
} finally { await browser.close(); await started.shutdown() }
