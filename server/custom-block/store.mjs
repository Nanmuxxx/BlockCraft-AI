import { constants } from 'node:fs'
import { open, mkdir, lstat, readdir, link, unlink, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { protocol, json, ensure, GenerationError, LIMITS } from './protocol.mjs'
import { validatePendingEntry } from './contract.mjs'

async function readBounded(filename) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    ensure(stat.isFile() && stat.size <= LIMITS.storeBytes, 'STORE_LIMIT')
    const buffer = Buffer.alloc(LIMITS.storeBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    ensure(bytesRead <= LIMITS.storeBytes, 'STORE_LIMIT')
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)))
  } finally { await handle.close() }
}

export async function validateRecord(input) {
  protocol.assertJson(input); json.object(input)
  json.keys(input, ['storageVersion', 'status', 'entry', 'provenance'])
  ensure(input.storageVersion === 1 && input.status === 'pending-build', 'STORE_INVALID')
  json.object(input.provenance); json.keys(input.provenance, ['kind', 'requestId', 'requirementDigest'])
  ensure(['mock', 'deepseek'].includes(input.provenance.kind), 'STORE_INVALID')
  json.id(input.provenance.requestId); json.digest(input.provenance.requirementDigest)
  const entry = await validatePendingEntry(input.entry)
  return { storageVersion: 1, status: 'pending-build', entry, provenance: structuredClone(input.provenance) }
}

/** Private trusted host directory, outside web roots. No source file is written as JS/TS. */
export function createPendingStore(directory, { maxArtifacts = 256 } = {}) {
  ensure(path.isAbsolute(directory) && Number.isSafeInteger(maxArtifacts) && maxArtifacts > 0 && maxArtifacts <= 256, 'STORE_CONFIGURATION')
  const root = path.resolve(directory)
  async function prepare() {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const stat = await lstat(root)
    ensure(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'STORE_PRIVATE_DIRECTORY_REQUIRED')
  }
  function filename(reference) {
    protocol.assertArtifactReference(reference)
    return path.join(root, `${reference.versionDigest.slice(7)}.json`)
  }
  return Object.freeze({
    async put(input) {
      // Validate/copy before first await to prevent caller mutation during hashing.
      protocol.assertJson(input)
      const record = await validateRecord(structuredClone(input))
      const text = JSON.stringify(record) + '\n'
      ensure(Buffer.byteLength(text) <= LIMITS.storeBytes, 'STORE_LIMIT')
      await prepare()
      const target = filename({ definitionId: record.entry.artifact.manifest.definitionId, versionDigest: record.entry.versionDigest })
      // Existing immutable content can be reused; first accepted provenance is retained.
      async function existing() {
        const old = await validateRecord(await readBounded(target))
        ensure(old.entry.versionDigest === record.entry.versionDigest && old.entry.artifact.manifest.definitionId === record.entry.artifact.manifest.definitionId, 'STORE_COLLISION')
        return old
      }
      try { return await existing() } catch (error) { if (error.code !== 'ENOENT') throw error }
      // Atomic mkdir coordinates independent handles/processes sharing this root.
      // Never wait on or remove an unknown lease: after a crash the trusted host
      // must inspect the directory before recovering its stale .write-lock.
      const lease = path.join(root, '.write-lock')
      try { await mkdir(lease, { mode: 0o700 }) }
      catch (error) { if (error.code === 'EEXIST') throw new GenerationError('STORE_BUSY'); throw error }
      try {
        // Another writer may have completed between the initial lookup and lease.
        try { return await existing() } catch (error) { if (error.code !== 'ENOENT') throw error }
        ensure((await readdir(root)).filter(name => name !== '.write-lock').length < maxArtifacts, 'STORE_QUOTA')
        const temp = path.join(root, `.pending-${randomUUID()}.tmp`)
        const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        try {
          await handle.writeFile(text); await handle.sync(); await handle.close()
          try { await link(temp, target) } catch (error) { if (error.code !== 'EEXIST') throw error }
          return await existing()
        } finally { await handle.close().catch(() => {}); await unlink(temp).catch(() => {}) }
      } finally { await rmdir(lease).catch(() => {}) }
    },
    async inspect(reference) {
      protocol.assertArtifactReference(reference)
      const ref = structuredClone(reference)
      const target = filename(ref)
      await prepare()
      try {
        const record = await validateRecord(await readBounded(target))
        ensure(record.entry.versionDigest === ref.versionDigest && record.entry.artifact.manifest.definitionId === ref.definitionId, 'STORE_REFERENCE_MISMATCH')
        return record
      } catch (error) {
        if (error.code === 'ENOENT') return undefined
        if (error instanceof GenerationError) throw error
        throw new GenerationError('STORE_INVALID')
      }
    },
    // Phase 1A ArtifactRegistry interface: exact-reference revalidation remains mandatory.
    async resolve(reference) { return (await this.inspect(reference))?.entry },
  })
}
