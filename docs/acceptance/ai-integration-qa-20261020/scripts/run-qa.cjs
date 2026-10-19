const { spawnSync } = require('node:child_process')
const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, 'BlockCraft-AI')
const output = path.resolve(__dirname, '../outputs')
mkdirSync(output, { recursive: true })
// Deliberately do not inherit application credentials or arbitrary NODE_OPTIONS.
const env = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'LOCALAPPDATA']) if (process.env[key]) env[key] = process.env[key]
env.NODE_OPTIONS = '--require=' + JSON.stringify(path.resolve(__dirname, 'deny-external.cjs'))
const tasks = {
  buildServer: ['node_modules/typescript/bin/tsc', '-p', 'server/tsconfig.json'],
  generation: ['--test', '--test-timeout=15000', 'tests/generation/*.test.mjs'],
  gateway: ['--test', '--test-timeout=15000', 'tests/paid-gateway/*.test.mjs'],
  server: ['--test', '--test-timeout=15000', 'server/*.test.mjs'],
  root: ['--test', 'src/components/blocks/presentation.test.cjs', 'src/model/appSpec.test.cjs', 'src/model/appRuntime.test.cjs', 'src/model/appChangePlan.test.cjs', 'src/components/blocks/blocks.test.cjs', 'src/components/ai-create/generateApp.test.cjs', 'src/components/app-builder/AppSpecCanvas.test.cjs', 'src/integrations/mochi/planning.test.cjs', 'src/components/mochi-ai/mochi-ai.test.cjs', 'src/components/mochi-ai/mochi-ai-v2.test.cjs'],
  protocol: ['server/custom-block/build-protocol.mjs'],
  tsc: ['node_modules/typescript/bin/tsc', '-b'],
  vite: ['node_modules/vite/bin/vite.js', 'build'],
}
for (const name of process.argv.slice(2)) {
  const started = new Date().toISOString()
  const result = spawnSync(process.execPath, tasks[name], { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 })
  writeFileSync(path.join(output, name + '.log'), (result.stdout || '') + '\nSTDERR:\n' + (result.stderr || '') + (result.error ? '\n' + result.error : ''))
  const record = { name, started, args: tasks[name], exit: result.status, signal: result.signal, error: result.error?.message, node: process.version, platform: process.platform, sha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim() }
  writeFileSync(path.join(output, name + '.json'), JSON.stringify(record, null, 2))
  console.log(JSON.stringify(record))
}
