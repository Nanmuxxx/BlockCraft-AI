// Record exact commands/exit codes without shell pipelines hiding failures.
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, appendFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const [name, command, ...args] = process.argv.slice(2)
if (!/^[a-z0-9-]+$/.test(name ?? '') || !command) throw new Error('Usage: check.mjs <name> <command> [args...]')
const output = resolve(process.env.AI_CORE_EVIDENCE || 'docs/agent-a-night/logs')
await mkdir(output, { recursive: true })
const startedAt = new Date().toISOString()
const git = (...args) => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}
const repositoryHead = git('rev-parse', 'HEAD')
const changedCode = git('diff', '--name-only', 'HEAD', '--', 'src', 'server', 'tests')
const untrackedCode = git('ls-files', '--others', '--exclude-standard', '--', 'src', 'server', 'tests')
const codeChanges = changedCode === null || untrackedCode === null ? null : [...new Set([changedCode, untrackedCode].flatMap(text => text.split('\n').filter(Boolean)))].sort()
// Only reproducibility settings for our offline harnesses; never copy process.env.
const environment = Object.fromEntries(['NODE_PATH', 'AI_CORE_EVIDENCE', 'GENERATION_QA_OUTPUT', 'GENERATED_UI_PRODUCTION_EVIDENCE', 'MOCHI_WORKSHOP_QA_OUTPUT'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
let text = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { text += chunk; process.stdout.write(chunk) })
const result = await new Promise(resolve => {
  child.once('error', error => resolve({ exitCode: 127, error: error.message }))
  child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
})
const file = `${name}-${startedAt.replaceAll(/[:.]/g, '-')}.txt`
await writeFile(resolve(output, file), text)
await appendFile(resolve(output, 'commands.jsonl'), JSON.stringify({ name, command: [command, ...args], cwd: process.cwd(), repositoryHead, codeChanges, environment, startedAt, endedAt: new Date().toISOString(), ...result, log: file, realModelCalls: 0 }) + '\n')
process.exitCode = result.exitCode ?? 1
