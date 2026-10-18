// Fixed offline developer validation. No path/source/provider/model arguments.
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { createPendingStore } from '../../server/custom-block/store.mjs'
import { createBuildService } from './service.mjs'
import { trustedSample } from './trusted-samples.mjs'
import { sha256, verifyBundle } from './policy.mjs'

if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_SUPPORTED')
const directory = await mkdtemp(path.join(tmpdir(), 'blockcraft-trusted-build-'))
const output = fileURLToPath(new URL('./.artifacts/', import.meta.url))
try {
  const store = createPendingStore(directory)
  const service = createBuildService({ store })
  const evidence = []
  await mkdir(output, { recursive: true, mode: 0o700 })
  for (const name of ['counter', 'temperature']) {
    const entry = await trustedSample(name)
    const reference = { definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest }
    await store.put({ storageVersion: 1, status: 'pending-build', entry,
      provenance: { kind: 'mock', requestId: `developer-${name}`, requirementDigest: sha256(`developer-fixture:${name}`) } })
    const started = performance.now()
    const job = await service.build({ contractVersion: 1, reference })
    if (job.status !== 'compiled') throw new Error('TRUSTED_BUILD_NOT_COMPILED')
    const { receipt, bundle } = service.inspectCompiled(job.jobId)
    verifyBundle(receipt, bundle)
    const viewer = service.createViewer({ contractVersion: 1, jobId: job.jobId, instanceId: `review-${name}`, reference })
    // Private offline audit files. Never served or loaded by the main app/Node.
    await writeFile(path.join(output, `${name}.mjs`), bundle, { mode: 0o600 })
    await writeFile(path.join(output, `${name}.receipt.json`), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
    evidence.push({ name, durationMs: Math.round(performance.now() - started), ...receipt, viewer })
    if ((await store.inspect(reference)).status !== 'pending-build') throw new Error('SOURCE_STORE_CHANGED')
  }
  const summary = { observedAt: new Date().toISOString(), node: process.version,
    compiledOnly: true, componentExecutionAttempted: false, evidence }
  await writeFile(path.join(output, 'validation.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 })
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
} finally { await rm(directory, { recursive: true, force: true }) }
