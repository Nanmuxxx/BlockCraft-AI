const { setup, api, copy, objectSchema } = require('../custom-block/fixtures.cjs')
const { createCustomBlockBCAdapter } = require('../../src/integrations/custom-block-bc/adapter.ts')

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
// TEST ONLY. Production must implement this boundary in its unique runtime owner.
function testOwner(initial) {
  let state = freeze(copy(initial))
  let commits = 0
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    compareAndSwap(expected, next) {
      if (expected !== state || expected.revision !== state.revision || next.revision !== state.revision + 1) return { ok: false, error: { code: 'REVISION_CONFLICT', message: 'stale' } }
      state = freeze(next); commits++; listeners.forEach(fn => fn())
      return { ok: true, duplicate: false, committedRevision: state.revision }
    },
    commits: () => commits,
  }
}
async function fixture() {
  const data = await setup()
  data.source.manifest.name = '受信任静态元数据测试'
  data.source.manifest.propsSchema = objectSchema({
    durationSeconds: { type: 'integer', minimum: 1, maximum: 86400, title: '时长（秒）' },
    title: { type: 'string', maxLength: 40, minLength: 1 },
    enabled: { type: 'boolean' },
    mode: { type: 'string', maxLength: 10, enum: ['compact', 'full'] },
    precision: { type: 'number', minimum: 0, maximum: 1 },
    style: objectSchema({ caption: { type: 'string', maxLength: 30 } }),
  })
  data.source.manifest.propsSchema.required = ['durationSeconds', 'title', 'enabled', 'mode', 'precision']
  data.versionDigest = await api.computeVersionDigest(data.source)
  data.reference = { definitionId: data.source.manifest.definitionId, versionDigest: data.versionDigest }
  data.entry = { versionDigest: data.versionDigest, artifact: data.source }
  data.registry = { async resolve(ref) { return ref.definitionId === data.reference.definitionId && ref.versionDigest === data.reference.versionDigest ? data.entry : undefined } }
  Object.assign(data.project.custom.instances[0], data.reference, { props: { durationSeconds: 600, title: '元数据测试', enabled: true, mode: 'compact', precision: .5 } })
  data.project.custom.states['countdown-1'].versionDigest = data.versionDigest
  // Interleave, rather than appending custom blocks after the builtin array.
  data.project.renderOrder.splice(1, 0, data.project.renderOrder.pop())
  data.owner = testOwner(await api.parseCustomProject(data.project, data.registry))
  data.adapter = await createCustomBlockBCAdapter(data.owner, data.registry)
  data.propsRequest = props => ({ baseRevision: data.owner.getSnapshot().revision, instanceId: 'countdown-1', reference: data.reference, props: props ?? copy(data.owner.getSnapshot().custom.instances[0].props) })
  return data
}
module.exports = { fixture, testOwner, freeze, copy, api }
