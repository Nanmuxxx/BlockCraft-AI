import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const WINDOWS_POWERSHELL = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)
const WINDOWS_PS_MODULE_PATH = [
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsPowerShell', 'Modules'),
].join(path.delimiter)

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function linuxProcessIdentity(pid) {
  const [stat, bootId] = await Promise.all([
    readFile(`/proc/${pid}/stat`, 'utf8'),
    readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
  ])
  const commandEnd = stat.lastIndexOf(')')
  if (commandEnd < 0) return null
  const fields = stat.slice(commandEnd + 2).trim().split(/\s+/)
  const parentPid = Number(fields[1])
  const startedAt = fields[19]
  if (!Number.isSafeInteger(parentPid) || !startedAt) return null
  return Object.freeze({
    pid,
    parentPid,
    startedAt,
    identity: `linux:${bootId.trim()}:${pid}:${startedAt}`,
  })
}

async function windowsProcessIdentity(pid) {
  const childEnvironment = {
    PSModulePath: WINDOWS_PS_MODULE_PATH,
    BLOCKCRAFT_PROCESS_PID: String(pid),
  }
  for (const key of [
    'PATH', 'Path', 'PATHEXT', 'ComSpec', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
    'TEMP', 'TMP', 'USERPROFILE', 'ProgramFiles',
  ]) {
    if (typeof process.env[key] === 'string') childEnvironment[key] = process.env[key]
  }
  const script = `
$ErrorActionPreference = 'Stop'
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$env:BLOCKCRAFT_PROCESS_PID" -ErrorAction SilentlyContinue
if ($null -ne $process) {
  [pscustomobject]@{
    Pid = [int]$process.ProcessId
    ParentPid = [int]$process.ParentProcessId
    StartedAt = $process.CreationDate.ToUniversalTime().ToFileTimeUtc().ToString()
  } | ConvertTo-Json -Compress
}
`
  const stdout = await new Promise((resolve, reject) => {
    execFile(WINDOWS_POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
    ], {
      windowsHide: true,
      timeout: 2_000,
      maxBuffer: 64 * 1024,
      env: childEnvironment,
    }, (error, value) => error ? reject(error) : resolve(value))
  })
  if (!stdout.trim()) return null
  const report = JSON.parse(stdout)
  if (!Number.isSafeInteger(report?.Pid) || !report?.StartedAt) return null
  return Object.freeze({
    pid: report.Pid,
    parentPid: Number(report.ParentPid),
    startedAt: String(report.StartedAt),
    identity: `windows:${report.Pid}:${report.StartedAt}`,
  })
}

async function psProcessIdentity(pid) {
  const stdout = await new Promise((resolve, reject) => {
    execFile('ps', ['-o', 'pid=', '-o', 'ppid=', '-o', 'lstart=', '-p', String(pid)], {
      timeout: 2_000,
      maxBuffer: 64 * 1024,
    }, (error, value) => error ? reject(error) : resolve(value))
  })
  const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(stdout)
  if (!match) return null
  return Object.freeze({
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    startedAt: match[3],
    identity: `posix:${match[1]}:${match[3]}`,
  })
}

async function defaultInspect(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  try {
    if (process.platform === 'linux') return await linuxProcessIdentity(pid)
    if (process.platform === 'win32') return await windowsProcessIdentity(pid)
    return await psProcessIdentity(pid)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return null
    throw error
  }
}

async function defaultRunTaskkill(pid) {
  await new Promise((resolve, reject) => {
    execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 2_000,
        maxBuffer: 64 * 1024,
      }, error => error ? reject(error) : resolve())
  })
}

export function createProcessReaper({
  inspect = defaultInspect,
  runTaskkill = defaultRunTaskkill,
  killPid = pid => process.kill(pid, 'SIGKILL'),
  waitForExitMs = 2_000,
} = {}) {
  async function terminateTree(rootPid) {
    if (!Number.isSafeInteger(rootPid) || rootPid <= 0) {
      return Object.freeze({ ok: false, status: 'invalid-root' })
    }
    try {
      if (process.platform === 'win32') await runTaskkill(rootPid)
      else process.kill(-rootPid, 'SIGKILL')
      return Object.freeze({ ok: true, status: 'tree-signalled' })
    } catch (error) {
      return Object.freeze({
        ok: false,
        status: error?.code === 'ESRCH' ? 'already-gone' : 'tree-signal-failed',
      })
    }
  }

  async function terminatePid(pid, expectedIdentity) {
    if (!expectedIdentity || expectedIdentity.pid !== pid || !expectedIdentity.identity) {
      return Object.freeze({ ok: false, status: 'identity-required' })
    }
    let before
    try { before = await inspect(pid) }
    catch { return Object.freeze({ ok: false, status: 'identity-inspection-failed' }) }
    if (!before) return Object.freeze({ ok: true, status: 'already-gone' })
    if (before.identity !== expectedIdentity.identity) {
      return Object.freeze({ ok: true, status: 'pid-reused' })
    }
    try { killPid(pid) } catch (error) {
      if (error?.code === 'ESRCH') return Object.freeze({ ok: true, status: 'already-gone' })
      return Object.freeze({ ok: false, status: 'kill-failed' })
    }
    const deadline = Date.now() + waitForExitMs
    while (Date.now() < deadline) {
      await wait(100)
      let current
      try { current = await inspect(pid) }
      catch { return Object.freeze({ ok: false, status: 'identity-inspection-failed' }) }
      if (!current || current.identity !== expectedIdentity.identity) {
        return Object.freeze({ ok: true, status: 'gone' })
      }
    }
    return Object.freeze({ ok: false, status: 'still-alive' })
  }

  return Object.freeze({ inspect, terminatePid, terminateTree })
}
