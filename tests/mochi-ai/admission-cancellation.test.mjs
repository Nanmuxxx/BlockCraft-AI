import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiService } from '../../server/mochi-ai/service.mjs'
import { request, advice, access, grant } from './fixtures.mjs'

for (const stage of ['reservation timestamp', 'post-budget gate']) {
  test(`cancellation during ${stage} does not start downstream work`, async () => {
    const controller = new AbortController()
    let service, ledgerCalls = 0, providerCalls = 0
    service = createMochiService({
      enabled: true, approval: grant(1000),
      now: () => {
        if (service && (stage === 'reservation timestamp'
          ? service.usage().calls === 1 && service.usage().inFlight === 0
          : ledgerCalls === 1)) controller.abort()
        return 1000
      },
      reserveBudget: () => { ledgerCalls++; return true },
      provider: { configured: true, analyze: () => { providerCalls++; return advice() } },
    })
    await assert.rejects(service.analyze(access, request(), { signal: controller.signal }), { code: 'CANCELLED' })
    assert.equal(ledgerCalls, stage === 'reservation timestamp' ? 0 : 1)
    assert.equal(providerCalls, 0)
    assert.equal(service.usage().inFlight, 0)
  })
}

test('synchronous proactive revocation and reapproval cannot revive the old request', async () => {
  let service, revoked = false, ledgerCalls = 0, providerCalls = 0
  service = createMochiService({
    enabled: true, approval: grant(1000),
    now: () => {
      if (service && service.usage().calls === 1 && !revoked) {
        revoked = true
        service.consent(access, { enabled: false })
        service.consent(access, { enabled: true })
      }
      return 1000
    },
    reserveBudget: () => { ledgerCalls++; return true },
    provider: { configured: true, analyze: () => { providerCalls++; return advice() } },
  })
  service.consent(access, { enabled: true })
  await assert.rejects(service.analyze(access, request('proactive')), { code: 'CANCELLED' })
  assert.equal(ledgerCalls, 0)
  assert.equal(providerCalls, 0)
  assert.equal(service.usage().inFlight, 0)
})
