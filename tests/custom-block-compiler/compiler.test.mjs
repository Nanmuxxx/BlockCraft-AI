import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { protocol } from '../../server/custom-block/protocol.mjs'
import { createPendingStore } from '../../server/custom-block/store.mjs'
import { trustedSample } from '../../tools/custom-block-compiler/trusted-samples.mjs'
import { createBuildService } from '../../tools/custom-block-compiler/service.mjs'
import { validateBuildEntry, verifyBundle, sha256, canonicalDigest } from '../../tools/custom-block-compiler/policy.mjs'
import { verifySupply } from '../../tools/custom-block-compiler/supply.mjs'
import { requireVerifiedBackend } from '../../tools/custom-block-compiler/isolation.mjs'

const referenceOf = entry => ({ definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest })
const request = entry => ({ contractVersion: 1, reference: referenceOf(entry) })
const recordOf = entry => ({ storageVersion: 1, status: 'pending-build', entry,
  provenance: { kind: 'mock', requestId: 'developer-check', requirementDigest: sha256('developer-check') } })
async function changed(change) {
  const entry = structuredClone(await trustedSample('counter'))
  change(entry.artifact)
  entry.versionDigest = await protocol.computeVersionDigest(entry.artifact)
  return entry
}

test('unknown pending source is blocked before the store or compiler can consume it', async () => {
  let reads = 0
  const service = createBuildService({ store: { inspect() { reads++; throw new Error('must not read') } } })
  const entry = await changed(a => { a.sources['Counter.tsx'] += '\n// outside trusted catalogue' })
  const result = await service.build(request(entry))
  assert.equal(result.status, 'blocked')
  assert.equal(result.code, 'ISOLATION_UNVERIFIED')
  assert.equal(reads, 0)
  assert.equal(service.inspectCompiled(result.jobId), null)
})

test('caller cannot supply trust, a compiler, npm options, scripts or an isolation attestation', async () => {
  const service = createBuildService({ store: { inspect() { throw new Error('unreachable') } } })
  const entry = await trustedSample('counter')
  for (const key of ['trusted', 'sandboxVerified', 'provider', 'npm', 'scripts', 'plugins', 'executionPermit']) {
    await assert.rejects(service.build({ ...request(entry), [key]: true }))
  }
})

test('same digest cannot be confused with another definition ID', async () => {
  const entry = await trustedSample('counter')
  const service = createBuildService({ store: { inspect: async () => undefined } })
  await service.build(request(entry))
  await assert.rejects(service.build({ contractVersion: 1, reference: { ...referenceOf(entry), definitionId: 'other' } }))
})

test('missing pending record and a self-promoted runnable record fail closed', async () => {
  const entry = await trustedSample('counter')
  for (const record of [undefined, { ...recordOf(entry), status: 'runnable', executionPermit: true }]) {
    const service = createBuildService({ store: { inspect: async () => record } })
    assert.equal((await service.build(request(entry))).status, 'failed')
  }
})

test('stale source digest is rejected independently of claimed provenance', async () => {
  const entry = structuredClone(await trustedSample('counter'))
  entry.artifact.sources['Counter.tsx'] += '\n// corruption'
  await assert.rejects(validateBuildEntry(entry, referenceOf(entry)))
})

test('a well-formed but incorrect dependency SRI is rejected', async () => {
  const entry = await changed(a => { a.dependencies.react.integrity = 'sha512-' + 'A'.repeat(86) + '==' })
  await assert.rejects(validateBuildEntry(entry, referenceOf(entry)), /DEPENDENCY_BYTES_MISMATCH/)
})

test('artifact cannot alter compiler version, package list, build scripts or file types', async () => {
  for (const mutate of [
    a => { a.build.toolchain.version = '0.26.0' },
    a => { a.dependencies.lodash = structuredClone(a.dependencies.react) },
    a => { a.scripts = { build: 'node arbitrary.js' } },
    a => { a.sources['package.json'] = '{}' },
  ]) {
    await assert.rejects(async () => {
      const entry = await changed(mutate)
      await validateBuildEntry(entry, referenceOf(entry))
    })
  }
})

test('fixed resolver admission rejects URL, npm, host path, dynamic import, require and config escape', async () => {
  // Hand-authored negative syntax inputs; parsed only, never compiled or executed.
  for (const source of [
    'import x from "https://example.invalid/x.js"; export default () => x',
    'import x from "lodash"; export default () => x',
    'import x from "node:fs"; export default () => x',
    'import x from "../../host"; export default () => x',
    'export default () => import("react")',
    'export default () => require("react")',
    'export default () => (0,eval)("1")',
  ]) {
    const entry = await changed(a => { a.sources['Counter.tsx'] = source })
    await assert.rejects(validateBuildEntry(entry, referenceOf(entry)))
  }
})

test('fixed worker has no arbitrary source/path/options entry point', () => {
  const worker = fileURLToPath(new URL('../../tools/custom-block-compiler/worker.mjs', import.meta.url))
  const child = spawnSync(process.execPath, [worker, '/tmp/untrusted.tsx'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(child.status, 1)
  assert.equal(child.stdout, '')
  assert.equal(child.stderr, 'TRUSTED_BUILD_FAILED\n')
})

test('even a forged successful backend inventory cannot grant execution', () => {
  assert.throws(() => requireVerifiedBackend({ status: 'verified', mayExecuteUntrustedCode: true }), { code: 'ISOLATION_UNVERIFIED' })
})

test('actual packages and compiler bytes match the pinned archives; tampering is detected', async () => {
  const before = await verifySupply()
  assert.equal(before.packages.length, 6)
  const file = new URL('../../tools/custom-block-compiler/node_modules/react/README.md', import.meta.url)
  const original = await readFile(file)
  try {
    await writeFile(file, Buffer.concat([original, Buffer.from('\nmodified')]))
    await assert.rejects(verifySupply())
  } finally { await writeFile(file, original) }
  assert.equal(canonicalDigest(await verifySupply()), canonicalDigest(before))
})

test('two genuine trusted React builds, deterministic repeat, integrity checks and Viewer refusal', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'blockcraft-compiler-test-'))
  try {
    const store = createPendingStore(directory)
    const service = createBuildService({ store })
    const results = []
    for (const name of ['counter', 'temperature']) {
      const entry = await trustedSample(name)
      await store.put(recordOf(entry))
      const firstRequest = request(entry)
      const building = service.build(firstRequest)
      const duplicate = service.build(request(entry))
      await assert.rejects(service.build({ contractVersion: 1, reference: { ...referenceOf(entry), definitionId: 'other-concurrent-instance' } }))
      firstRequest.reference.definitionId = 'changed-by-caller'
      const job = await building
      assert.equal(job.status, 'compiled')
      assert.deepEqual(await duplicate, job)
      assert.equal(job.execution, 'denied')
      const compiled = service.inspectCompiled(job.jobId)
      assert.equal(verifyBundle(compiled.receipt, compiled.bundle), true)
      assert.equal(compiled.receipt.sourcesDigest, canonicalDigest(entry.artifact.sources))
      assert.equal(compiled.receipt.sourceDigest, entry.versionDigest)
      assert.ok(compiled.bundle.length > 100000)
      const tampered = Buffer.from(compiled.bundle); tampered[0] ^= 1
      assert.throws(() => verifyBundle(compiled.receipt, tampered), /BUNDLE_DIGEST_MISMATCH/)
      const wrongSize = Buffer.concat([compiled.bundle, Buffer.from('x')])
      assert.throws(() => verifyBundle(compiled.receipt, wrongSize), /BUNDLE_SIZE/)
      compiled.bundle[0] ^= 1
      assert.equal(verifyBundle(service.inspectCompiled(job.jobId).receipt, service.inspectCompiled(job.jobId).bundle), true)
      const status = service.status(job.jobId); status.execution = 'allowed'
      assert.equal(service.status(job.jobId).execution, 'denied')
      const viewerRequest = { contractVersion: 1, jobId: job.jobId, instanceId: 'test-instance', reference: referenceOf(entry) }
      const viewer = service.createViewer(viewerRequest)
      assert.equal(viewer.status, 'blocked')
      assert.equal(viewer.code, 'ISOLATION_UNVERIFIED')
      assert.equal(Object.hasOwn(viewer, 'url'), false)
      assert.throws(() => service.createViewer({ ...viewerRequest, verified: true }))
      assert.throws(() => service.createViewer({ ...viewerRequest, reference: { ...viewerRequest.reference, definitionId: 'other' } }))
      assert.equal((await store.inspect(referenceOf(entry))).status, 'pending-build')
      results.push(job)
    }
    assert.notEqual(results[0].receipt.bundleDigest, results[1].receipt.bundleDigest)
    assert.notEqual(results[0].receipt.sourceDigest, results[1].receipt.sourceDigest)
    // New controller means a real new compile, not reuse of an in-memory job/cache.
    const repeat = await createBuildService({ store }).build(request(await trustedSample('counter')))
    assert.equal(repeat.receipt.bundleDigest, results[0].receipt.bundleDigest)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
