// Synthetic canary only. No environment dump or real credential is permitted.
import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { unzip } from '../project-zip-export/fixtures.mjs'
const output = resolve(process.env.GENERATION_QA_OUTPUT || 'docs/acceptance/real-loop-qa/core61-signal-fix')
const canary = process.env.REAL_LOOP_SECRET_CANARY
assert(canary?.startsWith('synthetic-qa-canary-'), 'provide a synthetic QA canary')
const report = { liveCalls: 0, dist: 0, buildLogs: 0, exportedFiles: 0, independentlyBuiltExportFiles: 0, dockerImage: 'BLOCKED: docker executable unavailable; no image claim' }
const check = bytes => assert(!bytes.includes(Buffer.from(canary)), 'synthetic canary detected')
async function scan(directory, key) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) await scan(file, key)
    else if (entry.isFile()) { check(await readFile(file)); report[key]++ }
  }
}
await scan(resolve('dist'), 'dist')
check(await readFile(join(output, 'canary-build.txt'))); report.buildLogs++
for (const file of await readdir(output)) if (file.endsWith('.zip')) {
  for (const value of unzip(await readFile(join(output, file))).values()) { check(Buffer.from(value)); report.exportedFiles++ }
}
const builds = JSON.parse(await readFile(join(output, 'zip-sample-builds.json'), 'utf8'))
for (const item of builds.cases) {
  assert(item.passed)
  for (const command of item.commands) { check(Buffer.from(command.stdout + command.stderr)); report.buildLogs++ }
  await scan(join(builds.directory, item.id, 'dist'), 'independentlyBuiltExportFiles')
}
await writeFile(join(output, 'artifact-canary.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
