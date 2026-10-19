// Regressions from preserved real responses. No credentials, network, or new calls.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { assertAppSpec } from '../../server/.generated/appSpecValidation.js'
import { checkGeneratedApplication } from '../../server/aiGenerationQuality.mjs'
const require = createRequire(import.meta.url)
const { createAppRuntime } = require('../custom-block/fixtures.cjs')
const { initializeGeneratedProject } = require('../../src/components/ai-create/generateApp.ts')
const report = JSON.parse(readFileSync(new URL('../../docs/acceptance/phase2-deepseek/live-browser.json', import.meta.url)))
const load = id => {
  const text = readFileSync(new URL(`../../docs/acceptance/phase2-deepseek/${id}.response.json`, import.meta.url), 'utf8')
  const envelope = JSON.parse(text), spec = JSON.parse(envelope.choices[0].message.content)
  assert.equal(createHash('sha256').update(text).digest('hex'), report.cases.find(c => c.id === id).responseSha256)
  assertAppSpec(spec); assert.equal(spec.version, 1)
  return spec
}
for (const id of ['todo', 'club']) test(`${id}: preserved real output validates and drives the existing Runtime`, () => {
  const spec = load(id), before = structuredClone(spec), state = initializeGeneratedProject(spec), runtime = createAppRuntime(state)
  assert.equal(checkGeneratedApplication(spec, { idea: report.cases.find(c => c.id === id).idea }).completeness.valid, true)
  assert.equal(spec.entities.length, 1)
  const entity = spec.entities[0]
  const fields = entity.fields
  assert.deepEqual(fields.map(f => f.type).sort(), id === 'todo' ? ['boolean', 'date', 'text'] : ['boolean', 'select', 'text'])
  if (id === 'club') assert.deepEqual(fields.find(f => f.type === 'select').options, ['技术部', '宣传部', '策划部'])
  const textField = fields.find(f => f.type === 'text'), boolean = fields.find(f => f.type === 'boolean')
  const values = Object.fromEntries(fields.map(f => [f.id, f.type === 'boolean' ? false : f.type === 'date' ? '2026-10-20' : f.type === 'select' ? f.options[0] : '回放合成记录']))
  runtime.dispatch({ type: 'create', entityId: entity.id, record: { id: 'real-sample-record', values } })
  const updated = { ...values, [textField.id]: '本地修改', [boolean.id]: true }
  runtime.dispatch({ type: 'update', entityId: entity.id, recordId: 'real-sample-record', values: updated })
  assert.deepEqual(runtime.getSnapshot().records[entity.id], [{ id: 'real-sample-record', values: updated }])
  const snapshot = runtime.getSnapshot()
  assert.throws(() => runtime.dispatch({ type: 'update', entityId: entity.id, recordId: 'missing', values }))
  assert.equal(runtime.getSnapshot(), snapshot)
  runtime.dispatch({ type: 'delete', entityId: entity.id, recordId: 'real-sample-record' })
  assert.deepEqual(runtime.getSnapshot().records[entity.id], [])
  assert.deepEqual(spec, before)
})
test('real evidence has exactly two settled calls, no duplicate mobile/failure charge, distinct requirement structures', () => {
  assert.equal(report.realCalls, 2); assert.deepEqual(report.errors, []); assert.deepEqual(report.external, [])
  assert.deepEqual(report.audit.entries.map(e => e.status), ['settled', 'settled'])
  assert.equal(report.audit.entries.reduce((s, e) => s + e.estimatedNano, 0), 9484000)
  assert.equal(report.audit.entries.reduce((s, e) => s + e.reserveNano, 0), 188612000)
  for (const c of report.cases) assert.deepEqual(c.browser.map(b => b.liveGeneration), [true, false])
  assert.notDeepEqual(load('todo').entities, load('club').entities)
})
