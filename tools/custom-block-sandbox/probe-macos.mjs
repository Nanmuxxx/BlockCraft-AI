import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const exec = promisify(execFile)
// All programs/arguments below are fixed, trusted diagnostics. Never pass AI source here.
const options = { timeout: 3000, maxBuffer: 8192, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C' } }
async function command(program, args) {
  try {
    const { stdout, stderr } = await exec(program, args, options)
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: typeof error.code === 'number' ? error.code : String(error.code), killed: Boolean(error.killed), stdout: String(error.stdout ?? '').slice(0, 8192), stderr: String(error.stderr ?? '').slice(0, 8192) }
  }
}

/** Paired positive controls. Only loopback and a disposable non-secret marker. */
export async function probeMacos() {
  if (process.platform !== 'darwin') return { status: 'not-applicable', productionIsolationVerified: false }
  const directory = await mkdtemp(join(tmpdir(), 'custom-block-trusted-probe-'))
  const marker = join(directory, 'marker.txt')
  const body = 'trusted-loopback-control'
  const markerText = 'disposable-non-secret-marker'
  await writeFile(marker, markerText, { mode: 0o600 })
  let received = 0
  const server = createServer((request, response) => { received++; response.end(body) })
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = `http://127.0.0.1:${server.address().port}/`
    const args = ['--noproxy', '*', '--max-time', '1', '--silent', '--show-error', address]
    const networkControl = await command('/usr/bin/curl', args)
    const before = received
    const networkDenied = await command('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', '/usr/bin/curl', ...args])
    // /tmp may resolve to /private/tmp; deny both spellings of this exact marker.
    const resolved = await realpath(marker)
    const profile = `(version 1)(allow default)(deny file-read* (literal ${JSON.stringify(marker)}) (literal ${JSON.stringify(resolved)}))`
    const fileControl = await command('/bin/cat', [marker])
    const fileDenied = await command('/usr/bin/sandbox-exec', ['-p', profile, '/bin/cat', marker])
    return {
      status: 'diagnostic-only', productionIsolationVerified: false,
      loopbackNetwork: {
        positiveControl: networkControl.code === 0 && networkControl.stdout === body,
        denyObserved: networkControl.code === 0 && networkControl.stdout === body && networkDenied.code === 7 && received === before,
        controlCode: networkControl.code, deniedCode: networkDenied.code,
      },
      selectedFile: {
        positiveControl: fileControl.code === 0 && fileControl.stdout === markerText,
        denyObserved: fileControl.code === 0 && fileControl.stdout === markerText && fileDenied.code === 1 && !fileDenied.stdout.includes(markerText),
        controlCode: fileControl.code, deniedCode: fileDenied.code,
      },
      limitations: [
        'Profiles allow default except the tested operation; never use them to run untrusted code.',
        'No external network, host secrets, arbitrary component, CPU loop or memory exhaustion was tested.',
        'This does not establish CPU/memory/process quotas, a hardened filesystem policy, or an execution service.',
      ],
    }
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
}
