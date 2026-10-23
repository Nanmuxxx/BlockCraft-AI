import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, realpathSync, renameSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { initializeUnifiedLedger, openUnifiedLedger, UNIFIED_PRICING, UNIFIED_CUSTOMER_POLICY, UNIFIED_TEST_POLICY } from '../../server/paid-gateway/unified-ledger.mjs'
import { createPaidTransport } from '../../server/paid-gateway/provider.mjs'

const hash = s => createHash('sha256').update(s).digest('hex')
const usage = (prompt = 1, completion = 1) => ({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion })
function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'unified-budget-'))); chmodSync(directory, 0o700)
  const path = join(directory, 'ledger.json'), handles = []
  const options = { pricingGuard() {} }
  t.after(() => { for (const handle of handles) handle.close(); rmSync(directory, { recursive: true, force: true }) })
  const open = () => { const handle = openUnifiedLedger(path, options); handles.push(handle); return handle }
  initializeUnifiedLedger(path, { epochId: 'reset-20261023' })
  return { path, directory, open }
}
const reserve = (account, suffix = 'request', input = 10, output = 10) => account.reserve(input, output, hash(suffix))

test('explicit initialization creates zero counters for both accounts, refuses reset and missing state', t => {
  const f = fixture(t), root = f.open()
  assert.equal(root.snapshot().accounts.customer.maxNano, 20e9)
  assert.equal(root.snapshot().accounts.customer.maxCalls, null)
  assert.equal(root.snapshot().accounts['agent-test'].maxNano, 5e9)
  assert.equal(root.snapshot().accounts['agent-test'].maxCalls, 200)
  assert.equal(root.snapshot().accounts.customer.calls, 0)
  assert.equal(root.snapshot().accounts['agent-test'].calls, 0)
  assert.throws(() => initializeUnifiedLedger(f.path, { epochId: 'another-reset' }), { code: 'LEDGER_LOCKED' })
  root.close()
  assert.throws(() => initializeUnifiedLedger(f.path, { epochId: 'another-reset' }), { code: 'EEXIST' })
  rmSync(f.path)
  assert.throws(() => f.open(), { code: 'ENOENT' })
})

test('exclusive process lease prevents concurrent roots; account handles are shared', t => {
  const f = fixture(t), root = f.open()
  assert.throws(() => f.open(), { code: 'LEDGER_LOCKED' })
  assert.equal(root.forAccount('customer'), root.forAccount('customer'))
  assert.throws(() => root.forAccount('caller-choice'), { code: 'BUDGET_ACCOUNT_INVALID' })
})

test('all AI features reserve the same customer account and charge actual usage, not maximum', t => {
  const root = fixture(t).open(), customer = root.forAccount('customer')
  for (const feature of ['generate', 'modify', 'advice']) {
    const id = reserve(customer, feature, 100, 100)
    customer.settle(id, usage(2, 3))
  }
  assert.equal(customer.snapshot().calls, 3)
  assert.equal(customer.snapshot().usedNano, 3 * (2 * 2000 + 3 * 8000))
  assert.equal(root.forAccount('agent-test').snapshot().calls, 0)
})

test('customer exceeds 1000 persistent claims without hidden call cap; duplicate remains blocked after restart', t => {
  const f = fixture(t); let root = f.open(), customer = root.forAccount('customer')
  for (let i = 0; i < 1005; i++) {
    const store = customer.reservationStore({ principal: 'customer-session', key: `key-${i}`, payloadHash: hash('payload') })
    store.check(); const id = store.reserve({}, 1, 1, hash(`request-${i}`)); customer.settle(id, usage())
  }
  assert.equal(customer.snapshot().calls, 1005)
  assert.equal(customer.snapshot().remainingCalls, null)
  root.close(); root = f.open(); customer = root.forAccount('customer')
  const replay = customer.reservationStore({ principal: 'customer-session', key: 'key-0', payloadHash: hash('payload') })
  assert.throws(() => replay.check(), { code: 'IDEMPOTENCY_REPLAY' })
  assert.throws(() => replay.reserve({}, 1, 1, hash('a')), { code: 'IDEMPOTENCY_REPLAY' })
  const conflict = customer.reservationStore({ principal: 'customer-session', key: 'key-0', payloadHash: hash('different') })
  assert.throws(() => conflict.check(), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.equal(customer.snapshot().calls, 1005)
})

test('all agents share 200 calls while customer spending is independent', t => {
  const root = fixture(t).open(), account = root.forAccount('agent-test')
  for (let i = 0; i < 200; i++) {
    const store = account.reservationStore({ principal: `agent-${i % 4}`, key: `test-${i}`, payloadHash: hash('same') })
    const id = store.reserve({}, 1, 1, hash('r')); account.settle(id, usage())
  }
  assert.throws(() => reserve(account), { code: 'BUDGET_EXHAUSTED' })
  assert.equal(account.snapshot().calls, 200)
  assert.equal(root.forAccount('customer').snapshot().usedNano, 0)
  reserve(root.forAccount('customer'))
})

for (const name of ['customer', 'agent-test']) test(`${name} rejects reservation beyond monetary limit before charging`, t => {
  const account = fixture(t).open().forAccount(name)
  while (account.snapshot().remainingNano >= 212992000) {
    const id = reserve(account, 'full', 73728, 8192); account.settle(id, usage(73728, 8192))
  }
  const before = account.snapshot()
  assert.throws(() => reserve(account, 'too-large', 73728, 8192), { code: 'BUDGET_EXHAUSTED' })
  assert.deepEqual(account.snapshot(), before)
  assert.equal(before.halted, false)
})

test('unknown/network failure costs maximum reservation, permits further calls and survives restart', t => {
  const f = fixture(t); let root = f.open(), account = root.forAccount('customer')
  const id = reserve(account); account.uncertain(id)
  assert.equal(account.snapshot().usedNano, 100000)
  assert.equal(account.snapshot().halted, false)
  const crash = reserve(account, 'interrupted'); root.close()
  root = f.open(); account = root.forAccount('customer')
  assert.equal(account.snapshot().entries.find(e => e.id === crash).status, 'uncertain')
  assert.equal(account.snapshot().usedNano, 200000)
  const next = reserve(account, 'next'); account.settle(next, usage()); account.uncertain(next)
  assert.equal(account.snapshot().usedNano, 210000)
})

test('missing usage remains fully charged, but usage outside reservation halts affected account', t => {
  const root = fixture(t).open(), account = root.forAccount('customer')
  const unknown = reserve(account)
  assert.throws(() => account.settle(unknown, undefined), { code: 'USAGE_UNRELIABLE' })
  assert.equal(account.snapshot().halted, false)
  const id = reserve(account)
  assert.throws(() => account.settle(id, usage(11, 10)), { code: 'USAGE_UNRELIABLE' })
  assert.throws(() => reserve(account), { code: 'BUDGET_HALTED' })
  assert.equal(account.snapshot().usedNano, 200000)
  reserve(root.forAccount('agent-test'))
})

test('corruption and incompatible pricing fail closed without replacing ledger', t => {
  const f = fixture(t), root = f.open(); root.close()
  const original = readFileSync(f.path, 'utf8'), state = JSON.parse(original)
  state.accounts.customer.entries.push({ id: 'forged', status: 'settled', reserveNano: 0 })
  writeFileSync(f.path, JSON.stringify(state), { mode: 0o600 })
  assert.throws(() => f.open(), { code: 'LEDGER_INVALID' })
  assert.equal(readFileSync(f.path, 'utf8'), JSON.stringify(state))
  writeFileSync(f.path, original)
  assert.throws(() => openUnifiedLedger(f.path, { pricing: { ...UNIFIED_PRICING, outputNanoPerToken: 1 } }), { code: 'PRICING_INVALID' })
})

test('pricing guard blocks charge and no expired default can make paid reservation', t => {
  const f = fixture(t), root = f.open(); root.close()
  const guarded = openUnifiedLedger(f.path, { pricingGuard() { throw Object.assign(new Error('PRICING_EXPIRED'), { code: 'PRICING_EXPIRED' }) } })
  try {
    assert.throws(() => reserve(guarded.forAccount('customer')), { code: 'PRICING_EXPIRED' })
    assert.equal(guarded.forAccount('customer').snapshot().calls, 0)
  } finally { guarded.close() }
})

test('persist failure makes handle unusable, leaves no partial reservation and cannot reach egress', async t => {
  const f = fixture(t), root = f.open(), account = root.forAccount('customer'), moved = f.directory + '-moved'
  renameSync(f.directory, moved)
  try {
    assert.throws(() => reserve(account), { code: 'LEDGER_UNAVAILABLE' })
    assert.throws(() => account.snapshot(), { code: 'LEDGER_UNAVAILABLE' })
    assert.throws(() => reserve(account), { code: 'LEDGER_UNAVAILABLE' })
    assert.equal(JSON.parse(readFileSync(join(moved, 'ledger.json'), 'utf8')).accounts.customer.entries.length, 0)
  } finally { renameSync(moved, f.directory); root.close() }
  // Explicit administrative recovery after the closed lease; never runtime reset.
  rmSync(f.path + '.lock')
  assert.equal(f.open().forAccount('customer').snapshot().calls, 0)
})

test('mounted compatibility accepts only approved modes, canonical owned regular files; active lease cannot be recovered', t => {
  const f = fixture(t), root = f.open(); root.close()
  chmodSync(f.directory, 0o777); chmodSync(f.path, 0o666)
  assert.throws(() => f.open(), { code: 'LEDGER_PERMISSIONS' })
  const mounted = openUnifiedLedger(f.path, { allowMountedDirectory: true, pricingGuard() {} })
  try {
    assert.throws(() => openUnifiedLedger(f.path, { allowMountedDirectory: true }), { code: 'LEDGER_LOCKED' })
  } finally { mounted.close() }
  chmodSync(f.directory, 0o700)
  const alias = join(f.directory, 'alias.json'); symlinkSync(f.path, alias)
  assert.throws(() => openUnifiedLedger(alias, { allowMountedDirectory: true }), { code: 'LEDGER_PERMISSIONS' })
  chmodSync(f.path, 0o664)
  assert.throws(() => openUnifiedLedger(f.path, { allowMountedDirectory: true }), { code: 'LEDGER_PERMISSIONS' })
})

test('paid transport persists reservation before offline egress; replay never submits twice', async t => {
  const f = fixture(t), account = f.open().forAccount('customer'); let fetches = 0
  const transport = createPaidTransport({ apiKey: 'offline-placeholder-key', ledger: account, pricing: UNIFIED_PRICING,
    policy: UNIFIED_CUSTOMER_POLICY, reservationStore: account.reservationStore({ principal: 'customer-session', key: 'retry-key', payloadHash: hash('payload') }),
    fetchImpl: async () => {
      fetches++
      const disk = JSON.parse(readFileSync(f.path, 'utf8'))
      assert.equal(disk.accounts.customer.entries.length, 1)
      assert.equal(disk.accounts.customer.entries[0].status, 'reserved')
      return Response.json({ usage: usage(), choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }] })
    } })
  const request = { method: 'POST', body: JSON.stringify({ model: UNIFIED_PRICING.model, messages: [{ role: 'system', content: 'fixture' }, { role: 'user', content: 'fixture' }], stream: false, response_format: { type: 'json_object' }, max_tokens: 100 }) }
  await transport('https://api.deepseek.com/chat/completions', request)
  await assert.rejects(transport('https://api.deepseek.com/chat/completions', request), { code: 'IDEMPOTENCY_REPLAY' })
  assert.equal(fetches, 1)
  assert.equal(account.snapshot().usedNano, 10000)
  assert.equal(UNIFIED_TEST_POLICY.maxCalls, 200)
})
