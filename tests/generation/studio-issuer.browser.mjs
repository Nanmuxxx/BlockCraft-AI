// Local test TLS -> actual Studio issuer -> real UI B/C, synthetic transport only.
import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { request } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { issuerFixture, baseURL } from './studio-issuer-fixture.mjs'

const certDir = mkdtempSync(join(tmpdir(), 'bc-studio-test-TLS-'))
const evidence = resolve(process.env.STUDIO_MOCK_EVIDENCE_DIR || 'tests/generation/studio-issuer-evidence')
mkdirSync(evidence, { recursive: true })
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
  '-keyout', join(certDir, 'test.key'), '-out', join(certDir, 'test.crt')], { stdio: 'ignore' })
let upstream, fixture, browser
const tls = createServer({ key: readFileSync(join(certDir, 'test.key')), cert: readFileSync(join(certDir, 'test.crt')) }, (req, res) => {
  const proxy = request(upstream + req.url, { method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res)
  })
  proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
  req.pipe(proxy)
})
try {
  await new Promise(resolve => tls.listen(0, '127.0.0.1', resolve))
  const origin = `https://127.0.0.1:${tls.address().port}`
  fixture = issuerFixture({ origin }); const started = await fixture.start(); upstream = baseURL(started)
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await context.newPage(), external = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort() }
    return route.continue()
  })
  await page.goto(origin + '/studio/sign-in')
  assert.equal((await context.cookies()).length, 0)
  await page.getByLabel('Owner access credential').fill(fixture.credential)
  await Promise.all([page.waitForURL(origin + '/ai-create'), page.getByRole('button', { name: 'Sign in', exact: true }).click()])
  const cookie = (await context.cookies()).find(c => c.name === '__Host-bc_session')
  assert.ok(cookie); assert.equal(cookie.secure, true); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict'); assert.equal(cookie.path, '/')
  assert.equal(await page.evaluate(() => document.cookie.includes('bc_session')), false)
  assert.equal(fixture.state().consumed, true)
  await page.getByLabel('创建方式', { exact: true }).selectOption('trusted-interactive')
  await page.getByLabel('你想做什么软件？').fill('帮我做一个25分钟番茄钟')
  await page.getByRole('button', { name: '生成应用', exact: true }).click()
  const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }), c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
  await b.waitFor(); assert.equal(await b.getAttribute('aria-pressed'), 'true')
  assert.equal(await page.locator('[data-block-key]').count(), 1)
  await page.screenshot({ path: join(evidence, 'b.png'), fullPage: true })
  await c.click(); const time = page.getByLabel('剩余时间')
  assert.equal(await time.textContent(), '25:00')
  await page.getByRole('button', { name: '开始', exact: true }).click(); await page.waitForTimeout(1200)
  assert.notEqual(await time.textContent(), '25:00')
  await page.getByRole('button', { name: '暂停', exact: true }).click(); const paused = await time.textContent()
  await b.click(); await c.click(); assert.equal(await time.textContent(), paused)
  await page.getByRole('button', { name: '重置', exact: true }).click(); assert.equal(await time.textContent(), '25:00')
  await page.screenshot({ path: join(evidence, 'c.png'), fullPage: true })
  const replay = await page.evaluate(async credential => {
    const r = await fetch('/studio/session', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ credential }) }); return r.status
  }, fixture.credential)
  assert.equal(replay, 401); assert.equal(fixture.calls, 1); assert.deepEqual(errors, []); assert.deepEqual(external, [])
  const report = { result: 'HTTPS browser Mock PASS', paidCalls: 0, mockCalls: fixture.calls, actualStudioLauncher: true,
    tls: 'ephemeral self-signed test certificate; browser ignores certificate trust only',
    cookie: { secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, path: cookie.path },
    checks: ['GET grants nothing', 'password form POST', '303 /ai-create', 'durable consumed state', 'JS cannot read cookie', 'actual UI generation request', 'automatic B', 'C start/pause/reset', 'B/C state retained', 'replay 401', 'zero external browser requests'],
    limitations: ['Mock upstream only; no paid call', 'test TLS is not public TLS acceptance', 'production identity, ACL, volume and budget continuity remain unverified'] }
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally {
  await browser?.close(); await new Promise(resolve => tls.close(resolve)); await fixture?.cleanup(); rmSync(certDir, { recursive: true, force: true })
}
