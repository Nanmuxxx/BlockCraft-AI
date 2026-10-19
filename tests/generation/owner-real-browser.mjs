// Explicit owner-authorized, one-request local smoke. This client never reads Secrets.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

assert.equal(process.env.BLOCKCRAFT_RUN_APPROVED_REAL_SMOKE, '1', 'Explicit real-test opt-in required')
const ledgerPath = join(homedir(), '.blockcraft-ai-local-smoke-20261020/smoke-ledger.json')
const before = JSON.parse(readFileSync(ledgerPath, 'utf8'))
assert.equal(before.halted, false)
assert.equal(before.entries.length, 0, 'First smoke only; never repeat automatically')
const directory = join(process.cwd(), 'docs/acceptance/local-real-20261020')
mkdirSync(directory, { recursive: true })
const report = { sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), at: new Date().toISOString(), result: 'NOT VERIFIED', prompt: '帮我做一个 25 分钟番茄钟', generationRequests: 0, externalBrowserRequests: 0, checks: [] }
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: directory } })
const page = await context.newPage()
await page.route('**/*', route => {
  if (new URL(route.request().url()).hostname !== '127.0.0.1') { report.externalBrowserRequests++; return route.abort() }
  if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/ai/generate') {
    report.generationRequests++
    if (report.generationRequests > 1) return route.abort()
  }
  return route.continue()
})
try {
  assert.equal((await fetch('http://127.0.0.1:3001/api/ai/generate', { method: 'POST' })).status, 401)
  report.checks.push('anonymous 401')
  await page.goto('http://127.0.0.1:3001/local-owner/start')
  await page.getByLabel('创建方式', { exact: true }).selectOption('trusted-interactive')
  await page.getByLabel('你想做什么软件？').fill(report.prompt)
  await page.screenshot({ path: join(directory, '01-input.png'), fullPage: true })
  const responseReady = page.waitForResponse(r => r.url().endsWith('/api/ai/generate') && r.request().method() === 'POST', { timeout: 45000 })
  await page.getByRole('button', { name: '生成应用', exact: true }).click()
  const response = await responseReady
  report.httpStatus = response.status()
  const data = await response.json()
  if (!response.ok()) { report.errorCode = typeof data?.error?.code === 'string' ? data.error.code : typeof data?.code === 'string' ? data.code : 'SAFE_HTTP_FAILURE'; throw new Error('Generation failed') }
  assert.ok(data.spec)
  writeFileSync(join(directory, 'validated-appspec.json'), JSON.stringify(data.spec, null, 2) + '\n')
  report.checks.push('real HTTP generation returned validated AppSpec')
  const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true })
  const c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
  await b.waitFor({ timeout: 10000 })
  assert.equal(await b.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('[data-block-key]').count(), 1)
  await page.screenshot({ path: join(directory, '02-generated-b.png'), fullPage: true })
  await c.click()
  const time = page.getByLabel('剩余时间')
  assert.equal(await time.textContent(), '25:00')
  await page.getByRole('button', { name: '开始', exact: true }).click()
  await page.waitForTimeout(2200)
  assert.notEqual(await time.textContent(), '25:00')
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const paused = await time.textContent()
  await page.waitForTimeout(1200)
  assert.equal(await time.textContent(), paused)
  await b.click(); await c.click()
  assert.equal(await time.textContent(), paused)
  await page.screenshot({ path: join(directory, '03-paused-c.png'), fullPage: true })
  await page.getByRole('button', { name: '重置', exact: true }).click()
  assert.equal(await time.textContent(), '25:00')
  await page.screenshot({ path: join(directory, '04-reset-c.png'), fullPage: true })
  report.checks.push('automatic B', 'C initial 25:00', 'start counts down', 'pause holds', 'B/C retains state', 'reset 25:00')
  assert.equal(report.externalBrowserRequests, 0)
  assert.equal(report.generationRequests, 1)
  report.result = 'REAL AI PASS — LOCAL ONLY'
} catch { report.result = 'FAILED'; await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {}) }
finally {
  await context.close(); await browser.close()
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  report.ledger = { halted: ledger.halted, entries: ledger.entries.map(e => ({ id: e.id, at: e.at, requestHash: e.requestHash, status: e.status, reserveNano: e.reserveNano, estimatedNano: e.estimatedNano, usage: e.usage })) }
  report.estimatedCny = ledger.entries.reduce((n, e) => n + (e.estimatedNano || 0), 0) / 1e9
  report.reservedCny = ledger.entries.reduce((n, e) => n + e.reserveNano, 0) / 1e9
  report.accountBalanceVerified = false
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
  if (report.result === 'FAILED') process.exitCode = 1
}
