// Imported only by the acceptance runner in isolated browser contexts.
import { createAppRuntime } from '../../src/model/appRuntime.ts'
import { createClubRegistrationExample } from '../../src/model/appSpecExamples.ts'
import { createGalleryPractice, offlineImageProvider } from '../../src/integrations/gallery-generation/offline.ts'
import { createGalleryImageController } from '../../src/integrations/gallery-generation/controller.ts'
import { createMockImageAdapter, fixedMockImageSource, mockImageProvider } from '../../src/integrations/gallery-generation/mock.ts'
import { createWorkspaceSession, restoreWorkspace } from '../../src/integrations/project-workspace/session.ts'
import { workspaceRepository, createWorkspaceRepository } from '../../src/integrations/project-workspace/repository.ts'
import { createProjectJson, serializeProjectJson, parseProjectJsonText, PROJECT_JSON_MAX_BYTES } from '../../src/integrations/project-json/format.ts'
import { createProjectPackage, parseProjectPackage } from '../../src/integrations/project-package/format.ts'
import { encodePackageZip, decodePackageZip, PACKAGE_LIMITS } from '../../src/integrations/project-package/zip.ts'
import { listProjectBackups, readProjectBackup } from '../../src/integrations/project-json/backups.ts'

function check(condition, message = 'Assertion failed') { if (!condition) throw new Error(message) }
function equal(actual, expected, message = 'Snapshots differ') { check(JSON.stringify(actual) === JSON.stringify(expected), message) }
async function rejects(work, code) {
  try { await work() } catch (error) { if (code) check(error.code === code, `Expected ${code}, got ${error.code}: ${error.message}`); return { code: error.code || error.name, message: error.message } }
  throw new Error('Expected rejection')
}
const png = () => offlineImageProvider.generate('offline acceptance', new AbortController().signal)
async function fixture(options = {}) {
  const stored = await workspaceRepository.read()
  const runtime = createAppRuntime(options.state || createGalleryPractice())
  const workspace = createWorkspaceSession(runtime, { sequence: stored?.sequence || 0, ...options })
  const controller = createGalleryImageController(workspace, options.provider, options.timeout || 10000, options.source)
  return { runtime, workspace, controller, snapshot: () => runtime.customProject.getSnapshot(),
    close() { controller.dispose(); workspace.dispose() } }
}
async function ready(f) {
  await f.controller.generate('single offline candidate', 'practice-gallery')
  check(f.controller.getSnapshot().phase === 'ready', f.controller.getSnapshot().message)
  return f.controller.getSnapshot().candidate
}
function asset(id, dataUrl) { return { id, name: 'offline.png', mimeType: 'image/png', dataUrl } }
function crc(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0) }
  return (c ^ 0xffffffff) >>> 0
}
async function sizedPng(size) {
  const source = Uint8Array.from(atob((await png()).split(',')[1]), c => c.charCodeAt(0))
  check(size >= source.length + 12)
  const chunk = new Uint8Array(size - source.length), view = new DataView(chunk.buffer)
  view.setUint32(0, chunk.length - 12); chunk.set(new TextEncoder().encode('npAD'), 4)
  view.setUint32(chunk.length - 4, crc(chunk.slice(4, -4)))
  const result = new Uint8Array(size)
  result.set(source.slice(0, -12)); result.set(chunk, source.length - 12); result.set(source.slice(-12), size - 12)
  let encoded = ''; for (let offset = 0; offset < result.length; offset += 8192) encoded += String.fromCharCode(...result.slice(offset, offset + 8192))
  return `data:image/png;base64,${btoa(encoded)}`
}

export async function failures() {
  const results = []
  const invalidPng = 'data:image/png;base64,' + btoa('invalid png bytes')
  const undecodable = new Uint8Array(45)
  undecodable.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  new DataView(undecodable.buffer).setUint32(16, 320); new DataView(undecodable.buffer).setUint32(20, 240)
  for (const [stage, provider] of [
    ['provider', { generate: async () => { throw new Error('offline provider failure') } }],
    ['retrieval', { generate: async () => { throw new Error('offline bytes unavailable') } }],
    ['format', { generate: async () => 'data:image/svg+xml,<svg/>' }],
    ['signature', { generate: async () => invalidPng }],
    ['native decode', { generate: async () => 'data:image/png;base64,' + btoa(String.fromCharCode(...undecodable)) }],
    ['byte capacity', { generate: async () => 'data:image/png;base64,' + 'A'.repeat(699101) }],
  ]) {
    let calls = 0
    const f = await fixture({ provider: { generate: (...args) => { calls++; return provider.generate(...args) } } })
    await f.workspace.save()
    const before = f.snapshot(), stored = await workspaceRepository.read()
    await f.controller.generate('fail safely', 'practice-gallery')
    check(f.controller.getSnapshot().phase === 'failed', stage)
    equal(f.snapshot(), before); equal(await workspaceRepository.read(), stored); check(calls === 1)
    results.push({ stage, calls, message: f.controller.getSnapshot().message, oldHeadPreserved: true }); f.close()
  }
  return { results, providerBilling: 'NOT RUN: offline canvas, no reservation or live provider' }
}

export async function storageFailures() {
  const cases = []
  for (const mode of ['quota', 'abort', 'activation']) {
    let armed = false
    const repository = mode === 'activation' ? workspaceRepository : createWorkspaceRepository({ beforeWrite() {
      if (armed) throw new DOMException(mode === 'quota' ? 'quota injected' : 'abort injected', mode === 'quota' ? 'QuotaExceededError' : 'AbortError')
    } })
    const f = await fixture({ repository, beforePublish() { if (armed && mode === 'activation') throw new Error('activation injected') } })
    await f.workspace.save()
    const before = f.snapshot(), oldSaved = await workspaceRepository.read(), candidate = await ready(f)
    armed = true; await f.controller.confirm()
    check(f.controller.getSnapshot().phase === 'failed'); equal(f.snapshot(), before)
    const saved = await workspaceRepository.read()
    if (mode === 'activation') {
      check(f.workspace.getSnapshot().recovery, 'Durable activation failure must require recovery')
      equal((await restoreWorkspace(saved)).project, candidate.prepared)
      check(saved.sequence === oldSaved.sequence + 1 && saved.receipts.length === 1)
    } else {
      equal(saved, oldSaved); check(!f.workspace.getSnapshot().recovery)
      armed = false; await f.controller.confirm()
      check(f.controller.getSnapshot().phase === 'adopted', f.controller.getSnapshot().message)
      check(f.snapshot().revision === before.revision + 1)
    }
    cases.push({ mode, oldRuntimePreserved: true, savedHead: saved.sequence, recovery: f.workspace.getSnapshot().recovery }); f.close()
  }
  return cases
}

export async function duplicates() {
  let calls = 0
  const f = await fixture({ provider: { generate(...args) { calls++; return offlineImageProvider.generate(...args) } } })
  const candidate = await ready(f)
  await Promise.all([f.controller.confirm(), f.controller.confirm(), f.controller.confirm()])
  const saved = await workspaceRepository.read()
  check(saved.receipts.length === 1 && f.snapshot().revision === 1 && calls === 1)
  await f.controller.confirm(); equal(await workspaceRepository.read(), saved)
  const restored = await restoreWorkspace(saved)
  const runtime = createAppRuntime(restored.base, restored.artifacts, restored.project)
  const workspace = createWorkspaceSession(runtime, { sequence: saved.sequence, workspaceId: saved.workspaceId, saved })
  const receipt = saved.receipts[0]
  const duplicate = await workspace.adopt(candidate.prepared, runtime.customProject.getSnapshot(), runtime.customProject.getAuthorization(), receipt)
  check(duplicate.duplicate); equal(await workspaceRepository.read(), saved)
  workspace.dispose(); f.close()
  const lost = await fixture({ repository: { read: workspaceRepository.read, async save(...args) {
    const result = await workspaceRepository.save(...args)
    if (args[0].receipt) throw new Error('injected confirmation response loss after commit')
    return result
  } } })
  await lost.workspace.save(); const original = lost.snapshot(); await ready(lost)
  await lost.controller.confirm()
  equal(lost.snapshot(), original)
  const committed = await workspaceRepository.read()
  check(committed.receipts.length === 1)
  check(lost.workspace.getSnapshot().recovery, 'Lost confirmation response must query the saved receipt and require recovery')
  await lost.controller.confirm()
  equal(await workspaceRepository.read(), committed)
  check(lost.controller.getSnapshot().phase !== 'adopted', 'Do not claim UI adoption while recovery is required')
  equal((await restoreWorkspace(committed)).project.base.assets, JSON.parse(committed.text).project.base.assets)
  lost.close()
  let unreadable = false
  const uncertain = await fixture({ repository: {
    async read() { if (unreadable) throw new Error('injected reconciliation read failure'); return workspaceRepository.read() },
    async save(...args) { await workspaceRepository.save(...args); unreadable = true; throw new Error('injected completion loss') },
  } })
  await ready(uncertain); await uncertain.controller.confirm()
  check(uncertain.workspace.getSnapshot().recovery)
  check(uncertain.workspace.getSnapshot().error.includes('暂无法确认'))
  const uncertainSaved = await workspaceRepository.read()
  await uncertain.controller.confirm(); equal(await workspaceRepository.read(), uncertainSaved)
  uncertain.close()
  return { concurrentConfirmations: 3, imageProviderCalls: calls, adoptionReceipts: 1, refreshedRetryDuplicate: true, lostResponseRecovered: true, unknownOutcomeBlocksRetry: true }
}

export async function staleCandidates() {
  const cases = []
  for (const mode of ['edit', 'delete gallery', 'replace workspace', 'revoke and regrant']) {
    const f = await fixture(); await f.workspace.save(); await ready(f)
    if (mode === 'edit' || mode === 'delete gallery') {
      const snapshot = f.runtime.getSnapshot()
      const command = mode === 'edit' ? { type: 'configureGallery', blockId: 'practice-gallery', imageIds: [], layout: 'grid' } : { type: 'removeBlock', blockId: 'practice-gallery' }
      const result = f.runtime.executeCommand({ requestId: `request-${crypto.randomUUID()}`, baseRevision: snapshot.revision, commands: [command] })
      check(result.ok, result.error?.message)
    } else if (mode === 'replace workspace') f.workspace.dispose()
    else { f.runtime.customProject.setReadOnly(true); f.runtime.customProject.setReadOnly(false) }
    const before = f.snapshot(), stored = await workspaceRepository.read()
    await f.controller.confirm(); check(f.controller.getSnapshot().phase === 'failed', mode)
    equal(f.snapshot(), before); equal(await workspaceRepository.read(), stored)
    cases.push({ mode, preserved: true, message: f.controller.getSnapshot().message }); f.close()
  }
  let release
  const pending = await fixture({ provider: { generate: () => new Promise(resolve => { release = resolve }) } })
  const work = pending.controller.generate('delayed provider', 'practice-gallery')
  pending.runtime.customProject.setReadOnly(true)
  release(await png()); await work
  check(pending.controller.getSnapshot().phase === 'failed'); check(pending.snapshot().revision === 0); pending.close()
  return { cases, revocationWhileGenerating: true }
}

export async function cancellation() {
  const cases = []
  for (const mode of ['cancel', 'timeout']) {
    let calls = 0, release
    const f = await fixture({ timeout: 30, provider: { generate() { calls++; return new Promise(resolve => { release = resolve }) } } })
    await f.workspace.save(); const before = f.snapshot(), stored = await workspaceRepository.read()
    const task = f.controller.generate('delayed', 'practice-gallery')
    if (mode === 'cancel') f.controller.cancel()
    await task
    release(await png()); await new Promise(resolve => setTimeout(resolve, 50))
    check(calls === 1 && !f.controller.getSnapshot().candidate); equal(f.snapshot(), before); equal(await workspaceRepository.read(), stored)
    cases.push({ mode, calls, state: f.controller.getSnapshot().phase, lateResponseIgnored: true }); f.close()
  }
  return { cases, costs: 'OFFLINE_ZERO; live-provider uncertain billing and key rotation NOT RUN' }
}

export async function mockAdapterFailures() {
  const valid = await fixedMockImageSource.generate({ prompt: 'fixture' }, { signal: new AbortController().signal })
  const damagedCrc = new Uint8Array(valid.bytes); damagedCrc[damagedCrc.length - 1] ^= 1
  const invalidRaster = new Uint8Array(valid.bytes), rasterView = new DataView(invalidRaster.buffer)
  const rasterLength = rasterView.getUint32(33)
  invalidRaster[41] = 0 // invalid deflate header, with valid enclosing PNG CRC
  rasterView.setUint32(41 + rasterLength, crc(invalidRaster.slice(37, 41 + rasterLength)))
  const animated = new Uint8Array(valid.bytes.length + 20), chunk = new Uint8Array(20), view = new DataView(chunk.buffer)
  view.setUint32(0, 8); chunk.set(new TextEncoder().encode('acTL'), 4); view.setUint32(8, 1); view.setUint32(16, crc(chunk.slice(4, 16)))
  animated.set(valid.bytes.slice(0, -12)); animated.set(chunk, valid.bytes.length - 12); animated.set(valid.bytes.slice(-12), animated.length - 12)
  const cases = [
    ['wrong provenance', { ...valid, kind: 'REAL' }], ['wrong MIME', { ...valid, mimeType: 'image/jpeg' }],
    ['missing envelope', null], ['not bytes', { ...valid, bytes: [...valid.bytes] }],
    ['metadata width mismatch', { ...valid, width: valid.width + 1 }], ['nonfinite dimension', { ...valid, height: Infinity }],
    ['pixel limit', { ...valid, width: 16777217 }], ['oversize', { ...valid, bytes: new Uint8Array(524289) }],
    ['short signature', { ...valid, bytes: new Uint8Array(32) }], ['extra field', { ...valid, url: 'https://untrusted.invalid/image.png' }],
    ['bad CRC', { ...valid, bytes: damagedCrc }], ['missing IEND', { ...valid, bytes: valid.bytes.slice(0, -12) }],
    ['animated PNG', { ...valid, bytes: animated }],
    ['native raster decode', { ...valid, bytes: invalidRaster }],
  ]
  const results = []
  for (const [name, value] of cases) {
    let calls = 0
    const f = await fixture({ source: 'MOCK', provider: createMockImageAdapter({ async generate() { calls++; return value } }) })
    await f.workspace.save(); const before = f.snapshot(), saved = await workspaceRepository.read()
    await f.controller.generate('reject invalid mock', 'practice-gallery')
    check(f.controller.getSnapshot().phase === 'failed', name); check(!f.controller.getSnapshot().candidate, name)
    await f.controller.confirm(); equal(f.snapshot(), before); equal(await workspaceRepository.read(), saved); check(calls === 1, name)
    results.push({ name, calls, originalPreserved: true }); f.close()
  }
  const exactBytes = Uint8Array.from(atob((await sizedPng(524288)).split(',')[1]), c => c.charCodeAt(0))
  const exact = await fixture({ source: 'MOCK', provider: createMockImageAdapter({ async generate() { return { ...valid, bytes: exactBytes } } }) })
  const accepted = await ready(exact); check(accepted.bytes === 524288); exact.close()
  return { results, exact512KiBAccepted: true, noNetworkTransport: true }
}

export async function mockRaces() {
  const f = await fixture({ source: 'MOCK', provider: mockImageProvider })
  await f.workspace.save(); const before = f.snapshot(), saved = await workspaceRepository.read()
  await ready(f)
  for (const prompt of ['', ' ', 'x'.repeat(501)]) {
    await f.controller.generate(prompt, 'practice-gallery')
    check(f.controller.getSnapshot().phase === 'failed' && !f.controller.getSnapshot().candidate)
    await f.controller.confirm(); equal(f.snapshot(), before); equal(await workspaceRepository.read(), saved)
    await ready(f)
  }
  const candidate = f.controller.getSnapshot().candidate
  check(candidate.asset.name === 'Mock测试图片.png' && candidate.asset.altText.includes('与描述无关'))
  await Promise.all([f.controller.confirm(), f.controller.confirm(), f.controller.confirm()])
  const adopted = await workspaceRepository.read(); check(adopted.receipts.length === 1)
  await f.controller.confirm(); equal(await workspaceRepository.read(), adopted); check(f.snapshot().revision === 1)
  f.close()
  const races = []
  for (const mode of ['cancel', 'timeout', 'dispose']) {
    let calls = 0
    const releases = []
    const item = await fixture({ source: 'MOCK', timeout: 20, provider: createMockImageAdapter({
      generate() { calls++; return new Promise(resolve => releases.push(resolve)) },
    }) })
    await item.workspace.save(); const old = item.snapshot(), oldSaved = await workspaceRepository.read()
    const first = item.controller.generate('old', 'practice-gallery')
    await item.controller.generate('duplicate', 'practice-gallery'); check(calls === 1)
    if (mode === 'dispose') item.controller.dispose()
    else if (mode === 'cancel') item.controller.cancel()
    await first
    const next = mode === 'cancel' ? item.controller.generate('new', 'practice-gallery') : null
    if (next) check(calls === 2)
    releases[0](await fixedMockImageSource.generate({ prompt: 'late' }, { signal: new AbortController().signal }))
    await new Promise(resolve => setTimeout(resolve, 0))
    check(!item.controller.getSnapshot().candidate); equal(item.snapshot(), old); equal(await workspaceRepository.read(), oldSaved)
    if (mode === 'cancel') {
      check(item.controller.getSnapshot().phase === 'generating', 'Old result must not end or replace new pending request')
      releases[1](await fixedMockImageSource.generate({ prompt: 'new' }, { signal: new AbortController().signal })); await next
      check(item.controller.getSnapshot().phase === 'ready')
    }
    races.push({ mode, calls, lateResultIgnored: true }); item.close()
  }
  return { invalidInputClearsStaleCandidate: true, duplicateAdoptionReceipts: 1, races }
}

export async function compatibility() {
  const results = []
  for (const mode of ['absent', 'empty', 'existing']) {
    const state = createGalleryPractice()
    if (mode === 'empty') state.assets = {}
    if (mode === 'existing') { state.assets = { original: asset('original', await png()) }; state.spec.blocks[0].imageIds = ['original'] }
    const f = await fixture({ state }); await f.workspace.save()
    const saved = await workspaceRepository.read(), json = serializeProjectJson(await createProjectJson(f.snapshot(), f.runtime.customProject.registry))
    equal((await restoreWorkspace(saved)).project, f.snapshot())
    equal((await parseProjectJsonText(json)).project, f.snapshot())
    equal((await parseProjectPackage(await createProjectPackage(f.snapshot(), f.runtime.customProject.registry))).project, f.snapshot())
    const broken = structuredClone(f.snapshot()); broken.base.spec.blocks[0].imageIds = ['missing']
    await rejects(() => createProjectPackage(broken, f.runtime.customProject.registry), 'RESOURCE_MISSING')
    equal(await workspaceRepository.read(), saved)
    results.push({ assets: mode, saveJsonZipRestore: true, danglingReferenceRejected: true }); f.close()
  }
  // This database belongs exclusively to this test's fresh Playwright context.
  await new Promise((resolve, reject) => { const q = indexedDB.deleteDatabase('blockcraft-project-backups'); q.onsuccess = resolve; q.onerror = reject; q.onblocked = () => reject(new Error('test database blocked')) })
  const backupRuntime = createAppRuntime(createGalleryPractice())
  const backupText = serializeProjectJson(await createProjectJson(backupRuntime.customProject.getSnapshot(), backupRuntime.customProject.registry))
  await new Promise((resolve, reject) => {
    const q = indexedDB.open('blockcraft-project-backups', 1)
    q.onupgradeneeded = () => q.result.createObjectStore('projects', { keyPath: 'id' })
    q.onsuccess = () => { const db = q.result, tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').add({ id: 'legacy-backup', name: 'old backup', createdAt: 1, text: backupText }); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = reject }
    q.onerror = reject
  })
  check((await listProjectBackups()).length === 1); check(await readProjectBackup('legacy-backup') === backupText)
  const migrated = await fixture(); await migrated.workspace.save()
  check(await readProjectBackup('legacy-backup') === backupText)
  equal((await parseProjectJsonText(await readProjectBackup('legacy-backup'))).project, backupRuntime.customProject.getSnapshot()); migrated.close()
  return { results, indexedDbV1ToV2BackupsPreserved: true }
}

export async function boundaries() {
  const checks = []
  async function roundtrip(state) {
    const f = await fixture({ state }); await f.workspace.save()
    const zip = await createProjectPackage(f.snapshot(), f.runtime.customProject.registry)
    equal((await parseProjectPackage(zip)).project, f.snapshot()); f.close()
  }
  const half = await sizedPng(512 * 1024), extra = await sizedPng(512 * 1024 + 1)
  const state = createGalleryPractice(); state.assets = { first: asset('first', half) }
  await roundtrip(state); checks.push('512 KiB valid decodable PNG: PASS')
  const limit = await fixture({ provider: { generate: async () => extra } }); await limit.controller.generate('too large', 'practice-gallery')
  check(limit.controller.getSnapshot().phase === 'failed'); check(limit.snapshot().revision === 0); limit.close(); checks.push('512 KiB + 1: rejected')
  state.assets.second = asset('second', half); await roundtrip(state); checks.push('1 MiB aggregate (unreferenced included): PASS')
  const full = await fixture({ state }); await full.controller.generate('full pool', 'practice-gallery')
  check(full.controller.getSnapshot().phase === 'failed'); check(Object.keys(full.snapshot().base.assets).length === 2); full.close()
  const small = await png(), smallBytes = atob(small.split(',')[1]).length
  const overTotal = structuredClone(full.snapshot())
  overTotal.base.assets.second = asset('second', await sizedPng(512 * 1024 - smallBytes + 1))
  overTotal.base.assets.third = asset('third', small)
  await rejects(() => createProjectPackage(overTotal, full.runtime.customProject.registry), 'PACKAGE_LIMIT')
  checks.push('1 MiB + 1 aggregate byte: rejected')
  state.assets = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`image${i}`, asset(`image${i}`, small)]))
  await roundtrip(state); checks.push('32 unreferenced PNGs: PASS')
  const count = await fixture({ state }); await count.controller.generate('33rd', 'practice-gallery')
  check(count.controller.getSnapshot().phase === 'failed'); check(Object.keys(count.snapshot().base.assets).length === 32); count.close(); checks.push('33rd image: rejected')
  const f = await fixture(), document = await createProjectJson(f.snapshot(), f.runtime.customProject.registry)
  const text = serializeProjectJson(document), remaining = PROJECT_JSON_MAX_BYTES - new TextEncoder().encode(text).length
  equal((await parseProjectJsonText(text + ' '.repeat(remaining))).project, f.snapshot())
  await rejects(() => parseProjectJsonText(text + ' '.repeat(remaining + 1)), 'LIMIT')
  f.close(); checks.push('JSON exact 4,000,000 bytes accepted; +1 rejected')
  // Valid business records remain below JSON text/node limits, but escaped output
  // exceeds the file budget. Confirm must reject before replacing the saved head.
  const business = createClubRegistrationExample()
  business.spec.blocks.push(createGalleryPractice().spec.blocks[0])
  business.records.applicants = Array.from({ length: 647 }, (_, n) => ({ id: `record-${n}`, values: { 'applicant-name': '\u0001'.repeat(1000), department: '技术部' } }))
  const big = await fixture({ state: business })
  await big.workspace.save()
  const oldSaved = await workspaceRepository.read(), oldProject = big.snapshot()
  await ready(big); await big.controller.confirm()
  check(big.controller.getSnapshot().phase === 'failed'); equal(big.snapshot(), oldProject); equal(await workspaceRepository.read(), oldSaved)
  big.close(); checks.push('large valid business text plus candidate exceeds serialized JSON budget: rejected before save')
  const files = [{ path: 'project.json', data: new Uint8Array(PACKAGE_LIMITS.maxFileBytes) },
    { path: 'manifest.json', data: new Uint8Array(PACKAGE_LIMITS.maxTotalBytes - PACKAGE_LIMITS.maxFileBytes) }]
  check(decodePackageZip(encodePackageZip(files)).get('project.json').length === PACKAGE_LIMITS.maxFileBytes)
  await rejects(() => encodePackageZip([{ path: 'project.json', data: new Uint8Array(PACKAGE_LIMITS.maxFileBytes + 1) }]), 'PACKAGE_LIMIT')
  await rejects(() => encodePackageZip([...files, { path: 'assets/extra.png', data: new Uint8Array(1) }]), 'PACKAGE_LIMIT')
  await rejects(() => decodePackageZip(new Uint8Array(PACKAGE_LIMITS.maxZipBytes + 1)), 'PACKAGE_LIMIT')
  checks.push('ZIP per-file 4,000,000 and total 5,100,000 accepted; +1 and archive cap +1 rejected')
  return { checks, scope: 'Real PNG resource limits; JSON serializer/container byte limits also tested independently of domain admission' }
}

let writer
export async function prepareWriter() { writer = await fixture(); return writer.workspace.workspaceId }
export async function writePrepared() {
  try { await writer.workspace.save(); return { ok: true, workspaceId: writer.workspace.workspaceId } }
  catch (error) { return { ok: false, code: error.code } }
  finally { writer.close() }
}
