import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync, chmodSync, existsSync, readdirSync, linkSync, symlinkSync, mkdirSync } from 'node:fs'
import { request } from 'node:http'
import { startStudioServer } from '../../server/studio-launcher.mjs'
import { PRICING } from '../../server/paid-gateway/pricing.mjs'
import { issuerFixture, baseURL, exchange, generate, hash } from './studio-issuer-fixture.mjs'

beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: PRICING.expiresAt - 3600_000 }))
function fixture(t) { const f = issuerFixture(); t.after(() => f.cleanup()); return f }
const cookieOf = r => r.headers.get('set-cookie')?.split(';')[0]

test('all Studio launches refuse missing ledger before creating ledger, issuer state or authorization', async t => {
  for (const withIssuer of [true, false]) {
    const f = fixture(t)
    if (!withIssuer) { delete f.approval.issuer; f.save() }
    rmSync(f.ledgerPath); rmSync(f.statePath)
    const before = readdirSync(f.dir).sort(), approval = readFileSync(f.path)
    await assert.rejects(f.start())
    assert.deepEqual(readdirSync(f.dir).sort(), before)
    assert.deepEqual(readFileSync(f.path), approval)
    assert.equal(existsSync(f.ledgerPath), false)
    assert.equal(existsSync(f.statePath), false)
    assert.equal(f.calls, 0)
  }
})

test('Studio ledger metadata preflight rejects unsafe mode, hardlink, symlink and nonregular file', async t => {
  const f = fixture(t), bytes = readFileSync(f.ledgerPath), state = readFileSync(f.statePath)
  chmodSync(f.ledgerPath, 0o644); await assert.rejects(f.start()); chmodSync(f.ledgerPath, 0o600)
  const alias = f.ledgerPath + '.alias'
  linkSync(f.ledgerPath, alias); await assert.rejects(f.start()); rmSync(alias)
  rmSync(f.ledgerPath); writeFileSync(alias, bytes, { mode: 0o600 })
  symlinkSync(alias, f.ledgerPath); await assert.rejects(f.start()); rmSync(f.ledgerPath); rmSync(alias)
  mkdirSync(f.ledgerPath, { mode: 0o700 }); await assert.rejects(f.start()); rmSync(f.ledgerPath, { recursive: true })
  assert.deepEqual(readFileSync(f.statePath), state); assert.equal(f.calls, 0)
  assert.equal(existsSync(f.ledgerPath + '.lock'), false)
})

test('issuer commits consume+hash before exact Secure cookie, then actual v2 Mock works across restart', async t => {
  const f = fixture(t); let s = await f.start()
  assert.equal((await fetch(baseURL(s) + '/studio/sign-in')).headers.get('set-cookie'), null)
  assert.equal((await generate(f, s, '')).status, 401)
  const r = await exchange(f, s), cookie = cookieOf(r), token = cookie.split('=')[1]
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/ai-create')
  assert.match(r.headers.get('set-cookie'), /^__Host-bc_session=[\w-]{43}; Secure; HttpOnly; SameSite=Strict; Path=\/; Max-Age=900$/)
  assert.equal(await r.text(), ''); assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal(f.state().consumed, true); assert.equal(f.state().sessionHash, hash(token)); assert.equal(f.state().attempts, 1)
  assert.ok(!readFileSync(f.statePath, 'utf8').includes(token)); assert.ok(!readFileSync(f.path, 'utf8').includes(f.credential))
  assert.equal((await exchange(f, s)).status, 401)
  assert.equal((await generate(f, s, cookie)).status, 200)
  await s.shutdown(); s = await f.start()
  assert.equal((await exchange(f, s)).status, 401)
  assert.equal((await generate(f, s, cookie, 1)).status, 200)
  f.approval.issuer.revoked = true; f.save()
  assert.equal((await generate(f, s, cookie, 2)).status, 401)
  assert.equal(f.calls, 2)
})

test('five durable attempts including malformed fields survive restart; no recovery or reset', async t => {
  const f = fixture(t); let s = await f.start()
  for (let n = 0; n < 3; n++) assert.equal((await exchange(f, s, 'wrong')).status, 401)
  await s.shutdown(); s = await f.start()
  assert.equal((await exchange(f, s, f.credential, { body: `credential=${f.credential}&credential=${f.credential}` })).status, 401)
  assert.equal((await exchange(f, s, 'wrong')).status, 401)
  assert.equal((await exchange(f, s)).status, 401)
  assert.equal(f.state().attempts, 5); assert.equal(f.state().consumed, false); assert.equal(f.calls, 0)
})

test('simultaneous redemption issues at most one session; second process cannot lock ledger', async t => {
  const f = fixture(t), s = await f.start()
  await assert.rejects(startStudioServer(f.options))
  const rs = await Promise.all([exchange(f, s), exchange(f, s)])
  assert.deepEqual(rs.map(r => r.status).sort(), [303, 401]); assert.equal(rs.filter(cookieOf).length, 1)
  assert.equal(f.state().attempts, 1)
})

test('grant field order is canonical, live expiry/revocation and fixed scope fail closed', async t => {
  const f = fixture(t)
  f.approval.issuer = Object.fromEntries(Object.entries(f.approval.issuer).reverse()); f.save()
  const s = await f.start()
  f.approval.issuer.revoked = true; f.save(); assert.equal((await exchange(f, s)).status, 503)
  f.approval.issuer.revoked = false; f.save()
  t.mock.timers.setTime(f.approval.issuer.expiresAt + 1)
  assert.equal((await exchange(f, s)).status, 401); assert.equal(f.state().attempts, 0)
  f.approval.issuer.appId = 'tasks'; f.save(); assert.equal((await exchange(f, s)).status, 503)
  assert.equal(f.calls, 0)
})

test('header/path rejects consume no attempt and never reflect credentials', async t => {
  const f = fixture(t), s = await f.start()
  for (const [extra, status] of [[{ headers: { Origin: 'https://evil.example' } }, 403],
    [{ headers: { Origin: f.approval.publicOrigin, 'Content-Type': 'text/plain' } }, 415],
    [{ headers: { Origin: f.approval.publicOrigin, 'Sec-Fetch-Site': 'cross-site' } }, 403],
    [{ method: 'PUT' }, 405]]) {
    const r = await exchange(f, s, f.credential, extra); assert.equal(r.status, status); assert.equal(cookieOf(r), undefined); assert.equal(await r.text(), '')
  }
  for (const path of ['/studio/session?credential=secret', '/studio/%73ession']) {
    const r = await fetch(baseURL(s) + path); assert.equal(r.status, 400); assert.equal(r.headers.get('set-cookie'), null)
  }
  assert.equal(f.state().attempts, 0); assert.equal(f.calls, 0)
})

test('missing/corrupt/unsafe state or missing/invalid ledger refuses startup without resetting state', async t => {
  const f = fixture(t), original = readFileSync(f.statePath)
  for (const content of ['{}', '{', JSON.stringify({ ...f.state(), attempts: 1 }), JSON.stringify({ ...f.state(), version: 2 })]) {
    writeFileSync(f.statePath, content); await assert.rejects(f.start()); assert.equal(readFileSync(f.statePath, 'utf8'), content)
  }
  writeFileSync(f.statePath, original); chmodSync(f.statePath, 0o644); await assert.rejects(f.start()); chmodSync(f.statePath, 0o600)
  rmSync(f.statePath); await assert.rejects(f.start()); assert.equal(existsSync(f.statePath), false)
  writeFileSync(f.statePath, original, { mode: 0o600 })
  const ledger = readFileSync(f.ledgerPath); rmSync(f.ledgerPath)
  await assert.rejects(f.start()); assert.equal(existsSync(f.ledgerPath), false)
  writeFileSync(f.ledgerPath, '{}', { mode: 0o600 }); await assert.rejects(f.start()); assert.equal(readFileSync(f.ledgerPath, 'utf8'), '{}')
  writeFileSync(f.ledgerPath, ledger); const s = await f.start(); assert.equal((await exchange(f, s)).status, 303)
})

const boundaries = ['before-open', 'after-open', 'before-write', 'after-write', 'before-file-fsync', 'after-file-fsync', 'before-rename', 'after-rename', 'before-dir-fsync', 'after-dir-fsync']
for (const commitNumber of [1, 2]) for (const boundary of boundaries) {
  test(`fault ${boundary} commit ${commitNumber}: no cookie, halted; restart respects committed consumption`, async t => {
    const f = fixture(t); let commits = 0
    const s = await f.start({ issuerFault: point => { if (point === 'before-open') commits++; if (commits === commitNumber && point === boundary) throw new Error('SYNTHETIC_FAULT') } })
    const r = await exchange(f, s); assert.equal(r.status, 503); assert.equal(cookieOf(r), undefined)
    const again = await exchange(f, s); assert.equal(again.status, 503); assert.equal(cookieOf(again), undefined)
    const consumed = f.state().consumed
    assert.equal(consumed, commitNumber === 2 && ['after-rename', 'before-dir-fsync', 'after-dir-fsync'].includes(boundary))
    await s.shutdown(); const restarted = await f.start()
    const retry = await exchange(f, restarted)
    assert.equal(retry.status, consumed ? 401 : 303)
    if (consumed) assert.equal(cookieOf(retry), undefined)
    assert.equal(f.calls, 0)
  })
}

test('shutdown aborts outstanding issuer body before releasing Gateway lifetime lock', async t => {
  const f = fixture(t), s = await f.start()
  let resolveStarted
  const seen = new Promise(resolve => { resolveStarted = resolve })
  s.server.prependListener('request', req => { if (req.url === '/studio/session') resolveStarted() })
  const closed = new Promise(resolve => {
    const req = request(baseURL(s) + '/studio/session', { method: 'POST', headers: { Origin: f.approval.publicOrigin, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '100' } })
    req.on('error', resolve); req.on('close', resolve); req.write('credential=')
  })
  await seen
  const stop = s.shutdown()
  await assert.rejects(f.start())
  await stop; await closed
  assert.equal(f.state().attempts, 0)
  const restarted = await f.start(); assert.equal((await exchange(f, restarted)).status, 303)
})

test('body concurrency, 1KiB ceiling, two-second deadline and disconnect are bounded without spending attempts', async t => {
  const f = fixture(t), s = await f.start()
  const held = [], completions = []
  for (let n = 0; n < 2; n++) {
    let seen
    const entered = new Promise(resolve => { seen = resolve })
    s.server.once('request', seen)
    completions.push(new Promise(resolve => {
      const req = request(baseURL(s) + '/studio/session', { method: 'POST', headers: { Origin: f.approval.publicOrigin, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '100' } })
      req.on('error', resolve); req.on('close', resolve); req.write('credential='); held.push(req)
    }))
    await entered
  }
  assert.equal((await exchange(f, s)).status, 429)
  held[0].destroy() // explicit disconnect
  await Promise.all(completions) // second request hits the actual two-second deadline
  await assert.rejects(exchange(f, s, 'x'.repeat(1025)))
  assert.equal(f.state().attempts, 0)
  assert.equal((await exchange(f, s)).status, 303)
})

test('issuer session expiry and duplicate cookies deny without extra upstream calls', async t => {
  const f = fixture(t), s = await f.start(), cookie = cookieOf(await exchange(f, s))
  assert.equal((await generate(f, s, `${cookie}; ${cookie}`)).status, 401)
  t.mock.timers.setTime(f.approval.issuer.sessionExpiresAt + 1)
  assert.equal((await generate(f, s, cookie)).status, 401)
  assert.equal(f.calls, 0)
})

test('shutdown during synchronous consume commit retains lock until admitted transition settles', async t => {
  const f = fixture(t)
  let s, stop, commitNumber = 0, lockSeen = false
  s = await f.start({ issuerFault: point => {
    if (point === 'before-open') commitNumber++
    if (commitNumber === 2 && point === 'before-write') { stop = s.shutdown(); lockSeen = existsSync(f.ledgerPath + '.lock') }
  } })
  assert.equal((await exchange(f, s)).status, 303)
  await stop
  assert.equal(lockSeen, true); assert.equal(f.state().consumed, true)
  const restarted = await f.start(); assert.equal((await exchange(f, restarted)).status, 401)
})
