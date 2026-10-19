const { readFileSync, writeFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { createHash } = require('node:crypto')
const path = require('node:path')
;(async () => {
  const report = { node: process.version, platform: process.platform, realModelCalls: 0, probes: [] }
  for (const checkout of ['BlockCraft-AI', 'BlockCraft-AI-lf']) {
    const root = path.resolve(__dirname, checkout)
    const source = readFileSync(path.join(root, 'src/model/appSpec.ts'), 'utf8')
    const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.trim()
    const module = await import(pathToFileURL(path.join(root, 'server/aiGenerationPrompt.mjs')).href)
    const row = { checkout, sha: git(['rev-parse', 'HEAD']), status: git(['status', '--short']), crlfCount: (source.match(/\r\n/g) || []).length, bytesSha256: createHash('sha256').update(source).digest('hex'), normalizedSha256: createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex') }
    try { module.readV1GenerationProtocol(); row.result = 'PASS' }
    catch (error) { row.result = 'FAIL'; row.error = error.message; row.stack = error.stack }
    report.probes.push(row)
  }
  writeFileSync(path.resolve(__dirname, '../outputs/newline-probe.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
