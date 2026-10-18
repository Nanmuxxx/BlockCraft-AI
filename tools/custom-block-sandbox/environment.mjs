import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const tools = ['docker', 'podman', 'colima', 'limactl', 'qemu-system-aarch64', 'qemu-system-x86_64', 'sandbox-exec']

async function executable(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const path = join(dir, name)
    try { await access(path, constants.X_OK); return path } catch { /* absent */ }
  }
  return null
}

/** Read-only inventory. Tool presence is never evidence of effective isolation. */
export async function collectEnvironment() {
  const commands = Object.fromEntries(await Promise.all(tools.map(async name => [name, await executable(name)])))
  const dependencies = {}
  for (const name of ['react', 'react-dom', 'esbuild', 'playwright', 'puppeteer']) {
    try {
      const path = fileURLToPath(new URL(`../../node_modules/${name}/package.json`, import.meta.url))
      dependencies[name] = JSON.parse(await readFile(path, 'utf8')).version
    } catch { dependencies[name] = null }
  }
  return { platform: process.platform, architecture: process.arch, node: process.version, commands, dependencies }
}

/** Fail closed on every platform until a separately reviewed provider is implemented. */
export function assessEnvironment(inventory) {
  const blockers = []
  if (inventory.platform !== 'linux') blockers.push('NO_LINUX_EXECUTION_BOUNDARY')
  if (!inventory.commands?.docker && !inventory.commands?.podman) blockers.push('NO_CONTAINER_CLI')
  if (inventory.dependencies?.esbuild !== '0.25.12') blockers.push('PINNED_ESBUILD_UNAVAILABLE')
  if (inventory.dependencies?.react !== '19.3.1' || inventory.dependencies?.['react-dom'] !== '19.3.1') blockers.push('PINNED_REACT_UNAVAILABLE')
  if (!inventory.dependencies?.playwright && !inventory.dependencies?.puppeteer) blockers.push('BROWSER_DRIVER_UNAVAILABLE')
  blockers.push('ISOLATION_PROVIDER_NOT_IMPLEMENTED', 'RESOURCE_AND_EGRESS_ENFORCEMENT_UNVERIFIED', 'TRUSTED_GATEWAY_NOT_IMPLEMENTED')
  return {
    status: 'blocked', mayExecuteUntrustedCode: false, blockers,
    verifiedBuild: false, verifiedExecution: false, runtimeWritePermissions: [],
  }
}

// There is deliberately no allow flag, caller attestation, source loader or fallback.
export function requireExecutionProvider() {
  const error = new Error('Untrusted execution refused: no reviewed and verified isolation provider is installed')
  error.code = 'ISOLATION_UNVERIFIED'
  throw error
}
