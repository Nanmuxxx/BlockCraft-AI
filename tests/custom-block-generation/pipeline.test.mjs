import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile, stat, chmod, symlink, lstat, open } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { createGenerator } from '../../server/custom-block/generator.mjs'
import { createPendingStore } from '../../server/custom-block/store.mjs'
import { admitOutput } from '../../server/custom-block/contract.mjs'
import { protocol, LIMITS } from '../../server/custom-block/protocol.mjs'
import { request, response, scenarios } from './fixtures.mjs'

globalThis.fetch = () => { throw new Error('TEST_NETWORK_FORBIDDEN') }
async function setup(t, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'blockcraft-inert-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, store: createPendingStore(directory, options) }
}
const mock = output => ({ kind: 'mock', generate: async () => JSON.stringify(output) })
const record = async () => ({ storageVersion: 1, status: 'pending-build', entry: await admitOutput(request(), JSON.stringify(response())), provenance: {
  kind: 'mock', requestId: 'request-1', requirementDigest: `sha256:${'a'.repeat(64)}`,
} })
const ref = entry => ({ definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest })

test('experiment is disabled by default before touching provider or store', async () => {
  let calls = 0
  const provider = { kind: 'mock', generate() { calls++; throw Error('must not call') } }
  await assert.rejects(createGenerator({ provider, store: { put() { calls++ } } }).generate(request()), { code: 'EXPERIMENT_DISABLED' })
  assert.equal(calls, 0)
})
test('three MOCK-only end-to-end inputs persist distinct inspectable pending artifacts with execution denied', async t => {
  const { store, directory } = await setup(t)
  const digests = new Set()
  for (const c of scenarios) {
    const result = await createGenerator({ enabled: true, provider: mock(c.output), store }).generate(c.request)
    digests.add(result.reference.versionDigest)
    assert.equal(result.provenance.kind, 'mock')
    assert.equal(result.status, 'pending-build')
    assert.equal(result.build, 'not-attempted')
    assert.equal(result.execution, 'denied')
    assert.equal(result.bcIntegration, 'not-connected')
    assert.equal(result.requirementsReview, 'not-performed')
    const saved = await store.inspect(result.reference)
    assert.deepEqual(saved.entry.artifact.sources, c.output.sources)
    assert.deepEqual((await protocol.resolveArtifact(store, result.reference)).artifact, saved.entry.artifact)
    assert.ok(!JSON.stringify(saved).includes(c.request.requirement))
  }
  assert.equal(digests.size, 3)
  for (const name of await readdir(directory)) {
    assert.match(name, /^[a-f0-9]{64}\.json$/)
    assert.equal((await stat(path.join(directory, name))).mode & 0o777, 0o600)
  }
})
test('invalid output never reaches storage, never evaluates source side effects', async t => {
  const { store, directory } = await setup(t)
  globalThis.__customBlockExecuted = false
  t.after(() => { delete globalThis.__customBlockExecuted })
  const o = response()
  o.sources['src/Component.tsx'] = 'globalThis.__customBlockExecuted=true; throw new Error("MUST NOT RUN");export default function C(){return null}'
  await createGenerator({ enabled: true, provider: mock(o), store }).generate(request())
  assert.equal(globalThis.__customBlockExecuted, false)
  const before = await readdir(directory)
  o.manifest.sdkVersion = 'unsupported'
  await assert.rejects(createGenerator({ enabled: true, provider: mock(o), store }).generate(request()))
  assert.deepEqual(await readdir(directory), before)
})
test('immutable storage is idempotent, retains first provenance and does not overwrite changed content', async t => {
  const { store, directory } = await setup(t)
  const input = await record()
  await store.put(input)
  const names = await readdir(directory)
  const before = await readFile(path.join(directory, names[0]), 'utf8')
  input.provenance.requestId = 'another-request'
  assert.equal((await store.put(input)).provenance.requestId, 'request-1')
  assert.equal(await readFile(path.join(directory, names[0]), 'utf8'), before)
  input.entry.artifact.sources['src/Component.tsx'] += '// corruption'
  await assert.rejects(store.put(input), { code: 'DIGEST_MISMATCH' })
  assert.equal(await readFile(path.join(directory, names[0]), 'utf8'), before)
})
test('read rejects tampering, mismatched reference, extra metadata, symlink and unknown status', async t => {
  const { store, directory } = await setup(t)
  const input = await record(); await store.put(input)
  const reference = ref(input.entry)
  const filename = path.join(directory, (await readdir(directory))[0])
  await assert.rejects(store.inspect({ ...reference, definitionId: 'other' }), { code: 'STORE_REFERENCE_MISMATCH' })
  for (const corrupt of [
    { ...input, status: 'runnable' }, { ...input, executionPermit: true },
    { ...input, entry: { ...input.entry, artifact: { ...input.entry.artifact, sources: { 'src/Component.tsx': 'tampered' } } } },
  ]) {
    await writeFile(filename, JSON.stringify(corrupt))
    await assert.rejects(store.inspect(reference))
  }
  await rm(filename)
  await symlink('/dev/null', filename)
  await assert.rejects(store.inspect(reference), { code: 'STORE_INVALID' })
})
test('private store permissions, quotas and references fail closed', async t => {
  const { store, directory } = await setup(t, { maxArtifacts: 1 })
  const input = await record(); await store.put(input)
  const o = response(); o.manifest.name = 'another version'
  const second = { ...input, entry: await admitOutput(request(), JSON.stringify(o)) }
  await assert.rejects(store.put(second), { code: 'STORE_QUOTA' })
  assert.equal(await store.inspect({ ...ref(input.entry), versionDigest: `sha256:${'0'.repeat(64)}` }), undefined)
  await assert.rejects(store.inspect({ definitionId: 'x', versionDigest: '../../escape' }))
  let read = false
  const accessor = { versionDigest: input.entry.versionDigest, get definitionId() { read = true; return 'new-component' } }
  await assert.rejects(store.inspect(accessor))
  assert.equal(read, false)
  await chmod(directory, 0o755)
  await assert.rejects(store.put(input), { code: 'STORE_PRIVATE_DIRECTORY_REQUIRED' })
})

test('store reads the complete immutable record when the filesystem returns short reads', async t => {
  const { store, directory } = await setup(t), input = await record()
  await store.put(input)
  const handle = await open(path.join(directory, (await readdir(directory))[0]), 'r')
  const prototype = Object.getPrototypeOf(handle), original = prototype.read
  await handle.close()
  // Short successful reads are allowed by the filesystem API, even before EOF.
  t.mock.method(prototype, 'read', function(buffer, offset, length, position) {
    return original.call(this, buffer, offset, Math.min(length, 31), position)
  })
  assert.deepEqual(await store.inspect(ref(input.entry)), input)
})

test('a valid JSON prefix cannot hide unread trailing bytes in a stored record', async t => {
  const { store, directory } = await setup(t), input = await record()
  await store.put(input)
  const filename = path.join(directory, (await readdir(directory))[0])
  const prefix = JSON.stringify(input)
  await writeFile(filename, prefix + '\nUNTRUSTED TRAILING BYTES')
  const handle = await open(filename, 'r'), prototype = Object.getPrototypeOf(handle), original = prototype.read
  await handle.close()
  t.mock.method(prototype, 'read', function(buffer, offset, length, position) {
    return original.call(this, buffer, offset, Math.min(length, Buffer.byteLength(prefix)), position)
  })
  await assert.rejects(store.inspect(ref(input.entry)), { code: 'STORE_INVALID' })
})

test('store accepts the exact byte limit but rejects growth after its initial file stat', async t => {
  const { store, directory } = await setup(t), input = await record()
  await store.put(input)
  const filename = path.join(directory, (await readdir(directory))[0]), prefix = JSON.stringify(input)
  const bounded = prefix + ' '.repeat(LIMITS.storeBytes - Buffer.byteLength(prefix))
  await writeFile(filename, bounded)
  assert.deepEqual(await store.inspect(ref(input.entry)), input)
  const handle = await open(filename, 'r'), prototype = Object.getPrototypeOf(handle), original = prototype.stat
  await handle.close()
  t.mock.method(prototype, 'stat', async function(...args) {
    const snapshot = await original.apply(this, args)
    await writeFile(filename, bounded + ' ')
    return snapshot
  })
  await assert.rejects(store.inspect(ref(input.entry)), { code: 'STORE_LIMIT' })
})
test('caller mutation cannot change the artifact snapshot during asynchronous hashing', async t => {
  const { store } = await setup(t)
  const input = await record(), reference = ref(input.entry)
  const pending = store.put(input)
  input.entry.artifact.manifest.name = 'late mutation'
  input.provenance.requestId = 'late-request'
  await pending
  const saved = await store.inspect(reference)
  assert.equal(saved.provenance.requestId, 'request-1')
  assert.equal(saved.entry.artifact.manifest.name, 'Mock 源码样本')
})
test('generator rejects concurrent work, recovers after provider failure and redacts unknown errors', async t => {
  const { store } = await setup(t)
  let finish, calls = 0
  const provider = { kind: 'mock', generate() { calls++; return new Promise(resolve => { finish = resolve }) } }
  const generator = createGenerator({ enabled: true, provider, store })
  const first = generator.generate(request())
  await assert.rejects(generator.generate(request()), { code: 'GENERATOR_BUSY' })
  finish(JSON.stringify(response())); await first
  assert.equal(calls, 1)
  const failed = createGenerator({ enabled: true, provider: { kind: 'mock', async generate() { throw Error('sensitive upstream text') } }, store })
  for (let i = 0; i < 2; i++) await assert.rejects(failed.generate(request()), { message: 'PROVIDER_FAILED' })
})
test('all JSON files are inert source artifacts, not generated source module files', async t => {
  const { store, directory } = await setup(t)
  await store.put(await record())
  const content = JSON.parse(await readFile(path.join(directory, (await readdir(directory))[0]), 'utf8'))
  assert.equal(content.entry.artifact.artifactVersion, 1)
  assert.equal(content.status, 'pending-build')
  assert.equal((await readdir(directory)).some(p => /\.(tsx?|jsx?)$/.test(p)), false)
})

test('caller cancellation retires ignored provider work before any pending-store write', { timeout: 1000 }, async () => {
  let rejectOld, calls = 0, puts = 0, oldSignal
  const provider = { kind: 'mock', generate(_request, { signal } = {}) {
    calls++; oldSignal = signal
    return calls === 1 ? new Promise((_, reject) => { rejectOld = reject }) : JSON.stringify(response())
  } }
  const store = { async put(record) { puts++; return record } }
  const generator = createGenerator({ enabled: true, provider, store })
  const controller = new AbortController()
  const old = generator.generate(request(), { signal: controller.signal })
  const rejected = assert.rejects(old, { code: 'CANCELLED' })
  controller.abort(); await rejected
  assert.equal(oldSignal.aborted, true); assert.equal(puts, 0)
  const fresh = await generator.generate(request())
  assert.equal(fresh.execution, 'denied'); assert.equal(puts, 1)
  rejectOld(Error('late provider secret')); await new Promise(resolve => setImmediate(resolve))
  assert.equal(puts, 1)
})

test('pre-cancelled generator performs no provider or storage calls', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort()
  const generator = createGenerator({ enabled: true, provider: { kind: 'mock', generate() { calls++; return '{}' } }, store: { put() { calls++ } } })
  await assert.rejects(generator.generate(request(), { signal: controller.signal }), { code: 'CANCELLED' })
  assert.equal(calls, 0)
})

test('cancellation during output admission prevents storage; admitted storage retains an honest outcome', async () => {
  const controller = new AbortController(); let puts = 0
  const provider = { kind: 'mock', generate() { queueMicrotask(() => controller.abort()); return JSON.stringify(response()) } }
  const generator = createGenerator({ enabled: true, provider, store: { put() { puts++; throw Error('must not store') } } })
  await assert.rejects(generator.generate(request(), { signal: controller.signal }), { code: 'CANCELLED' }); assert.equal(puts, 0)
  const next = new AbortController()
  const committed = createGenerator({ enabled: true, provider: mock(response()), store: { async put(record) { next.abort(); return record } } })
  assert.equal((await committed.generate(request(), { signal: next.signal })).status, 'pending-build')
})

test('syntax admission is not sandbox certification: hazardous source stays inert and execution denied', async t => {
  const { store } = await setup(t)
  globalThis.__sourceAdmissionExecuted = false
  t.after(() => { delete globalThis.__sourceAdmissionExecuted })
  const candidate = response()
  candidate.sources['src/Component.tsx'] = `globalThis.__sourceAdmissionExecuted = true;
export default function HazardousAdmissionFixture() {
  // These browser operations are data in this test. Never mount this fixture.
  fetch('https://must-never-be-requested.invalid/');
  document.body.textContent = 'must never mutate';
  while (true) {}
  return <div dangerouslySetInnerHTML={{__html: '<script>never</script>'}} />;
}`
  const receipt = await createGenerator({ enabled: true, provider: mock(candidate), store }).generate(request())
  assert.equal(receipt.validation, 'source-admitted')
  assert.equal(receipt.build, 'not-attempted'); assert.equal(receipt.execution, 'denied')
  assert.equal(receipt.requirementsReview, 'not-performed')
  assert.equal(globalThis.__sourceAdmissionExecuted, false)
  const saved = await store.inspect(receipt.reference)
  assert.equal(saved.entry.artifact.sources['src/Component.tsx'], candidate.sources['src/Component.tsx'])
})

test('independent store handles cannot race distinct artifacts past the shared directory quota', async t => {
  const { store, directory } = await setup(t, { maxArtifacts: 1 })
  const secondStore = createPendingStore(directory, { maxArtifacts: 1 })
  const first = await record(), second = await record(), output = response()
  output.manifest.name = '另一个独立版本'
  second.entry = await admitOutput(request(), JSON.stringify(output))
  const outcomes = await Promise.allSettled([store.put(first), secondStore.put(second)])
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  const rejection = outcomes.find(result => result.status === 'rejected')
  assert.ok(['STORE_BUSY', 'STORE_QUOTA'].includes(rejection.reason.code))
  const files = await readdir(directory)
  assert.equal(files.length, 1); assert.match(files[0], /^[a-f0-9]{64}\.json$/)
  const winner = outcomes.find(result => result.status === 'fulfilled').value
  assert.deepEqual(await store.inspect(ref(winner.entry)), winner)
  // An immutable existing version remains reusable even when the quota is full.
  assert.deepEqual(await secondStore.put(winner), winner)
})

test('unknown or stale store lease fails closed, remains intact, and is never followed', async t => {
  const { store, directory } = await setup(t, { maxArtifacts: 1 }), input = await record()
  const lease = path.join(directory, '.write-lock')
  await mkdir(lease, { mode: 0o700 }); await writeFile(path.join(lease, 'owner-evidence'), 'do not delete')
  await assert.rejects(store.put(input), { code: 'STORE_BUSY' })
  assert.equal(await readFile(path.join(lease, 'owner-evidence'), 'utf8'), 'do not delete')
  assert.equal(await store.inspect(ref(input.entry)), undefined)
  // Only this test owns/removes its fixture lease. Production does no recovery.
  await rm(lease, { recursive: true }); await symlink('/dev/null', lease)
  await assert.rejects(store.put(input), { code: 'STORE_BUSY' })
  assert.equal((await lstat(lease)).isSymbolicLink(), true)
  await rm(lease); await store.put(input)
  assert.deepEqual(await readdir(directory), [`${input.entry.versionDigest.slice(7)}.json`])
  const other = await record(), output = response(); output.manifest.name = 'quota rejected'
  other.entry = await admitOutput(request(), JSON.stringify(output))
  await assert.rejects(store.put(other), { code: 'STORE_QUOTA' })
  assert.deepEqual(await readdir(directory), [`${input.entry.versionDigest.slice(7)}.json`])
})

test('separate node processes share the same bounded store write lease', { timeout: 5000 }, async t => {
  const { store, directory } = await setup(t, { maxArtifacts: 1 })
  const inputs = [await record(), await record()], output = response(); output.manifest.name = 'cross-process second version'
  inputs[1].entry = await admitOutput(request(), JSON.stringify(output))
  // Execute trusted store code only; candidate TSX remains JSON data on stdin/IPC.
  const script = `import { createPendingStore } from ${JSON.stringify(new URL('../../server/custom-block/store.mjs', import.meta.url).href)};
process.send({ready:true}); process.once('message',async ({directory,record})=>{
 try { await createPendingStore(directory,{maxArtifacts:1}).put(record); process.send({ok:true}); }
 catch(error) { process.send({ok:false,code:error.code}); }
 process.disconnect();
});`
  const children = inputs.map(() => spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }))
  t.after(() => children.forEach(child => { if (child.exitCode === null) child.kill() }))
  const ready = children.map(child => new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject) }))
  await Promise.all(ready)
  const outcomes = children.map(child => new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject) }))
  children.forEach((child, index) => child.send({ directory, record: inputs[index] }))
  const results = await Promise.all(outcomes)
  assert.equal(results.filter(result => result.ok).length, 1)
  assert.ok(['STORE_BUSY', 'STORE_QUOTA'].includes(results.find(result => !result.ok).code))
  assert.equal((await readdir(directory)).length, 1)
  const saved = await Promise.all(inputs.map(input => store.inspect(ref(input.entry))))
  assert.equal(saved.filter(Boolean).length, 1)
})
