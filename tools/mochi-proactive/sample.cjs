// Root-only, explicit local validation. Never prints credentials, headers or raw errors.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { once } = require('node:events')
const { randomBytes } = require('node:crypto')
const assert = require('node:assert/strict')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
}).outputText, filename)
const { createMochiHost } = require('../../src/integrations/mochi/host.ts')
const { createAppRuntime } = require('../../src/model/appRuntime.ts')
const { createClubRegistrationExample, createReadingLogExample } = require('../../src/model/appSpecExamples.ts')
const { createHttpPlanProvider } = require('../../src/integrations/mochi/httpPlanProvider.ts')
async function main() {
  const live = process.argv.includes('--live')
  if (!live && !process.argv.includes('--offline')) throw new Error('EXPLICIT_MODE_REQUIRED')
  if (live && process.argv.includes('--offline')) throw new Error('EXPLICIT_MODE_REQUIRED')
  const project = process.argv.find(value => value.startsWith('--project='))?.slice(10)
  if (project && !['club', 'reading'].includes(project)) throw new Error('INVALID_PROJECT')
  const { pricing, policy } = await import('./config.mjs')
  const { openLedger } = await import('../../server/paid-gateway/ledger.mjs')
  const { createPaidTransport } = await import('../../server/paid-gateway/provider.mjs')
  const { createLocalAccess } = await import('../../server/paid-gateway/access.mjs')
  const { createAppServer } = await import('../../server/index.mjs')
  const { createMochiApi } = await import('../../src/integrations/mochi-ai/client.mjs')
  const { createWorkshopMochiConversation } = await import('../../src/integrations/mochi-ai/workshop.mjs')
  const { validateFieldCandidate } = await import('../../server/mochi-plan.mjs')
  const root = path.resolve(__dirname, '../..')
  const common = path.resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim())
  if (live && !process.env.DEEPSEEK_API_KEY) process.loadEnvFile(path.resolve(common, '../server/.env'))
  const apiKey = live ? process.env.DEEPSEEK_API_KEY?.trim() : 'OFFLINE-SYNTHETIC-SAMPLING-KEY'
  if (!apiKey) throw new Error('CREDENTIAL_UNAVAILABLE')
  const privateDir = live ? path.join(common, 'ai-private', policy.approval) : fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mochi-sample-offline-'))
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 })
  const ledger = openLedger(path.join(privateDir, 'ledger.json'), { pricing, policy, ...(live ? {} : { now: () => pricing.expiresAt - 1 }) })
  const token = randomBytes(32).toString('hex'), access = createLocalAccess(token)
  let activeAppId = null, server, bridge, host
  const samples = [], startedAt = new Date().toISOString()
  let activeSample = null, activePlanInput = null
  const audit = () => {
    const state = ledger.snapshot(), entries = state.entries
    return { source: live ? 'deepseek' : 'offline-fixture', approval: policy.approval, limits: { calls: 100, cny: 5 }, enforced: { calls: policy.maxCalls, reservedCny: policy.conservativeNano / 1e9 },
      pricing, calls: entries.length, estimatedCny: entries.reduce((n,e) => n + (e.estimatedNano ?? 0),0) / 1e9,
      reservedCny: entries.reduce((n,e) => n + e.reserveNano,0) / 1e9, halted: state.halted,
      entries: entries.map(({status,usage,reserveNano,estimatedNano}) => ({status,usage,reservedCny:reserveNano/1e9,estimatedCny:estimatedNano === undefined ? null : estimatedNano/1e9})) }
  }
  try {
    const offlineFetch = async (_url, init) => {
      const input = JSON.parse(JSON.parse(init.body).messages[1].content)
      const content = input.kind ? { message: '可以补充备注。', suggestions: [{ text: '增加可选备注字段', reason: '便于补充信息。',
        blockId: input.context.selectedBlockId, priority: 'medium', requiresUserAction: true, kind: 'design-change' }] } : {
        request: { requestId: input.requestId, baseRevision: input.baseRevision, commands: [
          { type: 'addField', entityId: input.entity.id, field: { id: 'sample_note', name: '备注', type: 'text', required: false } },
          { type: 'configureBlockFields', blockId: input.block.id, fieldIds: [...input.block.fieldIds, 'sample_note'] },
        ] }, capabilityIds: [] }
      return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } })
    }
    const transport = createPaidTransport({ apiKey, ledger, pricing, policy, ...(live ? {} : { fetchImpl: offlineFetch }),
      onResponse(envelope) {
        if (!activeSample || !activePlanInput) return
        // Only projected diagnostics from the synthetic acceptance projects; never raw responses/errors.
        let output
        try { output = JSON.parse(envelope.choices[0].message.content) } catch { activeSample.planDiagnostics = { validation: 'INVALID_JSON' }; return }
        const commands = output?.request?.commands
        activeSample.planDiagnostics = { commandCount: Array.isArray(commands) ? commands.length : null,
          commandTypes: Array.isArray(commands) ? commands.map(c => ['addField','configureBlockFields','configureBlockPresentation','addBlock'].includes(c?.type) ? c.type : 'UNKNOWN') : [] }
        try { validateFieldCandidate(output, activePlanInput); activeSample.planDiagnostics.validation = 'PASSED' }
        catch { activeSample.planDiagnostics.validation = 'AI_INVALID_RESPONSE' }
      } })
    server = createAppServer({ apiKey, model: pricing.model, fetchImpl: transport,
      fieldPlanning: { enabled: true, resolveAccess: access },
      mochi: { enabled: true, allowedOrigin: 'http://127.0.0.1',
        resolveAccess: req => access(req) && activeAppId ? { sessionId: 'root-local-acceptance', appId: activeAppId } : null,
        approval: { providerVerified: true, permissionsVerified: true, reference: policy.approval, maxCalls: policy.maxCalls, maxTotalTokens: 100_000, expiresAt: live ? pricing.expiresAt : Date.now() + 3600_000 },
        // The shared transport performs the atomic monetary reservation BEFORE every advice/plan egress.
        // This service admission is additional, and can never bypass that transport's durable hard cap.
        reserveBudget: () => !ledger.snapshot().halted && ledger.snapshot().entries.length < policy.maxCalls,
      } })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const origin = `http://127.0.0.1:${server.address().port}`
    const localFetch = (url, init = {}) => {
      if (url === '/api/mochi-plan' && init.method === 'POST') activePlanInput = JSON.parse(init.body)
      return fetch(new URL(url, origin), { ...init, headers: { ...init.headers, Authorization: 'Bearer ' + token } })
    }
    const examples = project === 'club' ? [createClubRegistrationExample] : project === 'reading' ? [createReadingLogExample] : [createClubRegistrationExample, createReadingLogExample]
    for (const example of examples) {
      const runtime = createAppRuntime(example()), before = runtime.getSnapshot()
      activePlanInput = null
      activeAppId = before.spec.id
      let executions = 0
      activeSample = { appId: activeAppId, event: 'project-opened', beforeRevision: before.revision, stage: 'advice', readExecutions: () => executions }
      const execute = runtime.executeCommand
      runtime.executeCommand = (...args) => { executions++; return execute(...args) }
      host = createMochiHost(runtime, createHttpPlanProvider(localFetch))
      host.setSelection(before.spec.blocks.find(b => b.type === 'form').id)
      bridge = createWorkshopMochiConversation(host, { api: createMochiApi({ fetchImpl: localFetch }), analyzeOnConsent: false })
      const conversation = bridge.conversation
      await conversation.refreshStatus(); assert.equal(conversation.getSnapshot().enabled, true)
      await conversation.setProactive(true)
      const reply = await conversation.onEvent({ type: 'project-opened' })
      assert.equal(executions, 0)
      const candidates = reply.suggestions.filter(s => s.kind === 'design-change' && s.requiresUserAction && before.spec.blocks.some(b => b.id === s.blockId && ['form','list'].includes(b.type)))
      const suggestion = candidates.find(s => s.blockId === host.getSnapshot().context.selectedBlockId) ?? candidates[0]
      assert(suggestion, 'NO_EXECUTABLE_SUGGESTION')
      activeSample.accepted = { text: suggestion.text, reason: suggestion.reason, blockId: suggestion.blockId }
      activeSample.stage = 'plan-preview'
      await conversation.requestModification(suggestion.id)
      assert.equal(host.getSnapshot().phase, 'PREVIEW'); assert.equal(executions, 0)
      assert.strictEqual(runtime.getSnapshot(), before)
      const preview = host.getSnapshot().preview
      activeSample.stage = 'confirm'
      // Explicit acceptance harness models the second, separate user confirmation.
      await host.callbacks.onConfirm(preview.planId)
      await host.callbacks.onConfirm(preview.planId)
      assert.equal(executions, 1); assert.equal(runtime.getSnapshot().revision, before.revision + 1)
      assert.deepEqual(runtime.getSnapshot().records, before.records)
      samples.push({ appId: activeAppId, event: 'project-opened', suggestionCount: reply.suggestions.length,
        accepted: { text: suggestion.text, reason: suggestion.reason, blockId: suggestion.blockId },
        preview, planDiagnostics: activeSample.planDiagnostics, beforeRevision: before.revision, afterRevision: runtime.getSnapshot().revision,
        executionsBeforeConfirm: 0, executionsAfterRepeatedConfirm: executions, recordsPreserved: true, passed: true })
      activeSample = null
      bridge.dispose(); bridge = null; host.dispose(); host = null
      // Server throttle is shared across project switches. No parallel calls or retries.
      if (example !== examples.at(-1)) await new Promise(r => setTimeout(r, 31_000))
    }
  } catch (error) {
    if (activeSample) {
      const { readExecutions, ...sample } = activeSample
      samples.push({ ...sample, passed: false, code: /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code || error.message) ? error.code || error.message : 'SAMPLE_FAILED', executions: readExecutions() })
    }
    throw error
  } finally {
    bridge?.dispose(); host?.dispose()
    const usage = audit()
    const reportDir = path.join(root, live ? 'docs/mochi-proactive-v1' : '.cache/mochi-proactive/offline-sample')
    fs.mkdirSync(reportDir, { recursive: true })
    fs.writeFileSync(path.join(reportDir, 'AI-USAGE.json'), JSON.stringify(usage,null,2)+'\n')
    const reportPath = path.join(reportDir, 'REAL-SAMPLES.json')
    const previous = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null
    const runs = previous?.runs ?? (previous ? [{ at: previous.at, samples: previous.samples }] : [])
    runs.push({ at: startedAt, samples })
    fs.writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), source: live ? 'deepseek' : 'offline-fixture', runs },null,2)+'\n')
    console.log(JSON.stringify({ usage, passedSamples: samples.filter(s => s.passed).length }))
    if (server) await new Promise(r => { server.closeAllConnections(); server.close(r) })
    ledger.close()
  }
}
main().catch(error => { console.error(JSON.stringify({ failed: true, code: /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code || error.message) ? error.code || error.message : 'SAMPLE_FAILED' })); process.exitCode = 1 })
