import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, chmodSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startStudioServer } from '../../server/studio-launcher.mjs'
import { POLICY, PRICING } from '../../server/paid-gateway/pricing.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { openMochiBudget } from '../../server/paid-gateway/mochi-budget.mjs'
import { request as analysis, advice } from '../mochi-ai/fixtures.mjs'

const origin = 'https://studio.example'
const token = 'studio-synthetic-session-0000000000000001'
const hash = value => createHash('sha256').update(value).digest('hex')
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt - 3600_000 }))
function fixture(t, enabled = true) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bc-mochi-activation-')))
  chmodSync(dir, 0o700)
  const path = join(dir, 'approval.json')
  const approval = { version: 1, publicOrigin: origin, policyId: POLICY.id ?? POLICY.approval,
    approval: { providerVerified: true, permissionsVerified: true, reference: 'SYNTHETIC-MOCK-ONLY', maxCalls: POLICY.maxCalls, expiresAt: Date.now() + 600_000 },
    sessions: [{ sessionHash: hash(token), principal: 'test-owner', appId: 'pomodoro', expiresAt: Date.now() + 300_000, revoked: false }] }
  const save = () => writeFileSync(path, JSON.stringify(approval), { mode: 0o600 })
  save()
  writeFileSync(join(dir, 'binding.key'), Buffer.alloc(32, 0x4b), { mode: 0o600 })
  openLedger(join(dir, 'studio-ledger.json')).close()
  let instance, egress = 0
  const received = []
  const options = { env: { STUDIO_APPROVAL_PATH: path, PUBLIC_ORIGIN: origin, DEEPSEEK_API_KEY: 'synthetic-studio-test-only-key' },
    port: 0, signalHandlers: false, mochiEnabled: enabled,
    fetchImpl: async (_url, init) => {
      egress++
      const body = JSON.parse(init.body); received.push(body)
      assert.equal(body.model, PRICING.model)
      const input = JSON.parse(body.messages[1].content)
      const data = input.version === 1 ? advice('给当前表单增加一个可选日期字段截止时间') : { request: { requestId: input.requestId, baseRevision: input.baseRevision, commands: [
        { type: 'addField', entityId: input.entity.id, field: { id: 'deadline', name: '截止时间', type: 'date', required: false } },
        { type: 'configureBlockFields', blockId: input.block.id, fieldIds: [...input.block.fieldIds, 'deadline'] },
      ] }, capabilityIds: [] }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })
    } }
  t.after(async () => { await instance?.shutdown(); rmSync(dir, { recursive: true, force: true }) })
  return { dir, approval, save, received, get egress() { return egress },
    async start() { instance = await startStudioServer(options); return instance },
    async stop() { await instance?.shutdown(); instance = undefined },
    ledger() { return JSON.parse(readFileSync(join(dir, 'studio-ledger.json'))) },
  }
}
const headers = { Origin: origin, Cookie: `__Host-bc_session=${token}`, 'Content-Type': 'application/json' }
function call(s, path, body, extra = {}) {
  return fetch(`http://127.0.0.1:${s.server.address().port}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const status = s => call(s, '/api/mochi-ai/status').then(r => r.json())

test('activation uses authenticated local structure, explicit consent, controlled advice and separately requested plan; restart never resets usage', async t => {
  const f = fixture(t); let s = await f.start()
  assert.deepEqual(await status(s), { enabled: true, proactiveEnabled: false, modificationsEnabled: false })
  const input = analysis('proactive'), before = structuredClone(input)
  assert.equal((await call(s, '/api/mochi-ai/analyze', input)).status, 403)
  assert.equal(f.egress, 0)
  assert.equal((await call(s, '/api/mochi-ai/consent', { enabled: true, appId: input.context.appId, instanceId: input.context.instanceId })).status, 200)
  const res = await call(s, '/api/mochi-ai/analyze', input)
  assert.equal(res.status, 200, await res.clone().text())
  const output = await res.json()
  assert.equal(output.binding.appId, 'signup', 'owner local app is independent of stored pomodoro session scope')
  assert.equal(output.suggestions.length, 1)
  assert.equal(output.capabilities.modifications, false)
  assert.equal(f.egress, 1)
  assert.equal(f.ledger().entries.length, 1)
  assert.equal(f.received[0].max_tokens, 1024)
  assert.deepEqual(input, before, 'analysis has no project write capability')
  // The client only asks for this candidate AFTER accepting a suggestion; the
  // existing host must still preview, check CAS/permissions, and confirm it.
  const c = input.context
  const planInput = { requestId: 'accepted-suggestion', baseRevision: c.revision, prompt: output.suggestions[0].text,
    block: c.blocks[0], entity: { ...c.entities[0], fields: c.entities[0].fields.map(field => ({ ...field, required: false })) } }
  const plan = await call(s, '/api/mochi-plan', planInput, { 'Idempotency-Key': 'accepted-suggestion-0000000000000001' })
  assert.equal(plan.status, 200, await plan.clone().text())
  const candidate = (await plan.json()).candidate
  assert.equal(candidate.request.commands.length, 2)
  assert.equal(candidate.request.baseRevision, 0)
  assert.equal(f.egress, 2)
  assert.equal(f.ledger().entries.length, 2)
  const receipts = (await import('node:fs')).readdirSync(join(f.dir, '.mochi-budget-v1'))
  assert.equal(receipts.filter(name => /^\d{3}\.json$/.test(name)).length, 2)
  await f.stop(); s = await f.start()
  assert.equal((await status(s)).proactiveEnabled, false)
  assert.equal(f.ledger().entries.length, 2)
  assert.equal((await call(s, '/api/mochi-ai/analyze', analysis())).status, 200)
  assert.equal(f.egress, 3)
  assert.equal(f.ledger().entries.length, 3)
})

test('activation does not grant anonymous, revoked, expired, invalid-origin or C-mode egress', async t => {
  const f = fixture(t), s = await f.start()
  for (const extra of [{ Cookie: '' }, { Cookie: '__Host-bc_session=forged' }]) {
    assert.equal((await call(s, '/api/mochi-ai/status', undefined, extra)).status, 401)
    assert.equal((await call(s, '/api/mochi-ai/analyze', analysis(), extra)).status, 401)
  }
  for (const Origin of ['', 'null', 'https://evil.example']) assert.equal((await call(s, '/api/mochi-ai/consent', { enabled: true }, { Origin })).status, 403)
  const cMode = analysis(); cMode.context.mode = 'software'
  assert.notEqual((await call(s, '/api/mochi-ai/analyze', cMode)).status, 200)
  f.approval.sessions[0].revoked = true; f.save()
  assert.equal((await call(s, '/api/mochi-ai/analyze', analysis())).status, 401)
  f.approval.sessions[0].revoked = false; f.approval.sessions[0].expiresAt = Date.now(); f.save()
  assert.equal((await call(s, '/api/mochi-ai/status')).status, 401)
  assert.equal(f.egress, 0)
})

test('Mochi launch remains default disabled without opt-in', async t => {
  const f = fixture(t, false), s = await f.start()
  assert.equal((await status(s)).enabled, false)
  assert.notEqual((await call(s, '/api/mochi-ai/analyze', analysis())).status, 200)
  assert.equal(f.egress, 0)
})


test('exhausted feature allowance rejects advice and plan before egress while preserving primary ledger', async t => {
  const f = fixture(t)
  const ledger = openLedger(join(f.dir, 'studio-ledger.json'))
  const budget = openMochiBudget({ ledger, directory: f.dir, bindingKey: Buffer.alloc(32, 0x4b) })
  for (let index = 0; index < 92; index++) budget.reserve(1, 1, 'ab'.repeat(32))
  ledger.close()
  const s = await f.start()
  const result = await call(s, '/api/mochi-ai/analyze', analysis())
  assert.equal(result.status, 429)
  assert.equal((await result.json()).error.code, 'BUDGET_EXHAUSTED')
  const c = analysis().context
  const plan = await call(s, '/api/mochi-plan', { requestId: 'budget-denied', baseRevision: 0, prompt: '新增可选日期字段',
    block: c.blocks[0], entity: { ...c.entities[0], fields: c.entities[0].fields.map(field => ({ ...field, required: false })) } },
    { 'Idempotency-Key': 'budget-denied-0000000000000000000001' })
  assert.equal(plan.status, 503)
  assert.equal(f.egress, 0)
  assert.equal(f.ledger().entries.length, 0)
})
