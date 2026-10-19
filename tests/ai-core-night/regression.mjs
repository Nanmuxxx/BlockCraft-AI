// Repeatable offline core suite. Discovers new tests within Agent A's families;
// never builds generated components, runs paid CLI paths, or edits Agent B's exporter.
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
const root = fileURLToPath(new URL('../../', import.meta.url))
const families = ['generation', 'custom-block', 'custom-block-bc', 'custom-block-workshop', 'generated-artifact', 'generated-artifact-ui', 'mochi-source', 'mochi-ai', 'trusted-interactive', 'trusted-pomodoro-ui', 'custom-block-generation']
const fixed = ['src/model/appChangePlan.test.cjs', 'src/model/appRuntime.test.cjs', 'src/model/appSpec.test.cjs', 'src/components/ai-create/generateApp.test.cjs', 'src/integrations/mochi/planning.test.cjs', 'server/server.test.mjs']
const tests = [...fixed]
for (const family of families) {
  const directory = `tests/${family}`
  for (const name of (await readdir(new URL(`../../${directory}/`, import.meta.url))).sort()) {
    if (/\.test\.(cjs|mjs)$/.test(name)) tests.push(`${directory}/${name}`)
  }
}
// Pure ZIP compatibility test is read-only; its prepared trusted dependency must
// already exist. Export preparation belongs to Agent B and is not invoked here.
if (process.argv.includes('--list')) { console.log(tests.join('\n')); process.exit(0) }
if (process.argv.length !== 2) throw Error('Usage: node tests/ai-core-night/regression.mjs [--list]')
async function run(name, command, args) {
  const child = spawn(process.execPath, ['tests/ai-core-night/check.mjs', name, command, ...args], { cwd: root, stdio: 'inherit', env: process.env })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve(signal ? 1 : code ?? 1)) })
  if (code !== 0) process.exit(code)
}
await run('core-server-prerequisite', 'npm', ['--prefix', 'server', 'run', 'build'])
await run('core-protocol-prerequisite', process.execPath, ['server/custom-block/build-protocol.mjs'])
await run('core-discovered', process.execPath, ['--test', ...tests])
