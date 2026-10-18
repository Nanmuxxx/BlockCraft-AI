const test = require('node:test')
const assert = require('node:assert/strict')
require('../custom-block/fixtures.cjs')
const { generateInteractiveProject } = require('../../src/components/ai-create/generateApp.ts')
const fixture = require('./pomodoro.json')
const reply = () => ({ protocol: 'trusted-interactive/1', spec: structuredClone(fixture), provenance: { source: 'offline-fixture', model: 'fixed-json' } })
test('client validates complete v2 envelope and rejects permissions, invalid schemas and fake successful errors', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original })
  global.fetch = async (url, options) => {
    assert.equal(url, '/api/ai/generate'); assert.deepEqual(JSON.parse(options.body), { idea: '专注', protocol: 'trusted-interactive/1' })
    return Response.json(reply())
  }
  const valid = await generateInteractiveProject(' 专注 ')
  assert.equal(valid.source, 'offline-fixture'); assert.equal(valid.state.spec.version, 2)
  assert.equal(valid.state.revision, 0); assert.deepEqual(valid.state.records, {})
  for (const mutate of [
    r => { r.permissions = ['execute'] }, r => { r.provenance.permissions = ['execute'] },
    r => { r.provenance.source = 'mock-as-live' }, r => { r.provenance.model = null },
    r => { r.protocol = 'trusted-interactive/2' }, r => { r.spec.blocks[0].onClick = 'alert(1)' },
    r => { r.spec.blocks[0].durationSeconds = 7201 }, r => { r.spec.version = 1 },
  ]) {
    const candidate = reply(); mutate(candidate); global.fetch = async () => Response.json(candidate)
    await assert.rejects(generateInteractiveProject('专注'))
  }
  global.fetch = async () => Response.json({ error: { code: 'AI_INVALID_SPEC' } }, { status: 502 })
  await assert.rejects(generateInteractiveProject('专注'), /AI_INVALID_SPEC/)
  global.fetch = async () => new Response('invalid JSON', { status: 200 })
  await assert.rejects(generateInteractiveProject('专注'))
  const controller = new AbortController(); controller.abort()
  global.fetch = async (_url, { signal }) => { signal.throwIfAborted() }
  await assert.rejects(generateInteractiveProject('专注', controller.signal))
})
