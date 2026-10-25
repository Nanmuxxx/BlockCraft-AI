// Builds ONLY the five builtin-only archives emitted by real-loop.browser.cjs.
// Every executable/config file must equal the repository-owned export scaffold.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { builtin, unzip } from '../project-zip-export/fixtures.mjs'
import { exportProjectZip } from '../../tools/project-zip-export/export.mjs'
const output = resolve(process.env.GENERATION_QA_OUTPUT || 'docs/acceptance/real-loop-qa')
const reference = unzip((await exportProjectZip(builtin())).bytes)
const directory = await mkdtemp(join(tmpdir(), 'blockcraft-real-loop-build-'))
const report = { realModelCalls: 0, scope: 'fixed repository-owned builtin scaffold; sample AppSpecs are JSON data only', directory, cases: [] }
const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: '1' }
for (const id of ['todo', 'club', 'fitness-log', 'money-app', 'learning']) {
  const archive = join(output, `${id}-1440.zip`), files = unzip(await readFile(archive))
  assert.deepEqual([...files.keys()].sort(), [...reference.keys()].sort())
  for (const [name, text] of files) {
    if (!['src/data.ts', 'provenance.json', 'README.md'].includes(name)) assert.equal(text, reference.get(name), `fixed source/config: ${name}`)
  }
  // Data is parsed before any build, never evaluated as supplied TS.
  const source = files.get('src/data.ts'), data = JSON.parse(source.slice(source.indexOf(' = ') + 3, source.lastIndexOf(';')))
  assert.equal(data.custom.instances.length, 0)
  const target = join(directory, id)
  for (const [name, text] of files) {
    assert(!name.includes('..') && !name.startsWith('/'))
    await mkdir(dirname(join(target, name)), { recursive: true }); await writeFile(join(target, name), text)
  }
  const commands = []
  for (const args of [['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--userconfig', '/dev/null'], ['run', 'build']]) {
    const result = spawnSync('npm', args, { cwd: target, env, encoding: 'utf8', timeout: 120000 })
    commands.push({ command: ['npm', ...args], exitCode: result.status, stdout: result.stdout, stderr: result.stderr })
    assert.equal(result.status, 0, `${id}: ${JSON.stringify(commands)}`)
  }
  report.cases.push({ id, archive, projectId: data.base.spec.id, commands, passed: true })
}
await writeFile(join(output, 'zip-sample-builds.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
