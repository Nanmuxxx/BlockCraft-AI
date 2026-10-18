import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMochiContextProjection } from '../../src/integrations/mochi-ai/context.mjs'
import { validateContext } from '../../src/integrations/mochi-ai/protocol.mjs'
import { context } from './fixtures.mjs'
const settle = () => new Promise(resolve => setImmediate(resolve))
function fixture(resolve) {
  let refs = [{ id: 'custom-1', definitionId: 'counter', versionDigest: 'v1' }], listener
  const view = { mode: 'blocks', context: { ...context(), blocks: [...context().blocks, { id: 'custom-1', type: 'custom' }] } }
  const host = { getSnapshot: () => view, subscribe(fn) { listener = fn; return () => { listener = null } } }
  const projection = createMochiContextProjection(host, { readReferences: () => refs, registry: { resolve } })
  return { projection, change(next) { refs = next; listener() }, view }
}
const entry = versionDigest => ({ versionDigest, artifact: { manifest: { definitionId: 'counter', name: '计时器',
  propsSchema: { type: 'object', required: ['label'], properties: { label: { type: 'string', title: 'secret-title', enum: ['business-record'], default: 'sensitive' }, nested: { type: 'object', properties: { record: {} } } } },
  stateSchema: { private: 'hidden' }, events: { secret: {} } }, sources: { code: 'do not send source' } } })

test('projection sends parameter names/types only; rejects invented bindings and sensitive extras', async () => {
  const f = fixture(() => entry('v1')); assert.throws(f.projection.read, { code: 'CONTEXT_PENDING' }); await settle()
  const c = f.projection.read(), b = c.blocks.at(-1)
  assert.deepEqual(b.parameters, [{ name: 'label', type: 'string', required: true }, { name: 'nested', type: 'object', required: false }])
  for (const privateText of ['secret-title','business-record','sensitive','private','sources','events','record']) assert(!JSON.stringify(c).includes(privateText))
  assert.throws(() => validateContext({ ...c, relations: [...c.relations, { blockId: 'custom-1', entityId: c.entities[0].id }] }))
  assert.throws(() => validateContext({ ...c, blocks: [{ ...b, props: { label: 'private' } }] }))
  assert.throws(() => validateContext({ ...c, relations: [] })) // builtin relations remain mandatory
  assert.doesNotThrow(() => validateContext({ ...c, selectedBlockId: 'custom-1', blocks: [b], entities: [], relations: [] }))
  f.projection.dispose()
})

test('exact-version pending metadata cannot publish after version change or disposal', async () => {
  const pending = new Map(), f = fixture(ref => new Promise(resolve => pending.set(ref.versionDigest, resolve)))
  f.change([{ id: 'custom-1', definitionId: 'counter', versionDigest: 'v2' }])
  pending.get('v1')(entry('v1')); await settle(); assert.throws(f.projection.read, { code: 'CONTEXT_PENDING' })
  pending.get('v2')(entry('v2')); await settle(); assert.equal(f.projection.read().blocks.at(-1).name, '计时器')
  f.change([{ id: 'custom-1', definitionId: 'counter', versionDigest: 'missing' }])
  pending.get('missing')(undefined); await settle(); assert.throws(f.projection.read, { code: 'CONTEXT_UNAVAILABLE' })
  f.projection.dispose()
})

test('context bounds reject oversized metadata rather than silently inventing or truncating', async () => {
  const large = entry('v1'); large.artifact.manifest.propsSchema.properties = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${i}`, { type: 'string' }]))
  const f = fixture(() => large); await settle(); assert.throws(f.projection.read, { code: 'INVALID_INPUT' }); f.projection.dispose()
})
