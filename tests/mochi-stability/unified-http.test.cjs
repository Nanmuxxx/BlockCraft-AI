const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createAppRuntime, createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { createHttpPlanProvider } = require('../../src/integrations/mochi/httpPlanProvider.ts')
const prompt = '只给表单增加一个可选文本字段备注'

// Actual browser provider -> authenticated Studio -> shared durable ledger ->
// paid transport, replacing only the last external network hop with a fixture.
test('Mochi HTTP composition reserves once, previews exactly, rejects replay and undoes without billing twice', async t => {
  const { startUnifiedStudioDeployment, UNIFIED_ORIGIN, deriveUnifiedTestCredentials } = await import('../../server/unified-studio-deployment.mjs')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bc-mochi-http-')))
  const legacy = join(root, 'mvp-5cny-20261022-scope'); mkdirSync(legacy, { mode: 0o700 })
  const access = Buffer.alloc(32, 0x42).toString('base64url'), binding = Buffer.alloc(32, 0x4b)
  const approval = { version: 1, publicOrigin: UNIFIED_ORIGIN, policyId: 'old-policy',
    approval: { providerVerified: true, permissionsVerified: true, reference: 'old-policy', maxCalls: 100, expiresAt: Number.MAX_SAFE_INTEGER },
    sessions: [{ sessionHash: createHash('sha256').update(access).digest('hex'), principal: 'offline-owner', appId: 'pomodoro', expiresAt: Number.MAX_SAFE_INTEGER, revoked: false }] }
  writeFileSync(join(legacy, 'binding.key'), binding, { mode: 0o600 })
  writeFileSync(join(legacy, 'approval.json'), JSON.stringify(approval), { mode: 0o600 })
  const verifyPricing = Object.assign(async () => {}, { assertCurrent() {} })
  let egress = 0
  const server = await startUnifiedStudioDeployment({ directory: root, host: '127.0.0.1', port: 0,
    allowMountedDirectory: false, signalHandlers: false, verifyPricing,
    env: { BLOCKCRAFT_TEST_ACCESS: access, DEEPSEEK_API_KEY: 'synthetic-offline-key-only' },
    fetchImpl: async (_url, init) => {
      egress++
      const i = JSON.parse(JSON.parse(init.body).messages[1].content)
      const candidate = { request: { requestId: i.requestId, baseRevision: i.baseRevision, commands: [
        { type: 'addField', entityId: i.entity.id, field: { id: 'note', name: '备注', type: 'text', required: false } },
        { type: 'configureBlockFields', blockId: i.block.id, fieldIds: [...i.block.fieldIds, 'note'] },
      ] }, capabilityIds: [] }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(candidate) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })
    } })
  t.after(async () => { await server.shutdown(); rmSync(root, { recursive: true, force: true }) })
  const origin = `http://127.0.0.1:${server.server.address().port}`
  const planningStatus = await (await fetch(origin + '/api/mochi-plan/status')).json()
  assert.equal(planningStatus.enabled, true)
  assert.equal(planningStatus.source, 'deepseek', 'request-bound production transport is not an offline fixture')
  const login = await fetch(origin + '/api/studio/test-session', { method: 'POST', headers: { Origin: UNIFIED_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: deriveUnifiedTestCredentials(binding).access }) })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const status = async () => (await (await fetch(origin + '/api/studio/status', { headers: { Cookie: cookie } })).json()).budget
  const send = (url, init) => fetch(origin + url, { ...init, headers: { ...init.headers, Cookie: cookie, Origin: UNIFIED_ORIGIN } })
  let captured
  const runtime = createAppRuntime(createClubRegistrationExample())
  const host = createMochiHost(runtime, createHttpPlanProvider((url, init) => { captured = { url, init }; return send(url, init) }))
  host.setSelection('registration-form'); t.after(() => host.dispose())
  const before = runtime.getSnapshot(), budget = await status()
  assert.equal(budget.account, 'agent-test'); assert.equal(budget.calls, 0)
  await host.callbacks.onRequestPlan(prompt)
  assert.equal(egress, 1); assert.equal(runtime.getSnapshot(), before)
  assert.equal((await status()).calls, 1)
  const preview = host.getSnapshot().preview
  assert.ok(preview)
  await host.callbacks.onRequestPlan(prompt)
  assert.equal(egress, 1); assert.equal(host.getSnapshot().preview, preview)
  const replay = await send(captured.url, captured.init)
  assert.equal((await replay.json()).error.code, 'IDEMPOTENCY_REPLAY')
  assert.equal(egress, 1); assert.equal((await status()).calls, 1)
  const conflicting = await send(captured.url, { ...captured.init,
    body: JSON.stringify({ ...JSON.parse(captured.init.body), prompt: '只给表单增加一个可选文本字段附注' }) })
  assert.equal((await conflicting.json()).error.code, 'IDEMPOTENCY_CONFLICT')
  assert.equal(egress, 1); assert.equal((await status()).calls, 1)
  const missing = await send(captured.url, { ...captured.init, headers: { 'Content-Type': 'application/json' } })
  assert.equal(missing.status, 400); assert.equal((await missing.json()).error.code, 'IDEMPOTENCY_KEY_INVALID')
  assert.equal(egress, 1); assert.equal(runtime.getSnapshot(), before)
  await host.callbacks.onConfirm(preview.planId)
  const after = runtime.getSnapshot()
  assert.equal(after.revision, before.revision + 1)
  assert.deepEqual(after.spec.blocks.find(b => b.id === 'registration-form').fieldIds, [...before.spec.blocks[0].fieldIds, 'note'])
  assert.deepEqual(after.spec.blocks.find(b => b.id === 'applicant-list'), before.spec.blocks.find(b => b.id === 'applicant-list'))
  assert.deepEqual(after.records, before.records)
  assert.equal(runtime.executeCommand({ requestId: 'undo-http', baseRevision: after.revision, commands: [{ type: 'undo' }] }).ok, true)
  assert.deepEqual(runtime.getSnapshot().spec, before.spec)
  assert.equal((await status()).calls, 1)
})
