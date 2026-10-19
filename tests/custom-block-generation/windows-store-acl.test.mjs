import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import { createPendingStore } from '../../server/custom-block/store.mjs'
import record from '../generated-artifact/fixtures/pomodoro.pending.json' with { type: 'json' }

const execFileAsync = promisify(execFile)
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const powershellModules = [
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsPowerShell', 'Modules'),
].join(path.delimiter)

test('Windows store root is protected and limited to the current user, SYSTEM and Administrators', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'blockcraft-acl-check-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = createPendingStore(directory)
  await store.put(structuredClone(record))
  const script = `
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:BLOCKCRAFT_STORE_ROOT
$allow = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' } | ForEach-Object {
  try { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }
  catch { $_.IdentityReference.Value }
})
[pscustomobject]@{ CurrentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; Protected = $acl.AreAccessRulesProtected; Allow = $allow } | ConvertTo-Json -Compress
`
  const { stdout } = await execFileAsync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, PSModulePath: powershellModules, BLOCKCRAFT_STORE_ROOT: directory },
  })
  const report = JSON.parse(stdout.trim())
  const allowed = new Set([report.CurrentSid, 'S-1-5-18', 'S-1-5-32-544'])
  assert.equal(report.Protected, true)
  assert.ok(report.Allow.length > 0)
  assert.equal(report.Allow.every(sid => allowed.has(sid)), true)
})
