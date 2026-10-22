import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, chmodSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { startStudioServer } from '../../server/studio-launcher.mjs'
import { POLICY, PRICING } from '../../server/paid-gateway/pricing.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'

const origin = 'https://studio.example'
const token = 'studio-synthetic-session-0000000000000001'
const hash = value => createHash('sha256').update(value).digest('hex')
const pomodoro = JSON.parse(readFileSync(new URL('../trusted-interactive/pomodoro.json', import.meta.url)))
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt - 3600_000 }))

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bc-studio-mock-')))
  chmodSync(dir, 0o700)
  const path = join(dir, 'approval.json')
  const approval = { version: 1, publicOrigin: origin, policyId: POLICY.id ?? POLICY.approval,
    approval: { providerVerified: true, permissionsVerified: true, reference: 'SYNTHETIC-MOCK-ONLY', maxCalls: POLICY.maxCalls, expiresAt: Date.now() + 600_000 },
    sessions: [{ sessionHash: hash(token), principal: 'test-owner', appId: 'pomodoro', expiresAt: Date.now() + 300_000, revoked: false }],
  }
  const save = () => writeFileSync(path, JSON.stringify(approval), { mode: 0o600 })
  save()
  writeFileSync(join(dir, 'binding.key'), Buffer.alloc(32, 0x4b), { mode: 0o600 })
  // Explicit provisioning is synthetic fixture setup, never Studio startup.
  openLedger(join(dir, 'studio-ledger.json')).close()
  const env = { STUDIO_APPROVAL_PATH: path, PUBLIC_ORIGIN: origin, DEEPSEEK_API_KEY: 'synthetic-studio-test-only-key' }
  let egress = 0
  let instance
  const options = { env, port: 0, signalHandlers: false, fetchImpl: async (_url, init) => {
    egress++
    assert.equal(JSON.parse(init.body).max_tokens, 2048)
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(pomodoro) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })
  } }
  t.after(async () => { await instance?.shutdown(); rmSync(dir, { recursive: true, force: true }) })
  return { dir, path, approval, env, save, options, get egress() { return egress },
    async start() { instance = await startStudioServer(options); return instance },
  }
}
const key = n => `studio-request-${String(n).padStart(4, '0')}-abcdef0123456789`
function post(started, n = 0, headers = {}) {
  return fetch(`http://127.0.0.1:${started.server.address().port}/api/ai/generate`, {
    method: 'POST', headers: { Origin: origin, Cookie: `__Host-bc_session=${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key(n), ...headers },
    body: JSON.stringify({ idea: '帮我做一个25分钟番茄钟', protocol: 'trusted-interactive/1' }),
  })
}

test('Studio defaults closed: flags, absent approval, HTTP or nonexact origin cannot start', async t => {
  const f = fixture(t)
  for (const env of [{}, { BLOCKCRAFT_STUDIO_APPROVED: '1' }, { ...f.env, STUDIO_APPROVAL_PATH: undefined },
    { ...f.env, PUBLIC_ORIGIN: 'http://studio.example' }, { ...f.env, PUBLIC_ORIGIN: origin + '/' },
    { ...f.env, PUBLIC_ORIGIN: 'https://evil.example' }]) {
    await assert.rejects(startStudioServer({ ...f.options, env }))
  }
  assert.equal(f.egress, 0)
})

test('private approval/key and exact policy verification fail closed', async t => {
  const f = fixture(t)
  for (const change of [a => a.approval.providerVerified = false, a => a.approval.permissionsVerified = false,
    a => a.policyId = 'forged', a => a.approval.maxCalls++, a => a.approval.expiresAt = Date.now(),
    a => a.sessions[0].appId = '', a => a.sessions.push({ ...a.sessions[0] })]) {
    const before = JSON.stringify(f.approval)
    change(f.approval); f.save()
    await assert.rejects(f.start())
    Object.assign(f.approval, JSON.parse(before))
  }
  f.save(); chmodSync(f.path, 0o644); await assert.rejects(f.start()); chmodSync(f.path, 0o600)
  chmodSync(f.dir, 0o755); await assert.rejects(f.start()); chmodSync(f.dir, 0o700)
  const alias = join(f.dir, 'alias.json')
  symlinkSync(f.path, alias)
  await assert.rejects(startStudioServer({ ...f.options, env: { ...f.env, STUDIO_APPROVAL_PATH: alias } }))
  chmodSync(join(f.dir, 'binding.key'), 0o644); await assert.rejects(f.start()); chmodSync(join(f.dir, 'binding.key'), 0o600)
  writeFileSync(join(f.dir, 'binding.key'), Buffer.alloc(31)); await assert.rejects(f.start())
  assert.equal(f.egress, 0)
})

test('trusted Studio composition returns v2 pomodoro; no anonymous cookie minting or local-owner entry', async t => {
  const f = fixture(t), s = await f.start()
  const result = await post(s)
  assert.equal(result.status, 200, await result.clone().text())
  assert.deepEqual((await result.json()).spec, pomodoro)
  assert.equal(result.headers.get('set-cookie'), null)
  const local = await fetch(`http://127.0.0.1:${s.server.address().port}/local-owner/start`)
  assert.equal(local.headers.get('set-cookie'), null)
  assert.notEqual(local.status, 303)
  assert.equal(f.egress, 1)
})

test('anonymous, forged, unknown, expired, revoked, duplicate cookies reject without egress', async t => {
  const f = fixture(t), s = await f.start()
  for (const headers of [{ Cookie: '' }, { Cookie: '__Host-bc_session=short' },
    { Cookie: `__Host-bc_session=${'z'.repeat(40)}` },
    { Cookie: '', 'X-Principal': 'test-owner', 'X-Forwarded-For': '127.0.0.1' },
    { Cookie: `__Host-bc_session=${token}; __Host-bc_session=${token}` }]) {
    assert.equal((await post(s, 0, headers)).status, 401)
  }
  f.approval.sessions[0].expiresAt = Date.now() - 1; f.save()
  assert.equal((await post(s)).status, 401)
  f.approval.sessions[0].expiresAt = Date.now() + 1000; f.approval.sessions[0].revoked = true; f.save()
  assert.equal((await post(s)).status, 401)
  f.approval.sessions[0].revoked = false; f.save()
  // Separate Cookie headers are also rejected by the existing opaque resolver.
  await new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${s.server.address().port}/api/ai/generate`, { method: 'POST',
      headers: ['Host', 'studio.example', 'Origin', origin, 'Cookie', `__Host-bc_session=${token}`, 'Cookie', `__Host-bc_session=${token}`] }, res => {
      assert.equal(res.statusCode, 401); res.resume(); res.on('end', resolve)
    }); req.on('error', reject); req.end('{}')
  })
  assert.equal(f.egress, 0)
})

test('wrong, missing and duplicate Origin reject 403, regardless of forwarded identity', async t => {
  const f = fixture(t), s = await f.start()
  for (const value of ['', 'https://evil.example', origin + '/']) assert.equal((await post(s, 0, { Origin: value })).status, 403)
  await new Promise((resolve, reject) => {
    const req = request(`http://127.0.0.1:${s.server.address().port}/api/ai/generate`, { method: 'POST',
      headers: ['Host', 'studio.example', 'Origin', origin, 'Origin', origin, 'Cookie', `__Host-bc_session=${token}`] }, res => {
      assert.equal(res.statusCode, 403); res.resume(); res.on('end', resolve)
    }); req.on('error', reject); req.end('{}')
  })
  assert.equal(f.egress, 0)
})

test('persisted budget and idempotency survive shutdown/restart; a second process cannot acquire ledger', async t => {
  const f = fixture(t)
  let s = await f.start()
  await assert.rejects(startStudioServer(f.options))
  assert.equal((await post(s, 0)).status, 200)
  assert.equal((await post(s, 0)).status, 409)
  await s.shutdown()
  s = await f.start()
  assert.equal((await post(s, 0)).status, 409)
  for (let n = 1; n < POLICY.maxCalls; n++) assert.equal((await post(s, n)).status, 200)
  assert.notEqual((await post(s, 9)).status, 200)
  assert.equal(f.egress, POLICY.maxCalls)
  await s.shutdown()
  s = await f.start()
  assert.notEqual((await post(s, 10)).status, 200)
  assert.equal(f.egress, POLICY.maxCalls)
  const ledger = JSON.parse(readFileSync(join(f.dir, 'studio-ledger.json')))
  assert.equal(ledger.entries.length, POLICY.maxCalls)
  assert.ok(ledger.entries.every(e => e.status === 'settled'))
})

test('live approval revocation/change or unsafe permissions close active authorization', async t => {
  const f = fixture(t), s = await f.start()
  f.approval.approval.permissionsVerified = false; f.save()
  assert.equal((await post(s)).status, 401)
  f.approval.approval.permissionsVerified = true; f.save()
  chmodSync(f.path, 0o644)
  assert.equal((await post(s)).status, 401)
  assert.equal(f.egress, 0)
})

test('Studio accepts only fixed pomodoro app scope, including live config reload', async t => {
  const f = fixture(t)
  for (const appId of ['tasks', 'Pomodoro', 'pomodoro-other', ['pomodoro'], ['pomodoro', 'tasks']]) {
    f.approval.sessions[0].appId = appId; f.save()
    await assert.rejects(f.start())
  }
  f.approval.sessions[0].appId = 'pomodoro'
  f.approval.sessions.push({ ...f.approval.sessions[0], sessionHash: hash('second-mock-session-0000000000000000'), principal: 'second-owner', appId: 'tasks' })
  f.save(); await assert.rejects(f.start())
  f.approval.sessions.pop(); f.save()
  const s = await f.start()
  f.approval.sessions[0].appId = 'tasks'; f.save()
  assert.equal((await post(s)).status, 401)
  assert.equal(f.egress, 0)
})

test('encoded generation path cannot bypass strict Origin and approval expiry is live', async t => {
  const f = fixture(t), s = await f.start()
  const response = await fetch(`http://127.0.0.1:${s.server.address().port}/api/ai/%67enerate`, {
    method: 'POST', headers: { Cookie: `__Host-bc_session=${token}` }, body: '{}',
  })
  assert.equal(response.status, 403)
  t.mock.timers.setTime(f.approval.approval.expiresAt + 1)
  assert.equal((await post(s)).status, 401)
  assert.equal(f.egress, 0)
})

test('shutdown drains an admitted request before releasing durable ledger', async t => {
  const f = fixture(t)
  let release, entered
  const upstream = new Promise(resolve => { entered = resolve })
  const original = f.options.fetchImpl
  f.options.fetchImpl = async (...args) => { entered(); await new Promise(resolve => { release = resolve }); return original(...args) }
  const s = await f.start()
  const pending = post(s)
  await upstream
  const stopping = s.shutdown()
  await assert.rejects(startStudioServer(f.options))
  release()
  assert.equal((await pending).status, 200)
  await stopping
  assert.equal(JSON.parse(readFileSync(join(f.dir, 'studio-ledger.json'))).entries[0].status, 'settled')
  const restarted = await f.start()
  assert.equal((await post(restarted)).status, 409)
})
