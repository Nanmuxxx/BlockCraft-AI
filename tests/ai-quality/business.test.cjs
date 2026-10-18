const test = require('node:test')
const assert = require('node:assert/strict')
const { cases, matches, evaluateSpec, loadFixture } = require('./evaluate.cjs')
const { initializeGeneratedProject, createAppRuntime, metricValue, parseFieldDraft, assertProjectState } = require('./model.cjs')

let networkCalls = 0
const originalFetch = global.fetch
global.fetch = () => { networkCalls++; throw new Error('Business acceptance must stay offline') }
test.after(() => { global.fetch = originalFetch; assert.equal(networkCalls, 0) })

function setup(contract) {
  const spec = loadFixture(contract.id)
  const report = evaluateSpec(spec, contract)
  assert.equal(report.ok, true, JSON.stringify(report.errors))
  return { spec, bindings: report.bindings, runtime: createAppRuntime(initializeGeneratedProject(spec)) }
}

// Semantic keys belong to the acceptance contract, never to AppSpec JSON.
function valuesFor(contractEntity, spec, bindings, values) {
  const entity = spec.entities.find(entity => entity.id === bindings.entities[contractEntity.key])
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const field = entity.fields.find(field => field.id === bindings.fields[contractEntity.key][key])
    assert.ok(field, `Unknown scenario field: ${contractEntity.key}.${key}`)
    if (field.type === 'select') {
      const need = contractEntity.fields.find(field => field.key === key)
      const aliases = need.options.find(aliases => matches(value, aliases))
      value = field.options.find(option => matches(option, aliases))
      assert.notEqual(value, undefined)
    }
    return [field.id, value]
  }))
}

for (const contract of cases) for (const expected of contract.entities) {
  test(`${contract.title} / ${expected.names[0]}: form → list records → edit → delete updates real metrics`, () => {
    const { spec, runtime, bindings } = setup(contract)
    const entityId = bindings.entities[expected.key]
    const entity = spec.entities.find(entity => entity.id === entityId)
    const form = spec.blocks.find(block => block.id === bindings.modules[expected.modules.find(module => module.type === 'form').key])
    const list = spec.blocks.find(block => block.id === bindings.modules[expected.modules.find(module => module.type === 'list').key])
    const initial = runtime.getSnapshot()
    const metricChecks = stage => {
      for (const need of expected.modules.filter(module => module.type === 'metric')) {
        const block = spec.blocks.find(block => block.id === bindings.modules[need.key])
        assert.equal(metricValue(runtime.getSnapshot(), block), need.values[stage], need.key)
      }
    }
    const create = (id, values) => {
      const typed = valuesFor(expected, spec, bindings, values)
      const draft = Object.fromEntries(Object.entries(typed).map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value)]))
      const parsed = parseFieldDraft(entity.fields.filter(field => form.fieldIds.includes(field.id)), draft)
      assert.deepEqual(parsed, typed)
      const result = runtime.updateRecords({ type: 'create', entityId, record: { id, values: parsed } })
      assert.equal(result.ok, true, JSON.stringify(result))
      assertProjectState(runtime.getSnapshot())
    }
    create('qa-first', expected.scenario.sample)
    create('qa-second', expected.scenario.second)
    const beforeEdit = runtime.getSnapshot()
    assert.equal(beforeEdit.revision, 2)
    assert.equal(beforeEdit.records[entityId].length, 2)
    const listBinding = spec.relations.find(link => link.blockId === list.id)
    assert.equal(listBinding.entityId, entityId)
    for (const key of expected.modules.find(module => module.type === 'list').fields) {
      const fieldId = bindings.fields[expected.key][key]
      assert.ok(list.fieldIds.includes(fieldId))
      assert.ok(Object.hasOwn(beforeEdit.records[listBinding.entityId][0].values, fieldId))
    }
    metricChecks(0)

    const patch = valuesFor(expected, spec, bindings, expected.scenario.update)
    const updated = { ...beforeEdit.records[entityId][0].values, ...patch }
    const edit = runtime.updateRecords({ type: 'update', entityId, recordId: 'qa-first', values: updated })
    assert.equal(edit.ok, true, JSON.stringify(edit))
    assert.deepEqual(runtime.getSnapshot().records[entityId][0].values, updated)
    assert.equal(runtime.getSnapshot().revision, 3)
    metricChecks(1)
    const deletion = runtime.updateRecords({ type: 'delete', entityId, recordId: 'qa-second' })
    assert.equal(deletion.ok, true)
    assert.equal(runtime.getSnapshot().records[entityId].length, 1)
    assert.equal(runtime.getSnapshot().revision, 4)
    metricChecks(2)
    assertProjectState(runtime.getSnapshot())
    assert.equal(initial.records[entityId].length, 0, 'old snapshot stays unchanged')
    assert.equal(beforeEdit.records[entityId].length, 2)
    assert.notDeepEqual(beforeEdit.records[entityId][0].values, updated)
    assert.equal(runtime.updateRecords({ type: 'delete', entityId, recordId: 'qa-first' }).ok, true)
    for (const need of expected.modules.filter(module => module.type === 'metric')) {
      assert.equal(metricValue(runtime.getSnapshot(), spec.blocks.find(block => block.id === bindings.modules[need.key])), 0)
    }
  })
  test(`${contract.title} / ${expected.names[0]}: invalid business input never partly commits`, () => {
    const { spec, runtime, bindings } = setup(contract)
    const entityId = bindings.entities[expected.key]
    const valid = valuesFor(expected, spec, bindings, expected.scenario.sample)
    assert.equal(runtime.updateRecords({ type: 'create', entityId, record: { id: 'qa-first', values: valid } }).ok, true)
    const before = runtime.getSnapshot()
    const invalids = []
    for (const need of expected.fields) {
      const fieldId = bindings.fields[expected.key][need.key]
      if (need.required) {
        const missing = { ...valid }; delete missing[fieldId]; invalids.push(missing)
      }
      const invalidValue = { text: 12, number: '12', boolean: 'false', date: '2026-02-30', select: '不在选项内的值' }[need.type]
      invalids.push({ ...valid, [fieldId]: invalidValue })
    }
    for (const values of invalids) {
      const result = runtime.updateRecords({ type: 'update', entityId, recordId: 'qa-first', values })
      assert.equal(result.ok, false, JSON.stringify(values))
      assert.strictEqual(runtime.getSnapshot(), before)
    }
  })
}

// Risk probes deliberately assert v1's current limitations, not desired future
// business constraints. A passing test here is evidence to disclose, not a feature.
test('v1 risk: club count is rows, duplicate contact is accepted', () => {
  const contract = cases.find(item => item.id === 'club-registration')
  const { spec, bindings, runtime } = setup(contract)
  const entity = contract.entities[0]
  const values = valuesFor(entity, spec, bindings, entity.scenario.sample)
  for (const id of ['duplicate-a', 'duplicate-b']) {
    assert.equal(runtime.updateRecords({ type: 'create', entityId: bindings.entities.applicants, record: { id, values } }).ok, true)
  }
  assert.equal(metricValue(runtime.getSnapshot(), spec.blocks.find(block => block.id === bindings.modules['application-count'])), 2)
})

test('v1 risk: negative training minutes remain schema-valid without range constraints', () => {
  const contract = cases.find(item => item.id === 'fitness-plan')
  const { spec, bindings, runtime } = setup(contract)
  const entity = contract.entities.find(entity => entity.key === 'workouts')
  const values = valuesFor(entity, spec, bindings, { ...entity.scenario.sample, minutes: -10 })
  assert.equal(runtime.updateRecords({ type: 'create', entityId: bindings.entities.workouts, record: { id: 'negative-duration', values } }).ok, true)
  assert.equal(metricValue(runtime.getSnapshot(), spec.blocks.find(block => block.id === bindings.modules['workout-sum'])), -10)
})

test('v1 risk: reading book-title text is not a foreign key, same-day entries are not unique days', () => {
  const contract = cases.find(item => item.id === 'reading-log')
  const { spec, bindings, runtime } = setup(contract)
  const entity = contract.entities.find(entity => entity.key === 'sessions')
  const values = valuesFor(entity, spec, bindings, { ...entity.scenario.sample, title: '不在书架的书' })
  for (const id of ['same-day-a', 'same-day-b']) {
    assert.equal(runtime.updateRecords({ type: 'create', entityId: bindings.entities.sessions, record: { id, values } }).ok, true)
  }
  assert.equal(runtime.getSnapshot().records[bindings.entities.books].length, 0)
  assert.equal(runtime.getSnapshot().records[bindings.entities.sessions].length, 2)
})

test('v1 risk: event capacity is reference data, excessive tickets are not prevented', () => {
  const contract = cases.find(item => item.id === 'event-registration')
  const { spec, bindings, runtime } = setup(contract)
  const event = contract.entities.find(entity => entity.key === 'events')
  const registration = contract.entities.find(entity => entity.key === 'registrations')
  const eventValues = valuesFor(event, spec, bindings, { ...event.scenario.sample, capacity: 1 })
  const registrationValues = valuesFor(registration, spec, bindings, { ...registration.scenario.sample, tickets: 100 })
  assert.equal(runtime.updateRecords({ type: 'create', entityId: bindings.entities.events, record: { id: 'limited-event', values: eventValues } }).ok, true)
  assert.equal(runtime.updateRecords({ type: 'create', entityId: bindings.entities.registrations, record: { id: 'over-capacity', values: registrationValues } }).ok, true)
  assert.equal(metricValue(runtime.getSnapshot(), spec.blocks.find(block => block.id === bindings.modules['ticket-sum'])), 100)
})

test('v1 risk: task count does not become remaining tasks when status changes', () => {
  const contract = cases.find(item => item.id === 'personal-tasks')
  const { spec, bindings, runtime } = setup(contract)
  const entity = contract.entities[0]
  const values = valuesFor(entity, spec, bindings, { ...entity.scenario.sample, status: '已完成' })
  assert.equal(runtime.updateRecords({ type: 'create', entityId: bindings.entities.tasks, record: { id: 'done-task', values } }).ok, true)
  assert.equal(metricValue(runtime.getSnapshot(), spec.blocks.find(block => block.id === bindings.modules['task-count'])), 1)
})
