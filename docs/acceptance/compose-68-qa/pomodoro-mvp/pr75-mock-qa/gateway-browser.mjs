// Actual local launcher -> cookie -> HTTP -> /ai-create -> B/C; no paid transport.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const qaSnapshot = process.env.QA_SNAPSHOT
assert.ok(qaSnapshot, 'QA_SNAPSHOT must point to a frozen checkout')
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(qaSnapshot + '/node_modules/playwright/index.mjs'))
const { startLocalOwnerServer } = await import(pathToFileURL(qaSnapshot + '/server/local-owner-launcher.mjs'))
const { createPrincipalPaidGenerationRuntime } = await import(pathToFileURL(qaSnapshot + '/server/paid-gateway/runtime.mjs'))
const { PRICING, SMOKE_POLICY } = await import(pathToFileURL(qaSnapshot + '/server/paid-gateway/pricing.mjs'))
const spec = JSON.parse(readFileSync(qaSnapshot + '/tests/trusted-interactive/pomodoro.json'))
const stateDirectory = join(mkdtempSync(join(tmpdir(), 'bc-owner-browser-')), 'private')
let calls = 0, invalid = false
const profile = { policy: SMOKE_POLICY, pricing: PRICING }
const started = await startLocalOwnerServer({ env: { BLOCKCRAFT_LOCAL_OWNER_APPROVED: '1', BLOCKCRAFT_LOCAL_PORT: '3237', DEEPSEEK_API_KEY: 'synthetic-key-never-real' }, profile, stateDirectory, signalHandlers: false,
  runtimeFactory: options => createPrincipalPaidGenerationRuntime({ ...options, fetchImpl: async (_url, init) => {
    calls++; assert.equal(JSON.parse(init.body).max_tokens, 2048); assert.deepEqual(JSON.parse(init.body).thinking, {type:'disabled'}); assert.equal(init.redirect,'error')
    assert.equal(_url, 'https://api.deepseek.com/chat/completions')
    return Response.json({ model: PRICING.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(invalid ? { version: 999 } : spec) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })
  } }) })
const browser = await chromium.launch({ headless: true, executablePath: '/Users/nanmuxun/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' })
const viewport = process.env.QA_VIEWPORT === 'mobile' ? {width:390,height:844} : {width:1440,height:900};
const page = await browser.newPage({viewport})
const external = [], errors = []
page.on('pageerror', error => errors.push(error.message))
await page.route('**/*', route => { if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort() } return route.continue() })
try {
  const anonymous = await fetch('http://127.0.0.1:3237/api/ai/generate', { method: 'POST' }); assert.equal(anonymous.status, 401)
  await page.goto('http://127.0.0.1:3237/local-owner/start')
  const cookies = await page.context().cookies(); const cookie = cookies.find(c => c.name === 'bc_local_owner')
  assert.ok(cookie); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict')
  assert.equal(await page.evaluate(() => document.cookie.includes('bc_local_owner')), false)
  await page.getByLabel('创建方式', { exact: true }).selectOption('trusted-interactive')
  await page.getByLabel('你想做什么软件？').fill('帮我做一个25分钟番茄钟')
  await page.getByRole('button', { name: '生成应用', exact: true }).click()
  const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }), c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
  await b.waitFor(); assert.equal(await b.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('[data-block-key]').count(), 1)
  await page.locator('[data-block-key]').click()
  await page.getByRole('region', {name:'番茄钟配置',exact:true}).waitFor()
  assert.match(await page.getByRole('region',{name:'番茄钟配置',exact:true}).textContent(), /1500/)
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
  invalid = false
  const requestBody = { idea: '帮我做一个25分钟番茄钟', protocol: 'trusted-interactive/1' }
  const headers = {Origin: 'http://127.0.0.1:3237', 'Idempotency-Key': 'qa-third-0123456789abcdefghijklmnopqrstuv'}
  const third = await page.request.post('http://127.0.0.1:3237/api/ai/generate', {data:requestBody, headers}); assert.equal(third.status(),200)
  const repeat = await page.request.post('http://127.0.0.1:3237/api/ai/generate', {data:requestBody, headers}); assert.equal(repeat.status(),429); assert.equal((await repeat.json()).error.code,'BUDGET_EXHAUSTED')
  const fourth = await page.request.post('http://127.0.0.1:3237/api/ai/generate', {data:requestBody, headers:{...headers,'Idempotency-Key':'qa-fourth-0123456789abcdefghijklmnopqrstuv'}}); assert.equal(fourth.status(),429)
  assert.equal(calls,3); assert.equal(await time.textContent(),'25:00')
  const ledger = JSON.parse(readFileSync(join(stateDirectory, 'smoke-ledger.json')))
  assert.equal(ledger.profile,'local-smoke'); assert.equal(ledger.entries.length,3); assert.ok(ledger.entries.every(e=>e.status==='settled'))
  assert.ok(ledger.entries.reduce((s,e)=>s+e.reserveNano,0)<=500000000)
  const report = { result: 'REAL GATEWAY / MOCK UPSTREAM PASS', viewport, admissionFourthStatus: fourth.status(), replayStatus:repeat.status(), settledEntries:ledger.entries.length, paidCalls: 0, mockCalls: calls, actualLauncher: true, actualPrincipalGateway: true, durableEntries: JSON.parse(readFileSync(join(stateDirectory, 'smoke-ledger.json'))).entries.length, cookie: { httpOnly: cookie.httpOnly, sameSite: cookie.sameSite }, checks: ['anonymous 401', 'cookie bootstrap', 'actual v2 UI HTTP request', 'automatic B', 'C start/pause/reset', 'B/C retained state', 'invalid Schema retains previous app', 'zero external browser requests'], evidence: stateDirectory }
  writeFileSync(join(stateDirectory, 'report.json'), JSON.stringify(report, null, 2)); const {copyFileSync,mkdirSync}=await import('node:fs'); const dest=process.env.QA_EVIDENCE; mkdirSync(dest,{recursive:true}); for(const f of ['b.png','c.png','report.json']) copyFileSync(join(stateDirectory,f),join(dest,f)); console.log(JSON.stringify(report))
} finally { await browser.close(); await started.shutdown() }
