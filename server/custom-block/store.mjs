import { constants } from 'node:fs'
import { open, mkdir, lstat, readdir, link, unlink, rmdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { protocol, json, ensure, GenerationError, LIMITS } from './protocol.mjs'
import { validatePendingEntry } from './contract.mjs'

const execFileAsync = promisify(execFile)
const WINDOWS_POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const WINDOWS_PRIVATE_SIDS = new Set(['S-1-5-18', 'S-1-5-32-544'])
const WINDOWS_PS_MODULE_PATH = [
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsPowerShell', 'Modules'),
].join(path.delimiter)

/**
 * POSIX mode bits do not describe Windows ACL inheritance or identity. Replace
 * inherited access on the private store root with an explicit ACL for the
 * current user, SYSTEM and Administrators, then verify the resulting ACL.
 * Keep this fail-closed when PowerShell/ACL inspection is unavailable.
 */
async function prepareWindowsAcl(root) {
  const script = `
$ErrorActionPreference = 'Stop'
$path = $env:BLOCKCRAFT_STORE_ROOT
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$acl = Get-Acl -LiteralPath $path
$allowedSids = @($current, 'S-1-5-18', 'S-1-5-32-544')
$initialAllow = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object {
  try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }
  catch { $_.IdentityReference.Value }
})
$alreadyPrivate = $acl.AreAccessRulesProtected -and $initialAllow.Count -gt 0 -and @($initialAllow | Where-Object { $allowedSids -notcontains $_ }).Count -eq 0
if (-not $alreadyPrivate) {
  try {
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
    foreach ($sid in $allowedSids) {
      $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
      $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
      [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $path -AclObject $acl
  } catch {
    # Another bounded writer may have normalized the same root concurrently.
    # Verification below decides whether the resulting ACL is acceptable.
  }
}
$verified = Get-Acl -LiteralPath $path
$allow = @($verified.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object {
  try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }
  catch { $_.IdentityReference.Value }
})
[pscustomobject]@{ Protected = $verified.AreAccessRulesProtected; CurrentSid = $current; Allow = $allow } | ConvertTo-Json -Compress
`
  let stdout
  try {
    stdout = (await execFileAsync(WINDOWS_POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
    ], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      // The host can inherit PowerShell 7 module directories. Windows
      // PowerShell must not try to autoload Microsoft.PowerShell.Security from
      // those incompatible module versions.
      env: { ...process.env, PSModulePath: WINDOWS_PS_MODULE_PATH, BLOCKCRAFT_STORE_ROOT: root },
    })).stdout
  } catch {
    throw new GenerationError('STORE_PRIVATE_DIRECTORY_ACL_UNVERIFIED')
  }
  let report
  try { report = JSON.parse(stdout.trim()) } catch { throw new GenerationError('STORE_PRIVATE_DIRECTORY_ACL_UNVERIFIED') }
  const allowed = new Set([report?.CurrentSid, ...WINDOWS_PRIVATE_SIDS])
  ensure(report?.Protected === true && typeof report?.CurrentSid === 'string' &&
    Array.isArray(report?.Allow) && report.Allow.length > 0 && report.Allow.every(sid => allowed.has(sid)),
  'STORE_PRIVATE_DIRECTORY_ACL_UNVERIFIED')
}

async function readBounded(filename) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    ensure(stat.isFile() && stat.size <= LIMITS.storeBytes, 'STORE_LIMIT')
    const buffer = Buffer.alloc(LIMITS.storeBytes + 1)
    let length = 0
    // A successful read may be short without reaching EOF. Consume the full
    // bounded file so a JSON prefix cannot conceal unread trailing content.
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
      ensure(length <= LIMITS.storeBytes, 'STORE_LIMIT')
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)))
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
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'STORE_PRIVATE_DIRECTORY_REQUIRED')
    if (process.platform === 'win32') await prepareWindowsAcl(root)
    else ensure((stat.mode & 0o077) === 0, 'STORE_PRIVATE_DIRECTORY_REQUIRED')
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
