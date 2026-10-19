// Evidence runner: only local production UI + intercepted Mock API; no backend.
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const out = path.join(root, 'docs/acceptance/gallery-stability')
async function command(name, args) {
  const started = new Date().toISOString()
  const chunks = []
  const child = spawn(process.execPath, args, { cwd: root, env: process.env })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { chunks.push(b); process.stdout.write(b) })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  await fs.writeFile(path.join(out, `${name}.txt`), Buffer.concat(chunks))
  return { name, command: [process.execPath, ...args], started, code }
}
async function main() {
  await fs.mkdir(out, { recursive: true })
  const commands = []
  // No dependency installation, production server, credentials or API key needed.
  for (const [name, args] of [
    ['typescript', [require.resolve('typescript/bin/tsc'), '-b']],
    ['production-build', [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build']],
    ['browser-run', [path.join(__dirname, 'browser.cjs')]],
  ]) {
    const result = await command(name, args); commands.push(result)
    if (result.code !== 0 && name !== 'browser-run') break
  }
  await fs.writeFile(path.join(out, 'commands.json'), JSON.stringify({
    codeSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    node: process.version, platform: process.platform, commands,
  }, null, 2))
  process.exitCode = commands.some(c => c.code !== 0) ? 1 : 0
}
main().catch(e => { console.error(e); process.exitCode = 1 })
