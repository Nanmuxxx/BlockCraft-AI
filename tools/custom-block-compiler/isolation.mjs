import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { collectEnvironment, requireExecutionProvider } from '../custom-block-sandbox/environment.mjs'
import { probeMacos } from '../custom-block-sandbox/probe-macos.mjs'

async function executable(name) {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name)
    try { await access(candidate, constants.X_OK); return candidate } catch { /* unavailable */ }
  }
  return null
}

export async function inspectIsolation() {
  const inventory = await collectEnvironment()
  const extraCommands = {}
  for (const name of ['multipass', 'tart', 'orb', 'bwrap', 'firejail', 'unshare']) extraCommands[name] = await executable(name)
  const surfaces = {}
  for (const candidate of ['/Applications/Docker.app', '/Applications/OrbStack.app', '/var/run/docker.sock']) {
    try { await access(candidate); surfaces[candidate] = true } catch { surfaces[candidate] = false }
  }
  return {
    contractVersion: 1, status: 'blocked', code: 'ISOLATION_UNVERIFIED',
    inventory, extraCommands, surfaces,
    macosDiagnostics: await probeMacos(),
    acceptance: {
      independentLinuxBoundary: 'unverified', fullNetworkDeny: 'unverified', hostFilesystemDeny: 'unverified',
      hardCpuMemoryPidsLimits: 'unverified', deadlineTermination: 'unverified', processTreeReaping: 'unverified',
      browserInteraction: 'not-attempted', gatewayAuthentication: 'not-implemented',
    },
    execution: 'denied', sourceExecutionAttempted: false,
  }
}

export function requireVerifiedBackend() { return requireExecutionProvider() }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) process.exitCode = 64
  else { process.stdout.write(JSON.stringify(await inspectIsolation(), null, 2) + '\n'); process.exitCode = 2 }
}
