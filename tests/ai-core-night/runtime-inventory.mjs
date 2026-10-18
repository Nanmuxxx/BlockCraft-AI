// Read-only Node link check against PR35's explicit file inventory. No Docker,
// deployment edits, listener, package installation, or model request.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../../', import.meta.url))
const inventory = ['server/index.mjs', 'server/trusted-interactive.mjs', 'server/aiGenerationPrompt.mjs', 'server/aiGenerationQuality.mjs', 'server/mochi-ai', 'server/.generated', 'src/model/appSpec.ts', 'src/model/trustedInteractive.schema.json', 'src/integrations/mochi-ai/protocol.mjs']
const directory = await mkdtemp(join(tmpdir(), 'blockcraft-agent-a-inventory-'))
const results = []
try {
  for (const name of inventory) {
    const destination = join(directory, name)
    await mkdir(dirname(destination), { recursive: true })
    await cp(join(root, name), destination, { recursive: true })
  }
  for (const includesAbort of [false, true]) {
    if (includesAbort) await cp(join(root, 'server/ai-abort.mjs'), join(directory, 'server/ai-abort.mjs'))
    const source = `globalThis.fetch = () => { throw new Error('NETWORK_DISABLED') }; await import(${JSON.stringify(pathToFileURL(join(directory, 'server/index.mjs')).href)}); console.log('Trusted server modules linked without starting a listener')`
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10_000 })
    results.push({ includesAbort, exitCode: child.status, stdout: child.stdout, stderr: child.stderr })
    if (includesAbort) assert.equal(child.status, 0, child.stderr)
    else {
      assert.equal(child.status, 1)
      assert.match(child.stderr, /ERR_MODULE_NOT_FOUND/)
      assert.match(child.stderr, /ai-abort\.mjs/)
    }
  }
  console.log(JSON.stringify({ scope: 'Node module linking only, not container acceptance', pr35Head: 'f6e7b9cba54a4aae575fbf26de91dc00c4b2c7c0', inventory, results, realModelCalls: 0 }, null, 2))
} finally { await rm(directory, { recursive: true, force: true }) }
