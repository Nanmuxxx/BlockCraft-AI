// One reproducible, offline-only QA entry point. Does not enable a paid transport.
const { spawnSync, execFileSync } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const output = path.resolve(process.env.GENERATION_QA_OUTPUT || path.join(root, 'docs/acceptance/real-loop-qa'))
mkdirSync(path.join(output, 'logs'), { recursive: true })
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), node: process.version, startedAt: new Date().toISOString(), realModelCalls: 0, sourceChanges: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }), commands: [] }
const commands = [
  ['root', 'npm', ['test']],
  ['generation', 'npm', ['run', 'test:generation']],
  ['client-boundary', process.execPath, ['--test', 'tests/generation/client-boundary.test.cjs']],
  ['zip', 'npm', ['run', 'test:workshop-export']],
  ['gateway', process.execPath, ['--test', 'tests/paid-gateway/security.test.mjs', 'tests/paid-gateway/model-contract.test.mjs', 'tests/paid-gateway/audit-boundary.test.mjs']],
  ['build', 'npm', ['run', 'build']],
  ['browser', process.execPath, ['tests/generation/real-loop.browser.cjs']],
  ['zip-samples', process.execPath, ['tests/generation/real-loop-zip-build.mjs']],
]
for (const [name, command, args] of commands) {
  const startedAt = new Date().toISOString()
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, GENERATION_QA_OUTPUT: output }, encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024 })
  writeFileSync(path.join(output, 'logs', `${name}.txt`), (result.stdout || '') + (result.stderr || ''))
  report.commands.push({ name, command: [command, ...args], startedAt, endedAt: new Date().toISOString(), exitCode: result.status, error: result.error?.message, log: `logs/${name}.txt` })
  writeFileSync(path.join(output, 'commands.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`${name}: exit ${result.status}`)
  if (result.status !== 0) { process.exitCode = 1; break }
}
