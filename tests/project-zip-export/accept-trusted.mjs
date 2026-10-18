// Opt-in acceptance ONLY for the repository-controlled, SHA-256 checked catalogue.
// Not an arbitrary-project runner: no arguments, input paths, AI responses or flags.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { builtin, mixed, createReadingLogExample, unzip } from './fixtures.mjs'
import { trustedSample } from '../../tools/custom-block-compiler/trusted-samples.mjs'
import { protocol, json } from '../../server/custom-block/protocol.mjs'
import { exportProjectZip } from '../../tools/project-zip-export/export.mjs'

if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_ACCEPTED')
const require = createRequire(import.meta.url)
const { chromium } = require('playwright') // Existing developer test dependency; never installed here.
const output = await mkdtemp(join(tmpdir(), 'blockcraft-zip-acceptance-'))
const report = { scope: 'fixed developer catalogue ONLY; arbitrary AI source was not built or run', npmInstall: null, cases: [], outbound: [], errors: [] }
const cleanEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: '1' }
function command(cwd, args) {
  const result = spawnSync('npm', args, { cwd, env: cleanEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 1048576 })
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return { command: `npm ${args.join(' ')}`, exitCode: result.status, stdout: result.stdout.trim() }
}
const samples = { mixed: await mixed(), builtin: builtin(), reading: { project: protocol.migrateProjectState(createReadingLogExample()), artifacts: [] } }
// Valid Schema IDs may equal inherited object names. Missing rows/optional cells
// must remain empty, never resolve Object.prototype values or crash rendering.
const builtinProject = samples.builtin.project
for (const [entityId, blockId, fieldId] of [['toString', 'valueOf', 'toLocaleString'], ['isPrototypeOf', 'propertyIsEnumerable', 'hasOwnProperty']]) {
  builtinProject.base.spec.entities.push({ id: entityId, name: '边界数据', fields: [{ id: fieldId, name: '可选值', type: 'text', required: false }] })
  builtinProject.base.spec.blocks.push({ id: blockId, name: '边界列表', type: 'list', fieldIds: [fieldId] })
  builtinProject.base.spec.relations.push({ id: `${blockId}-binding`, type: 'dataBinding', blockId, entityId })
  builtinProject.renderOrder.push({ kind: 'builtin', id: blockId })
}
builtinProject.base.records.isPrototypeOf = [{ id: 'optional-empty', values: {} }]
const readingProject = samples.reading.project
readingProject.base.spec.blocks.push({ id: 'reading-average', name: '平均阅读时长', type: 'metric', aggregation: 'average', fieldId: 'minutes' })
readingProject.base.spec.relations.push({ id: 'average-binding', type: 'dataBinding', blockId: 'reading-average', entityId: 'reading-sessions' })
readingProject.renderOrder.push({ kind: 'builtin', id: 'reading-average' })
// Independent, fixed trust gate before any build. Caller claims never grant trust.
for (const input of Object.values(samples)) for (const entry of input.artifacts) {
  const name = entry.artifact.manifest.definitionId === 'trusted-counter' ? 'counter' : entry.artifact.manifest.definitionId === 'trusted-temperature' ? 'temperature' : undefined
  assert.ok(name, 'only fixed catalogue')
  assert.equal(json.canonicalJson(entry), json.canonicalJson(await trustedSample(name)), 'catalogue source hashes must match')
}
const directories = {}
for (const [name, input] of Object.entries(samples)) {
  const directory = join(output, name); directories[name] = directory
  const result = await exportProjectZip(input, { filename: `${name}.zip` })
  await mkdir(directory)
  await writeFile(join(output, `${name}.zip`), result.bytes)
  for (const [path, text] of unzip(result.bytes)) { const file = join(directory, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, text) }
  report.cases.push({ name, sha256: createHash('sha256').update(result.bytes).digest('hex'), files: result.files.length, zipBytes: result.bytes.length })
}
// No inherited npm tokens/config, no lifecycle scripts. Only the known scaffold's
// fixed dependency list is installed. Installation occurs outside the checkout.
report.npmInstall = command(directories.mixed, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--userconfig', '/dev/null', '--globalconfig', join(output, 'empty-global.npmrc'), '--registry', 'https://registry.npmjs.org', '--cache', join(output, 'npm-cache')])
for (const name of ['builtin', 'reading']) await symlink(join(directories.mixed, 'node_modules'), join(directories[name], 'node_modules'))
for (const entry of report.cases) entry.build = command(directories[entry.name], ['run', 'build'])
const { createServer, preview } = await import(pathToFileURL(join(directories.mixed, 'node_modules/vite/dist/node/index.js')).href)
const browser = await chromium.launch({ headless: true })
try {
  report.browser = browser.version()
  for (const entry of report.cases) for (const mode of ['dev', 'production']) {
    const server = mode === 'dev' ? await createServer({ root: directories[entry.name], server: { host: '127.0.0.1', port: 0 } }) : await preview({ root: directories[entry.name], preview: { host: '127.0.0.1', port: 0 } })
    if (mode === 'dev') await server.listen()
    const address = (mode === 'dev' ? server.httpServer : server.httpServer).address()
    const origin = `http://127.0.0.1:${address.port}`
    const context = await browser.newContext({ viewport: { width: 650, height: 950 } })
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      report.outbound.push(route.request().url()); return route.abort()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(error.message))
    try {
      await page.goto(origin)
      await page.locator('[data-block-id]').first().waitFor()
      assert.deepEqual(await page.locator('[data-block-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-block-id'))), samples[entry.name].project.renderOrder.map(item => item.id))
      if (entry.name === 'reading') {
        const form = page.locator('[data-block-id="reading-form"]')
        assert.deepEqual(await page.locator('.metric').allTextContents(), ['30', '30'])
        await form.locator('[name="reading-date"]').fill('2026-10-18')
        await form.locator('[name="minutes"]').fill('45')
        await form.locator('[name="notes"]').fill('固定可信样本')
        await form.getByRole('button', { name: '保存', exact: true }).click()
        assert.deepEqual(await page.locator('.metric').allTextContents(), ['75', '37.5'])
        await page.locator('[data-block-id="reading-history"]').getByRole('button', { name: '删除', exact: true }).first().click()
        await page.locator('[data-block-id="reading-history"]').getByRole('button', { name: '删除', exact: true }).first().click()
        assert.deepEqual(await page.locator('.metric').allTextContents(), ['0', '0'])
      } else {
        const form = page.locator('[data-block-id="registration-form"]')
        assert.equal(await page.locator('.metric').textContent(), '1')
        if (entry.name === 'builtin') {
          assert.equal(await page.locator('[data-block-id="valueOf"]').getAttribute('data-positioned'), 'false')
          assert.equal(await page.locator('[data-block-id="valueOf"] tbody tr').count(), 0)
          assert.equal(await page.locator('[data-block-id="propertyIsEnumerable"] td').first().textContent(), '')
        }
        await form.locator('[name="applicant-name"]').fill('独立工程验收')
        await form.locator('[name="department"]').selectOption('技术部')
        await form.getByRole('button', { name: '保存', exact: true }).click()
        assert.equal(await page.locator('.metric').textContent(), '2')
        const row = page.locator('[data-block-id="applicant-list"] tr').filter({ hasText: '独立工程验收' })
        await row.getByRole('button', { name: '删除', exact: true }).click()
        assert.equal(await page.locator('.metric').textContent(), '1')
        if (entry.name === 'mixed') {
          const counter = page.locator('[data-block-id="counter"]')
          assert.equal(await counter.locator('output').textContent(), '7')
          await counter.getByRole('button', { name: 'Increment' }).click()
          assert.equal(await counter.locator('output').textContent(), '8')
          await counter.getByRole('button', { name: 'Reset' }).click()
          assert.equal(await counter.locator('output').textContent(), '7')
          const temperature = page.locator('[data-block-id="temperature"]')
          await temperature.locator('input').fill('100')
          assert.equal(await temperature.locator('output').textContent(), '212.0 °F')
        }
      }
      await page.screenshot({ path: join(output, `${entry.name}-${mode}-mobile.png`), fullPage: true })
      await page.setViewportSize({ width: 1366, height: 950 })
      if (entry.name === 'mixed') {
        const positioned = await page.locator('[data-block-id="counter"]').evaluate(node => ({ css: getComputedStyle(node).position, x: node.style.getPropertyValue('--x'), y: node.style.getPropertyValue('--y') }))
        assert.deepEqual(positioned, { css: 'absolute', x: '0', y: '0.7' })
        const savedForm = await page.locator('[data-block-id="registration-form"]').boundingBox()
        const unpositionedList = await page.locator('[data-block-id="applicant-list"]').boundingBox()
        assert.ok(unpositionedList.y > savedForm.y + savedForm.height, 'missing coordinates must not collide with saved layout')
      }
      await page.screenshot({ path: join(output, `${entry.name}-${mode}-desktop.png`), fullPage: true })
      ;(entry.runtime ??= []).push({ mode, passed: true, checks: ['renderOrder', 'form-to-list/metric data flow', ...(entry.name === 'reading' ? ['sum', 'average', 'empty aggregation'] : ['count', 'delete']), ...(entry.name === 'builtin' ? ['inherited-name IDs and empty optional fields'] : []), ...(entry.name === 'mixed' ? ['exact props', 'Counter increment/reset', 'Temperature relative import', 'desktop saved coordinates', 'unpositioned fallback'] : [])] })
    } finally {
      await context.close()
      if (mode === 'dev') await server.close()
      else await new Promise(resolve => server.httpServer.close(resolve))
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.outbound, [])
} finally { await browser.close() }
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ output, ...report }, null, 2))
