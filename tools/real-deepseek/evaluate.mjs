// Explicit operator entry only. Fixed synthetic requirements; no arbitrary TSX.
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { randomBytes, createHash } from 'node:crypto'
import { createAppServer } from '../../server/index.mjs'
import { assertAppSpec } from '../../server/.generated/appSpecValidation.js'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { createPaidTransport } from '../../server/paid-gateway/provider.mjs'
import { createLocalAccess } from '../../server/paid-gateway/access.mjs'
import { PRICING, POLICY } from '../../server/paid-gateway/pricing.mjs'

assert.equal(process.argv.length, 3, 'Use --live, --replay or --smoke explicitly')
const live = process.argv[2] === '--live'
const smoke = process.argv[2] === '--smoke'
assert.ok(live || smoke || process.argv[2] === '--replay')
const root = fileURLToPath(new URL('../../', import.meta.url)), parent = dirname(root.slice(0, -1))
const output = join(root, smoke ? '.cache/phase2-smoke' : 'docs/acceptance/phase2-deepseek')
mkdirSync(output, { recursive: true })
const reportPath = join(output, live ? 'live-browser.json' : 'replay-browser.json')
const report = { live, model: PRICING.model, pricing: PRICING, policy: POLICY, cases: [], errors: [], external: [], note: 'formal /ai-create; authenticated server-side loopback proxy; no UI transforms or runtime introspection' }
const scenarios = [
  { id: 'todo', idea: '做一个个人待办清单：记录任务标题、截止日期和是否完成。能新增、查看、编辑、删除任务。不需要提醒、账号或云端存储。' },
  { id: 'club', idea: '做一个社团报名系统：报名者填写姓名、意向部门（技术部、宣传部、策划部）和是否参加面试，管理员可以查看、编辑和删除报名，显示报名总人数。仅当前页面使用，不要账号、自动通知或敏感个人信息。' },
]
const require = createRequire(import.meta.url)
const { chromium } = require('playwright'), { expect } = require('playwright/test')
const { createServer } = await import('vite')
let ledger, key, browser, vite, backend, current, mode = live ? 'live' : 'replay', latest, attempts = 0
const token = randomBytes(32).toString('hex'), access = createLocalAccess(token)
let paid
try {
  browser = await chromium.launch({ headless: true }) // Verify browser BEFORE opening paid gate.
  report.browser = browser.version()
  if (live) {
    const privateDir = join(parent, '.phase2-deepseek-secure')
    mkdirSync(privateDir, { mode: 0o700 })
    ledger = openLedger(join(privateDir, 'ledger.json'))
    // Never reset, override, or choose a fresh ledger to bypass a previous run.
    assert.equal(ledger.snapshot().entries.length, 0, 'Existing budget: use replay; reconcile before new authorization')
    const credentials = parseEnv(readFileSync(join(parent, 'BlockCraft-AI/server/.env'), 'utf8'))
    key = credentials.DEEPSEEK_API_KEY?.trim()
    assert.ok(key && key.length >= 16 && !/your|replace|example|placeholder/i.test(key), 'CREDENTIALS_BLOCKED')
    paid = createPaidTransport({ apiKey: key, ledger, onResponse: (envelope, meta) => {
      const text = JSON.stringify(envelope, null, 2) + '\n'
      assert.ok(!text.includes(key) && !/sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}/.test(text), 'PRIVATE_RESPONSE')
      writeFileSync(join(output, current.id + '.response.json'), text)
      latest = envelope
      report.cases.push({ id: current.id, idea: current.idea, reservationId: meta.id, requestHash: meta.requestHash, responseSha256: createHash('sha256').update(text).digest('hex'), usage: envelope.usage, source: 'real-deepseek' })
    } })
  }
  const transport = async (url, init) => {
    const request = JSON.parse(init.body)
    assert.equal(request.messages[1].content, current.idea)
    if (mode === 'failure') return Response.json({ error: 'offline injected failure' }, { status: 503 })
    if (mode === 'invalid') return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"version":999}' } }] })
    if (mode === 'delayed') { await new Promise(r => setTimeout(r, 2000)); return Response.json(latest) }
    if (mode === 'live') {
      assert.equal(attempts++, 0, 'Exactly one paid attempt per fixed scenario; never retry')
      return paid(url, init)
    }
    return Response.json(latest)
  }
  backend = createAppServer({ apiKey: 'controlled-server-placeholder', model: PRICING.model, fetchImpl: transport, generationAccess: access })
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
  const backendOrigin = `http://127.0.0.1:${backend.address().port}`
  // Before any UI/paid request, verify anonymous v1 and v2 are rejected.
  report.anonymous = []
  for (const input of [{ idea: '待办' }, { idea: '番茄钟', protocol: 'trusted-interactive/1' }]) {
    const r = await fetch(backendOrigin + '/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    assert.equal(r.status, 401); report.anonymous.push({ protocol: input.protocol || 'legacy-v1', status: r.status })
  }
  vite = await createServer({ root, server: { host: '127.0.0.1', port: 5237, strictPort: true,
    fs: { allow: [root, realpathSync(join(root, 'node_modules'))] },
    proxy: { '/api': { target: backendOrigin, changeOrigin: false,
      configure(proxy) { proxy.on('proxyReq', proxyReq => { proxyReq.setHeader('Authorization', 'Bearer ' + token) }) },
    } },
  } })
  await vite.listen()
  const origin = 'http://127.0.0.1:5237'
  for (current of scenarios) {
    attempts = 0
    if (smoke) {
      const fixture = require('../../tests/custom-block/fixtures.cjs').createClubRegistrationExample().spec
      latest = { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(fixture) } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }
    } else if (!live) latest = JSON.parse(readFileSync(join(output, current.id + '.response.json'), 'utf8'))
    for (const width of [1440, 390]) {
      mode = live && width === 1440 ? 'live' : 'replay'
      const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390 })
      await context.route('**/*', route => { const u = new URL(route.request().url()); if (u.origin !== origin) { report.external.push(u.origin); return route.abort() } return route.continue() })
      const page = await context.newPage()
      page.setDefaultTimeout(8000)
      // Client failure/recovery probes are explicitly intercepted offline, so
      // they cannot spend money or consume the real service rate allowance.
      await page.route('**/api/ai/generate', async route => {
        if (mode === 'failure') return route.fulfill({ status: 503, json: { error: { code: 'AI_UNAVAILABLE' } } })
        if (mode === 'invalid') return route.fulfill({ json: { version: 999 } })
        if (mode === 'delayed') {
          await new Promise(r => setTimeout(r, 2000))
          return route.fulfill({ json: JSON.parse(latest.choices[0].message.content) }).catch(() => {})
        }
        return route.fallback()
      })
      page.on('pageerror', e => report.errors.push(e.message))
      await page.goto(origin + '/ai-create')
      await page.getByLabel('你想做什么软件？').fill(current.idea)
      const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/ai/generate'), { timeout: 40000 })
      await page.getByRole('button', { name: '生成应用', exact: true }).click()
      const response = await responsePromise
      const spec = await response.json()
      assert.equal(response.status(), 200, 'Generation did not pass server schema/completeness checks')
      assertAppSpec(spec); assert.equal(spec.version, 1); assert.deepEqual(spec, JSON.parse(latest.choices[0].message.content))
      if (!live && width === 1440) report.cases.push({ id: current.id, idea: current.idea, source: smoke ? 'offline-fixture-smoke' : 'recorded-real-response-replay', usage: latest.usage })
      const entry = report.cases.find(c => c.id === current.id)
      entry.spec = { id: spec.id, name: spec.name, version: spec.version, entities: spec.entities.map(e => ({ id: e.id, fields: e.fields.map(f => ({ name: f.name, type: f.type })) })), blocks: spec.blocks.map(b => ({ name: b.name, type: b.type })) }
      await expect(page.getByRole('heading', { name: spec.name, exact: true })).toBeVisible()
      const b = page.getByRole('button', { name: 'B 模式 · 编辑积木', exact: true }), c = page.getByRole('button', { name: 'C 模式 · 运行应用', exact: true })
      await expect(b).toHaveAttribute('aria-pressed', 'true')
      await page.screenshot({ path: join(output, `${current.id}-${width}-b.png`), fullPage: true })
      await c.click()
      const list = spec.blocks.find(block => block.type === 'list'); assert.ok(list, 'scenario needs an editable list')
      const entity = spec.entities.find(e => e.id === spec.relations.find(r => r.blockId === list.id).entityId)
      const region = page.getByRole('region', { name: list.name, exact: true })
      await region.getByRole('button', { name: '新增记录', exact: true }).click()
      await region.getByRole('button', { name: '提交', exact: true }).click()
      await expect(region.getByRole('alert')).toBeVisible()
      const fields = entity.fields.filter(f => list.fieldIds.includes(f.id) || f.required)
      for (const field of fields) {
        const control = region.getByLabel(field.name, { exact: false })
        if (field.type === 'boolean') await control.selectOption('false')
        else if (field.type === 'select') await control.selectOption(field.options[0])
        else await control.fill(field.type === 'number' ? '5' : field.type === 'date' ? '2026-10-20' : '真实模型应用验收')
      }
      await region.getByRole('button', { name: '提交', exact: true }).click()
      await expect(region.locator('tbody tr')).toHaveCount(1)
      const editable = fields.find(f => f.type === 'text' && list.fieldIds.includes(f.id)); assert.ok(editable)
      await region.getByRole('button', { name: '编辑', exact: true }).click()
      await region.getByLabel(editable.name, { exact: false }).fill('取消应保留旧数据')
      await region.getByRole('button', { name: '取消', exact: true }).click()
      assert.ok(!(await region.locator('tbody').textContent()).includes('取消应保留旧数据'))
      await region.getByRole('button', { name: '编辑', exact: true }).click()
      await region.getByLabel(editable.name, { exact: false }).fill('修改后的真实记录')
      await region.getByRole('button', { name: '保存修改', exact: true }).click()
      await expect(region.locator('tbody tr')).toHaveCount(1); await expect(region.locator('tbody')).toContainText('修改后的真实记录')
      await b.click(); await c.click(); await expect(region.locator('tbody')).toContainText('修改后的真实记录')
      await page.screenshot({ path: join(output, `${current.id}-${width}-c.png`), fullPage: true })
      // Failure/invalid/cancel/late reply use only local replays, never new paid calls.
      const before = await region.locator('tbody').textContent()
      for (const fault of ['failure', 'invalid', 'delayed']) {
        mode = fault
        const details = page.locator('.ai-create-regenerate'); if (!await details.evaluate(e => e.open)) await details.locator('summary').click()
        await page.getByRole('button', { name: /^(生成新应用|重试生成)$/ }).click()
        if (fault === 'delayed') { await page.getByRole('button', { name: '取消生成', exact: true }).click({ force: true }); await page.waitForTimeout(2200) }
        await expect(page.locator('.ai-create-error')).toBeVisible()
        assert.equal(await region.locator('tbody').textContent(), before)
      }
      await region.getByRole('button', { name: '编辑', exact: true }).click()
      await region.getByRole('button', { name: '删除', exact: true }).click()
      await expect(region.locator('tbody tr')).toHaveCount(0)
      await expect(region.getByRole('button', { name: '保存修改', exact: true })).toHaveCount(0)
      await expect(region.getByText('暂无记录', { exact: true })).toBeVisible()
      assert.equal(await page.locator('iframe').count(), 0)
      ;(entry.browser ??= []).push({ width, liveGeneration: live && width === 1440, checks: ['strict schema', 'formal B/C', 'required validation', 'create', 'read', 'update same row count', 'cancel edit', 'B/C record retention', 'offline HTTP/invalid/cancel/late preservation', 'delete active edit', 'empty state', 'no generated TSX execution'] })
      await context.close()
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.external, [])
} catch (error) {
  // Never print arbitrary network errors, request headers, secrets or stacks.
  report.errors.push({ code: /^[A-Z_]{1,64}$/.test(error?.code || '') ? error.code : 'EVALUATION_FAILED', message: key && String(error.message).includes(key) ? 'REDACTED' : String(error.message).slice(0, 200) })
  process.exitCode = 1
} finally {
  if (ledger) { report.audit = ledger.snapshot(); ledger.close() }
  report.realCalls = report.audit?.entries.length || 0
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  await vite?.close(); if (backend) await new Promise(r => { backend.closeAllConnections(); backend.close(r) }); await browser?.close()
  console.log(JSON.stringify({ live, realCalls: report.realCalls, cases: report.cases.length, errors: report.errors, reportPath }))
}
