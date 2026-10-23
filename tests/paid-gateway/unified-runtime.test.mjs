import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUnifiedPaidRuntime } from '../../server/paid-gateway/unified-runtime.mjs'
import { initializeUnifiedLedger, UNIFIED_PRICING } from '../../server/paid-gateway/unified-ledger.mjs'

const endpoint = 'https://api.deepseek.com/chat/completions'
const testPrincipal = 'server-owned-agent-test'
const testSessionHash = 'b'.repeat(64)
const customer = 'authenticated-customer'
const key = n => `offline_request_key_${String(n).padStart(16, '0')}`
const wire = () => ({ method: 'POST', body: JSON.stringify({ model: UNIFIED_PRICING.model,
  messages: [{ role: 'system', content: 'Offline fixture' }, { role: 'user', content: 'Build a form' }],
  max_tokens: 100, stream: false, response_format: { type: 'json_object' } }) })
function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'unified-runtime-'))); chmodSync(directory, 0o700)
  const ledgerPath = join(directory, 'ledger.json'), handles = []
  initializeUnifiedLedger(ledgerPath, { epochId: 'offline-reset-20261023' })
  let fetches = 0
  const open = (fetchImpl = async () => {
    fetches++
    const disk = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    assert.equal(Object.values(disk.accounts).flatMap(a => a.entries).filter(e => e.status === 'reserved').length, 1)
    return Response.json({ usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}' } }] })
  }) => {
    const handle = createUnifiedPaidRuntime({ env: { DEEPSEEK_API_KEY: 'offline-unified-runtime-placeholder' },
      ledgerPath, testPrincipal, testSessionHash, verifyPricing: async () => {}, pricingGuard() {}, fetchImpl })
    handles.push(handle); return handle
  }
  t.after(() => { handles.forEach(h => h.close()); rmSync(directory, { recursive: true, force: true }) })
  return { open, fetches: () => fetches, ledgerPath }
}
async function submit(runtime, method, principal, n) {
  const options = { principal, idempotencyKey: key(n) }
  const transport = method === 'generate'
    ? runtime.forRequest({ ...options, payload: { idea: 'Build a form', protocol: 'v1' } })
    : method === 'field' ? runtime.forFieldPlan({ ...options, input: { prompt: 'Add an optional field' } })
      : runtime.forMochi({ ...options, input: { prompt: 'Suggest a useful improvement' } })
  return transport.fetchImpl(endpoint, wire())
}

test('generation, modification and advice share one customer balance; agent identities share only the test balance', async t => {
  const f = fixture(t), runtime = f.open()
  for (const [i, method] of ['generate', 'field', 'advice'].entries()) await submit(runtime, method, customer, i)
  assert.equal(runtime.budgetStatus().calls, 3)
  assert.equal(runtime.budgetStatus().maxCalls, null)
  assert.equal(runtime.budgetStatus().capCny, 20)
  assert.equal(runtime.budgetStatus().reservedCny, 3 * 28000 / 1e9)
  assert.equal(runtime.budgetStatus('agent-test').calls, 0)
  await submit(runtime, 'generate', testPrincipal, 4)
  await submit(runtime, 'field', testSessionHash, 5)
  await submit(runtime, 'advice', testSessionHash, 6)
  assert.equal(runtime.budgetStatus('agent-test').calls, 3)
  assert.equal(runtime.budgetStatus('agent-test').capCny, 5)
  assert.equal(runtime.budgetStatus('agent-test').maxCalls, 200)
  assert.deepEqual(runtime.mochiBudgetStatus(testSessionHash), runtime.budgetStatus('agent-test'))
  assert.deepEqual(runtime.mochiBudgetStatus(customer), runtime.budgetStatus())
  assert.equal(runtime.budgetStatus().calls, 3)
  assert.equal(f.fetches(), 6)
})

test('request payload cannot select accounts; similar untrusted principal strings do not obtain test budget', async t => {
  const f = fixture(t), runtime = f.open()
  for (const account of ['agent-test', 'customer']) assert.throws(() => runtime.forRequest({
    principal: customer, idempotencyKey: key(account), payload: { idea: 'Form', account },
  }), { code: 'IDEMPOTENCY_PAYLOAD_INVALID' })
  await submit(runtime, 'generate', testPrincipal + '-spoof', 1)
  await submit(runtime, 'advice', testSessionHash.slice(0, 63) + 'c', 2)
  assert.equal(runtime.budgetStatus().calls, 2)
  assert.equal(runtime.budgetStatus('agent-test').calls, 0)
  assert.equal(f.fetches(), 2)
})

test('manual retry is rejected without egress or charge, including after process restart; changed intent conflicts', async t => {
  const f = fixture(t); let runtime = f.open()
  await submit(runtime, 'generate', customer, 1)
  const before = runtime.budgetStatus()
  await assert.rejects(submit(runtime, 'generate', customer, 1), { code: 'IDEMPOTENCY_REPLAY' })
  await assert.rejects(submit(runtime, 'advice', customer, 1), { code: 'IDEMPOTENCY_CONFLICT' })
  assert.deepEqual(runtime.budgetStatus(), before)
  runtime.close(); runtime = f.open()
  await assert.rejects(submit(runtime, 'generate', customer, 1), { code: 'IDEMPOTENCY_REPLAY' })
  assert.deepEqual(runtime.budgetStatus(), before)
  assert.equal(f.fetches(), 1)
})

test('pre-aborted request consumes neither balance nor idempotency key', async t => {
  const f = fixture(t), runtime = f.open(), controller = new AbortController(); controller.abort()
  const options = { principal: customer, idempotencyKey: key(1), payload: { idea: 'Build a form', protocol: 'v1' } }
  await assert.rejects(runtime.forRequest(options).fetchImpl(endpoint, { ...wire(), signal: controller.signal }), { code: 'CANCELLED' })
  assert.equal(runtime.budgetStatus().calls, 0)
  await submit(runtime, 'generate', customer, 1)
  assert.equal(f.fetches(), 1)
})

test('all test identities and AI features stop at the shared 200-call ceiling before any extra egress', async t => {
  const f = fixture(t), runtime = f.open()
  for (let i = 0; i < 200; i++) await submit(runtime, ['generate', 'field', 'advice'][i % 3], i % 2 ? testPrincipal : testSessionHash, i)
  const before = runtime.budgetStatus('agent-test')
  for (const method of ['generate', 'field', 'advice']) await assert.rejects(submit(runtime, method, testPrincipal, 201), { code: 'BUDGET_EXHAUSTED' })
  assert.deepEqual(runtime.budgetStatus('agent-test'), before)
  assert.equal(f.fetches(), 200)
  await submit(runtime, 'generate', customer, 201)
  assert.equal(f.fetches(), 201)
})
