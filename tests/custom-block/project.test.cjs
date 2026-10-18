const test = require('node:test')
const assert = require('node:assert/strict')
const { api, copy, setup, createReadingLogExample, createClubRegistrationExample, createAppRuntime, assertProjectState } = require('./fixtures.cjs')
const unavailable = { resolve: async () => { throw new Error('empty projects never read registry') } }
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v) } return v }

for (const factory of [createReadingLogExample, createClubRegistrationExample]) test(`lossless v1 roundtrip and unchanged runtime: ${factory.name}`, async () => {
  const v1 = factory(); v1.revision = 37
  const entity = v1.spec.entities[0]
  const field = entity.fields.find(f => f.type === 'text')
  v1.records[entity.id][0].values[field.id] = '原始业务数据😀\n换行'
  freeze(v1)
  const before = JSON.stringify(v1)
  const v2 = api.migrateProjectState(v1)
  assert.equal(v2.revision, 37)
  assert.ok(!Object.hasOwn(v2.base, 'revision'))
  assert.deepEqual(v2.base.spec, v1.spec); assert.deepEqual(v2.base.records, v1.records); assert.deepEqual(v2.base.blockPositions, v1.blockPositions)
  assert.deepEqual(await api.parseCustomProject(v2, unavailable), v2)
  const roundtrip = api.exportProjectState(v2)
  assert.deepEqual(roundtrip, v1); assertProjectState(roundtrip)
  const runtime = createAppRuntime(roundtrip)
  const block = roundtrip.spec.blocks[0]
  assert.equal(runtime.moveBlock(block.id, { x: .12, y: .34 }).ok, true)
  assert.equal(runtime.getSnapshot().revision, 38)
  assert.deepEqual(runtime.getSnapshot().records, v1.records)
  assert.equal(JSON.stringify(v1), before)
  roundtrip.spec.name = '修改导出副本'; v2.base.spec.name = '修改迁移副本'
  assert.equal(JSON.stringify(v1), before)
})
test('migration preserves absence, explicit layout, negative zero and empty v1 structure', () => {
  const v1 = createReadingLogExample(); v1.blockPositions = {}
  const numeric = v1.spec.entities.flatMap(e => e.fields.map(f => [e, f])).find(([, f]) => f.type === 'number')
  if (numeric) v1.records[numeric[0].id][0].values[numeric[1].id] = -0
  assert.deepEqual(api.exportProjectState(api.migrateProjectState(v1)), v1)
  const empty = { revision: 0, spec: { version: 1, id: 'app', name: '空项目', entities: [], blocks: [], relations: [] }, records: {}, blockPositions: {} }
  assert.deepEqual(api.exportProjectState(api.migrateProjectState(empty)), empty)
})
test('custom data resolves exact artifact, validates props/state, and has no inline source', async () => {
  const { project, registry } = await setup()
  const parsed = await api.parseCustomProject(freeze(project), registry)
  assert.deepEqual(parsed, project)
  assert.notStrictEqual(parsed, project)
  assert.equal(JSON.stringify(parsed).includes('fixture must never execute'), false)
  assert.throws(() => api.exportProjectState(project), { code: 'LOSSY_EXPORT' })
})
const invalidProjects = {
  'unknown v2 format': p => { p.formatVersion = 3 },
  'inner writable revision': p => { p.base.revision = 0 },
  'invalid outer revision': p => { p.revision = Number.MAX_SAFE_INTEGER + 1 },
  'v1 unknown version': p => { p.base.spec.version = 2 },
  'dangling v1 binding': p => { p.base.spec.relations[0].entityId = 'missing' },
  'invalid custom ID': p => { p.custom.instances[0].id = '__proto__' },
  'custom collides with builtin': p => { p.custom.instances[0].id = p.base.spec.blocks[0].id },
  'custom collides with entity': p => { p.custom.instances[0].id = p.base.spec.entities[0].id },
  'custom collides with field': p => { p.custom.instances[0].id = p.base.spec.entities[0].fields[0].id },
  'custom collides with relation': p => { p.custom.instances[0].id = p.base.spec.relations[0].id },
  'custom collides with app': p => { p.custom.instances[0].id = p.base.spec.id },
  'duplicate custom': p => { p.custom.instances.push(copy(p.custom.instances[0])) },
  'missing version': p => { delete p.custom.instances[0].versionDigest },
  'floating version': p => { p.custom.instances[0].versionDigest = 'latest' },
  'unavailable version': p => { p.custom.instances[0].versionDigest = `sha256:${'f'.repeat(64)}`; delete p.custom.states['countdown-1'] },
  'invalid definition': p => { p.custom.instances[0].definitionId = 'unavailable' },
  'inline source': p => { p.custom.instances[0].source = 'alert(1)' },
  'missing position': p => { delete p.custom.positions['countdown-1'] },
  'unknown position': p => { p.custom.positions.other = { x: 0, y: 0 } },
  'position out of range': p => { p.custom.positions['countdown-1'].x = 1.01 },
  'NaN position': p => { p.custom.positions['countdown-1'].y = NaN },
  'position extra key': p => { p.custom.positions['countdown-1'].z = 0 },
  'missing render item': p => { p.renderOrder.pop() },
  'duplicate render item': p => { p.renderOrder[0] = p.renderOrder.at(-1) },
  'wrong render kind': p => { p.renderOrder.at(-1).kind = 'builtin' },
  'unknown render item': p => { p.renderOrder.at(-1).id = 'unknown' },
  'extra render key': p => { p.renderOrder[0].label = 'extra' },
  'dangling state': p => { p.custom.states.unknown = p.custom.states['countdown-1'] },
  'state version mismatch': p => { p.custom.states['countdown-1'].versionDigest = `sha256:${'f'.repeat(64)}` },
  'state bad revision': p => { p.custom.states['countdown-1'].stateRevision = -1 },
  'state bad data': p => { p.custom.states['countdown-1'].value.status = 'fake' },
  'props wrong type': p => { p.custom.instances[0].props.durationSeconds = '600' },
  'props unknown key': p => { p.custom.instances[0].props.script = 'evil' },
}
for (const [name, mutate] of Object.entries(invalidProjects)) test(`project rejects ${name}`, async () => {
  const { project, registry } = await setup(); mutate(project)
  await assert.rejects(api.parseCustomProject(project, registry))
})
test('migration rejects malformed v1/unknown roots and accessors without reading them', () => {
  for (const value of [null, {}, { formatVersion: 9 }, { ...createReadingLogExample(), revision: -1 }]) assert.throws(() => api.migrateProjectState(value))
  let calls = 0
  const input = createReadingLogExample()
  Object.defineProperty(input, 'revision', { enumerable: true, get() { calls++; return 0 } })
  assert.throws(() => api.migrateProjectState(input)); assert.equal(calls, 0)
})
test('safe downgrade rejects custom/order loss and keeps builtin reorder in v2', async () => {
  const empty = api.migrateProjectState(createReadingLogExample())
  empty.renderOrder.reverse()
  await api.parseCustomProject(empty, unavailable)
  assert.throws(() => api.exportProjectState(empty), { code: 'LOSSY_EXPORT' })
  const { project, registry } = await setup()
  project.custom.states = {}; await api.parseCustomProject(project, registry)
  assert.throws(() => api.exportProjectState(project), { code: 'LOSSY_EXPORT' })
})
test('project captures a snapshot before async registry work and allows separate state CAS counter', async () => {
  const { project, entry } = await setup()
  project.revision = 41; project.custom.states['countdown-1'].stateRevision = 12
  const result = await api.parseCustomProject(project, { async resolve() { project.custom.instances[0].props.durationSeconds = 'changed'; return entry } })
  assert.equal(result.custom.instances[0].props.durationSeconds, 600)
  assert.equal(result.revision, 41); assert.equal(result.custom.states['countdown-1'].stateRevision, 12)
})
test('capability project references must exist even though no permission is granted', async () => {
  const { source, project } = await setup()
  source.manifest.requestedCapabilities.push({ kind: 'records.create', entityId: 'unknown' })
  const versionDigest = await api.computeVersionDigest(source)
  project.custom.instances[0].versionDigest = versionDigest; project.custom.states = {}
  await assert.rejects(api.parseCustomProject(project, { resolve: async () => ({ versionDigest, artifact: source }) }), /unknown project entity/)
})
test('valid IDs matching Object prototype names do not create phantom state slots', async () => {
  for (const instanceId of ['toString', 'valueOf', 'hasOwnProperty']) {
    const { project, registry } = await setup()
    project.custom.instances[0].id = instanceId
    project.custom.positions = { [instanceId]: { x: 0, y: 1 } }
    project.custom.states = {}
    project.renderOrder.at(-1).id = instanceId
    const parsed = await api.parseCustomProject(project, registry)
    assert.deepEqual(parsed.custom.states, {})
    assert.equal(parsed.custom.instances[0].id, instanceId)
  }
})
