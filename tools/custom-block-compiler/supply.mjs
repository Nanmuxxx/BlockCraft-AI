import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
export const compilerRoot = fileURLToPath(new URL('.', import.meta.url))
export async function verifySupply() {
  const { stdout } = await exec('python3', [fileURLToPath(new URL('./verify-packages.py', import.meta.url))], {
    timeout: 15000, maxBuffer: 65536,
    env: { PATH: process.env.PATH, LANG: 'C' },
  })
  return JSON.parse(stdout)
}
