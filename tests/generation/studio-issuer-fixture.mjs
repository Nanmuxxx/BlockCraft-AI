// Only synthetic temporary state. Never load owner secrets or a real ledger.
import { createHash, createHmac } from 'node:crypto'
import { mkdtempSync, realpathSync, chmodSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startStudioServer } from '../../server/studio-launcher.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { POLICY } from '../../server/paid-gateway/pricing.mjs'

export const hash = value => createHash('sha256').update(value).digest('hex')
export function issuerFixture({ origin = 'https://studio.example' } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bc-studio-issuer-MOCK-')))
  chmodSync(dir, 0o700)
  const credential = Buffer.alloc(32, 0x31).toString('base64url')
  const bindingKey = Buffer.alloc(32, 0x42)
  const path = join(dir, 'approval.json'), statePath = join(dir, 'studio-issuer-state.json'), ledgerPath = join(dir, 'studio-ledger.json')
  const grant = { id: 'synthetic-one-time-grant', credentialHash: hash(credential), principal: 'issuer-owner', appId: 'pomodoro',
    issuedAt: Date.now() - 1000, expiresAt: Date.now() + 300_000, sessionExpiresAt: Date.now() + 900_000, revoked: false }
  const approval = { version: 1, publicOrigin: origin, policyId: POLICY.id ?? POLICY.approval,
    approval: { providerVerified: true, permissionsVerified: true, reference: 'SYNTHETIC-MOCK-ONLY', maxCalls: POLICY.maxCalls, expiresAt: Date.now() + 1000_000 },
    sessions: [{ sessionHash: hash('other-synthetic-session-00000000000000'), principal: 'other-owner', appId: 'pomodoro', expiresAt: Date.now() + 500_000, revoked: false }], issuer: grant }
  const save = () => writeFileSync(path, JSON.stringify(approval), { mode: 0o600 })
  save(); writeFileSync(join(dir, 'binding.key'), bindingKey, { mode: 0o600 })
  // Initialization exists ONLY in this synthetic fixture, never in the issuer.
  openLedger(ledgerPath).close()
  const payload = JSON.stringify({ version: 1, grantDigest: hash(JSON.stringify(grant)), attempts: 0, consumed: false, sessionHash: null, sessionExpiresAt: null })
  const mac = createHmac('sha256', bindingKey).update(Buffer.from('blockcraft-studio-issuer-v1', 'ascii')).update(Buffer.from([0x0a])).update(payload).digest('hex')
  writeFileSync(statePath, JSON.stringify({ ...JSON.parse(payload), mac }), { mode: 0o600 })
  const spec = JSON.parse(readFileSync(new URL('../trusted-interactive/pomodoro.json', import.meta.url)))
  let calls = 0
  const instances = []
  const options = { env: { STUDIO_APPROVAL_PATH: path, PUBLIC_ORIGIN: origin, DEEPSEEK_API_KEY: 'synthetic-MOCK-only-never-real-key' }, port: 0, signalHandlers: false,
    fetchImpl: async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) } }
  return { dir, path, statePath, ledgerPath, credential, approval, save, options, spec,
    get calls() { return calls }, state: () => JSON.parse(readFileSync(statePath)),
    async start(extra = {}) { const s = await startStudioServer({ ...options, ...extra }); instances.push(s); return s },
    async cleanup() { for (const s of instances) await s.shutdown(); rmSync(dir, { recursive: true, force: true }) },
  }
}
export const baseURL = s => `http://127.0.0.1:${s.server.address().port}`
export function exchange(f, s, code = f.credential, extra = {}) {
  return fetch(baseURL(s) + '/studio/session', { method: 'POST', redirect: 'manual', headers: { Origin: f.approval.publicOrigin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ credential: code }).toString(), ...extra })
}
export function generate(f, s, cookie, n = 0) {
  return fetch(baseURL(s) + '/api/ai/generate', { method: 'POST', headers: { Origin: f.approval.publicOrigin, Cookie: cookie,
    'Content-Type': 'application/json', 'Idempotency-Key': `issuer-mock-request-${String(n).padStart(4, '0')}-0123456789abcdef` },
    body: JSON.stringify({ idea: '帮我做一个25分钟番茄钟', protocol: 'trusted-interactive/1' }) })
}
