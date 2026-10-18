import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { protocol, json } from '../../server/custom-block/protocol.mjs'
import { validateRecord } from '../../server/custom-block/store.mjs'
import { trustedReference } from './trusted-samples.mjs'
import { validateBuildEntry, verifyBundle, demand, canonicalDigest } from './policy.mjs'

const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
const clone = value => structuredClone(value)
const block = 'ISOLATION_UNVERIFIED'

/** Wall-clock/log bounds for trusted compilation, NOT a resource or security sandbox. */
function compileFixture(name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=256', worker, name], {
      cwd: fileURLToPath(new URL('.', import.meta.url)), detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'C', NODE_ENV: 'production' },
    })
    let output = [], bytes = 0, errorBytes = 0, failure
    function stop(code) {
      if (failure) return
      failure = code
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
    }
    const timer = setTimeout(() => stop('BUILD_TIMEOUT'), 20000)
    child.stdout.on('data', data => { bytes += data.length; if (bytes > 1048576) stop('BUILD_OUTPUT_LIMIT'); else output.push(data) })
    child.stderr.on('data', data => { errorBytes += data.length; if (errorBytes > 8192) stop('BUILD_OUTPUT_LIMIT') })
    child.on('error', () => { clearTimeout(timer); reject(new Error('BUILD_PROCESS_FAILED')) })
    child.on('close', code => {
      clearTimeout(timer)
      if (failure || code !== 0) return reject(new Error(failure ?? 'BUILD_PROCESS_FAILED'))
      try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))) } catch { reject(new Error('BUILD_OUTPUT_INVALID')) }
    })
  })
}

/** In-process trusted controller API only; no HTTP server and no source execution. */
export function createBuildService({ store }) {
  demand(store && typeof store.inspect === 'function', 'PENDING_STORE_REQUIRED')
  const jobs = new Map(), outputs = new Map(), inflight = new Map()
  let busy = false
  function status(jobId) { return clone(jobs.get(jobId) ?? null) }
  async function build(raw) {
    protocol.assertJson(raw); json.object(raw); json.keys(raw, ['contractVersion', 'reference'])
    demand(raw.contractVersion === 1, 'BUILD_REQUEST_VERSION')
    protocol.assertArtifactReference(raw.reference)
    const reference = clone(raw.reference)
    const jobId = `build-${reference.versionDigest.slice(7)}`
    const existing = jobs.get(jobId)
    if (existing) demand(existing.reference.definitionId === reference.definitionId, 'BUILD_REFERENCE_MISMATCH')
    if (inflight.has(jobId)) return inflight.get(jobId)
    if (existing) return status(jobId)
    demand(jobs.size < 64, 'BUILD_QUEUE_LIMIT')
    const initial = { contractVersion: 1, jobId, reference, status: 'checking', execution: 'denied' }
    jobs.set(jobId, initial)
    const operation = (async () => {
      try {
        // Reject unknown content BEFORE resolving/parsing source or invoking any compiler.
        const trusted = await trustedReference(reference)
        if (!trusted) {
          jobs.set(jobId, { ...initial, status: 'blocked', code: block })
          return status(jobId)
        }
        demand(!busy, 'BUILD_BUSY')
        busy = true
        try {
          const rawRecord = await store.inspect(reference)
          demand(rawRecord, 'PENDING_ARTIFACT_MISSING')
          const record = await validateRecord(rawRecord)
          const entry = await validateBuildEntry(record.entry, reference)
          demand(canonicalDigest(entry) === canonicalDigest(trusted), 'TRUSTED_CONTENT_MISMATCH')
          jobs.set(jobId, { ...initial, status: 'compiling' })
          const name = reference.definitionId.slice('trusted-'.length)
          const result = await compileFixture(name)
          const bundle = Buffer.from(result.bundle, 'base64')
          verifyBundle(result.receipt, bundle)
          demand(canonicalDigest(result.receipt.reference) === canonicalDigest(reference), 'BUILD_REFERENCE_MISMATCH')
          outputs.set(jobId, { receipt: clone(result.receipt), bundle })
          jobs.set(jobId, { ...initial, status: 'compiled', receipt: result.receipt })
        } finally { busy = false }
      } catch {
        // Source/compiler diagnostics are not reflected to clients or rendered as HTML.
        jobs.set(jobId, { ...initial, status: 'failed', code: 'BUILD_REJECTED' })
      }
      return status(jobId)
    })()
    inflight.set(jobId, operation)
    try { return await operation } finally { inflight.delete(jobId) }
  }
  return Object.freeze({
    build, status,
    inspectCompiled(jobId) {
      const result = outputs.get(jobId)
      if (!result) return null
      verifyBundle(result.receipt, result.bundle)
      return { receipt: clone(result.receipt), bundle: Buffer.from(result.bundle) }
    },
    createViewer(raw) {
      protocol.assertJson(raw); json.object(raw); json.keys(raw, ['contractVersion', 'jobId', 'instanceId', 'reference'])
      demand(raw.contractVersion === 1 && typeof raw.jobId === 'string', 'VIEWER_REQUEST')
      json.id(raw.instanceId); protocol.assertArtifactReference(raw.reference)
      const job = jobs.get(raw.jobId)
      demand(job && canonicalDigest(job.reference) === canonicalDigest(raw.reference), 'VIEWER_REFERENCE_MISMATCH')
      // No caller-supplied proof, boolean, provider or compiled receipt can mint a session.
      return { contractVersion: 1, status: 'blocked', code: block, execution: 'denied',
        instanceId: raw.instanceId, reference: clone(raw.reference) }
    },
  })
}
