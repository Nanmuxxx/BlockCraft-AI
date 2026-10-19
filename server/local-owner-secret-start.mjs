// Owner-authorized local test only. Never exports, logs, or persists the secret.
import { openSync, fstatSync, readFileSync, closeSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { startLocalOwnerServer } from './local-owner-launcher.mjs'

let descriptor
try {
  descriptor = openSync(join(homedir(), '.config/blockcraft-ai/deepseek.key'), constants.O_RDONLY | constants.O_NOFOLLOW)
  const info = fstatSync(descriptor)
  if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.size > 514) throw new Error('Private file unavailable')
  const key = readFileSync(descriptor, 'utf8').trim()
  closeSync(descriptor); descriptor = undefined
  if (key.length < 16 || key.length > 512 || /\s/.test(key)) throw new Error('Private file unavailable')
  const { server } = await startLocalOwnerServer({ env: { ...process.env, DEEPSEEK_API_KEY: key, BLOCKCRAFT_LOCAL_OWNER_APPROVED: '1' } })
  console.info(`Owner-only local test ready: http://127.0.0.1:${server.address().port}/local-owner/start`)
} catch {
  if (descriptor !== undefined) closeSync(descriptor)
  console.error('Owner-only local test refused to start. No secret or upstream error details are printed.')
  process.exitCode = 1
}
