const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { cases, evaluateSpec, evaluateDiversity, domainFingerprint, loadFixture, evaluateDirectory } = require('./evaluate.cjs')
const { assertAppSpec, assertProjectState, initializeGeneratedProject, generateProject } = require('./model.cjs')

let networkCalls = 0
const originalFetch = global.fetch
global.fetch = () => { networkCalls++; throw new Error('Quality tests must stay offline') }
test.after(() => { global.fetch = originalFetch; assert.equal(networkCalls, 0) })
const errorsFor = (spec, contract = cases[0]) => evaluateSpec(spec, contract).errors.map(error => error.code)
const passes = (spec, contract) => {
  const report = evaluateSpec(spec, contract)
  assert.equal(report.ok, true, JSON.stringify(report.errors))
  return report
}

function varyIdsAndOrder(input) {
  const spec = structuredClone(input)
  const ids = new Map()
  const assign = value => { ids.set(value.id, `alternative-${ids.size}`); value.id = ids.get(value.id) }
  assign(spec)
  for (const entity of spec.entities) { assign(entity); entity.fields.forEach(assign); entity.fields.reverse() }
  spec.blocks.forEach(assign)
  spec.relations.forEach(assign)
  for (const block of spec.blocks) {
    if (block.fieldIds) block.fieldIds = block.fieldIds.map(id => ids.get(id)).reverse()
    if (block.fieldId) block.fieldId = ids.get(block.fieldId)
    block.name = `另一个模块名称 ${block.id}`
  }
  for (const relation of spec.relations) { relation.blockId = ids.get(relation.blockId); relation.entityId = ids.get(relation.entityId) }
  for (const entity of spec.entities) for (const field of entity.fields) if (field.options) field.options.reverse()
  spec.name = '完全不同的应用标题'
  spec.entities.reverse(); spec.blocks.reverse(); spec.relations.reverse()
  return spec
}

function removeEntity(spec, id) {
  const blocks = new Set(spec.relations.filter(link => link.entityId === id).map(link => link.blockId))
  spec.entities = spec.entities.filter(entity => entity.id !== id)
  spec.blocks = spec.blocks.filter(block => !blocks.has(block.id))
  spec.relations = spec.relations.filter(link => !blocks.has(link.blockId))
}

for (const contract of cases) {
  test(`${contract.title}: generation adapter consumes a mocked local response without exact JSON expectations`, async t => {
    let calls = 0
    const spec = varyIdsAndOrder(loadFixture(contract.id))
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls++
      assert.equal(url, '/api/ai/generate')
      assert.equal(options.method, 'POST')
      assert.equal(JSON.parse(options.body).idea, contract.prompt)
      return Response.json(spec)
    })
    const state = await generateProject(contract.prompt)
    passes(state.spec, contract)
    assertProjectState(state)
    assert.equal(calls, 1)
  })
  test(`${contract.title}: reference fixture validates, initializes empty and covers business requirements`, () => {
    const spec = loadFixture(contract.id)
    const before = JSON.stringify(spec)
    passes(spec, contract)
    assertAppSpec(spec)
    const state = initializeGeneratedProject(spec)
    assertProjectState(state)
    assert.equal(state.revision, 0)
    assert.equal(Object.keys(state.records).length, spec.entities.length)
    assert.ok(Object.values(state.records).every(records => records.length === 0))
    assert.equal(Object.keys(state.blockPositions).length, spec.blocks.length)
    assert.equal(JSON.stringify(spec), before)
    assert.notStrictEqual(spec, state.spec)
    assert.ok(contract.prompt.length > 40)
    assert.ok(contract.supported.length > 0)
    assert.ok(contract.pending.every(item => item.capability && item.reason && item.fallback))
  })
  test(`${contract.title}: accepts different IDs, titles, array order, aliases and extra valid fields/modules`, () => {
    const spec = varyIdsAndOrder(loadFixture(contract.id))
    const mapping = passes(spec, contract).bindings
    for (const expected of contract.entities) {
      const entity = spec.entities.find(entity => entity.id === mapping.entities[expected.key])
      entity.name = expected.names.at(-1)
      for (const need of expected.fields) {
        const field = entity.fields.find(field => field.id === mapping.fields[expected.key][need.key])
        field.name = need.names.at(-1)
        if (need.options) field.options = need.options.map(aliases => aliases.at(-1)).reverse()
      }
    }
    spec.entities[0].fields.push({ id: 'extra-source', name: '录入来源', type: 'text', required: false })
    const block = { id: 'extra-list', type: 'list', name: '额外资料视图', fieldIds: [spec.entities[0].fields[0].id] }
    spec.blocks.push(block)
    spec.relations.push({ id: 'extra-binding', type: 'dataBinding', blockId: block.id, entityId: spec.entities[0].id })
    passes(spec, contract)
  })
  test(`${contract.title}: missing each necessary entity or module fails quality even if v1 shape is legal`, () => {
    for (const entity of loadFixture(contract.id).entities) {
      const spec = loadFixture(contract.id)
      removeEntity(spec, entity.id)
      assertAppSpec(spec)
      assert.ok(errorsFor(spec, contract).includes('BUSINESS_ENTITY'))
    }
    for (const block of loadFixture(contract.id).blocks) {
      const spec = loadFixture(contract.id)
      spec.blocks = spec.blocks.filter(candidate => candidate.id !== block.id)
      spec.relations = spec.relations.filter(link => link.blockId !== block.id)
      assertAppSpec(spec)
      assert.ok(errorsFor(spec, contract).includes('BUSINESS_MODULE'), block.id)
    }
  })
  test(`${contract.title}: every required business field must carry its domain meaning`, () => {
    const original = loadFixture(contract.id)
    for (let entityIndex = 0; entityIndex < original.entities.length; entityIndex++) {
      for (let fieldIndex = 0; fieldIndex < original.entities[entityIndex].fields.length; fieldIndex++) {
        const spec = structuredClone(original)
        spec.entities[entityIndex].fields[fieldIndex].name = '通用描述'
        assertAppSpec(spec)
        assert.ok(errorsFor(spec, contract).includes('BUSINESS_FIELD'))
      }
    }
  })
}

const malformed = {
  'null': () => null,
  'ProjectState wrapper instead of AppSpec': spec => ({ revision: 0, spec, records: {}, blockPositions: {} }),
  'wrong version': spec => ({ ...spec, version: 2 }),
  'executable extra configuration': spec => ({ ...spec, script: 'alert(1)' }),
  'duplicate global IDs': spec => { spec.blocks[0].id = spec.entities[0].id; return spec },
  'dangling entity reference': spec => { spec.relations[0].entityId = 'missing-entity'; return spec },
  'dangling block reference': spec => { spec.relations[0].blockId = 'missing-block'; return spec },
  'missing binding': spec => { spec.relations.pop(); return spec },
  'multiple bindings per block': spec => { spec.relations.push({ ...spec.relations[0], id: 'duplicate-binding' }); return spec },
  'unknown field reference': spec => { spec.blocks[0].fieldIds[0] = 'missing-field'; return spec },
  'empty form': spec => { spec.blocks[0].fieldIds = []; return spec },
  'empty list': spec => { spec.blocks[1].fieldIds = []; return spec },
  'form hides required field': spec => { spec.blocks[0].fieldIds.shift(); return spec },
  'empty select choices': spec => { spec.entities[0].fields[1].options = []; return spec },
  'unknown block type': spec => { spec.blocks[0] = { id: 'fake-timer', name: '训练计时器', type: 'timer' }; return spec },
}
for (const [name, mutate] of Object.entries(malformed)) test(`protocol rejection: ${name}`, () => {
  assert.ok(errorsFor(mutate(loadFixture(cases[0].id))).includes('INVALID_SPEC'))
})

test('v1 quality and diversity reject schema-valid v2 data apps', () => {
  const spec = { ...loadFixture(cases[0].id), version: 2 }
  assertAppSpec(spec)
  assert.ok(errorsFor(spec).includes('INVALID_SPEC'))
  assert.throws(() => domainFingerprint(spec), /requires AppSpec v1/)
  const report = evaluateDiversity([{ caseId: 'v2-data', spec }])
  assert.equal(report.ok, false)
  assert.equal(report.errors[0].code, 'DIVERSITY_INVALID_SPEC')
})

test('cross-entity fields and nonnumeric/wrong-entity metric references are invalid', () => {
  const contract = cases.find(item => item.id === 'reading-log')
  for (const mutate of [
    spec => { spec.blocks[0].fieldIds.push(spec.entities[1].fields[0].id) },
    spec => { spec.blocks.find(block => block.aggregation === 'sum').fieldId = spec.entities[1].fields[0].id },
    spec => { spec.relations.find(link => link.blockId === spec.blocks.find(block => block.aggregation === 'sum').id).entityId = spec.entities[0].id },
  ]) {
    const spec = loadFixture(contract.id); mutate(spec)
    assert.ok(errorsFor(spec, contract).includes('INVALID_SPEC'))
  }
})

test('legal-but-empty apps, fieldless entities, count-only and orphan entities are incomplete', () => {
  const samples = [
    [{ version: 1, id: 'empty', name: '空应用', entities: [], blocks: [], relations: [] }, 'EMPTY_ENTITIES'],
    [{ ...loadFixture(cases[0].id), blocks: [], relations: [] }, 'EMPTY_BLOCKS'],
    [{ version: 1, id: 'fieldless', name: '空对象', entities: [{ id: 'object', name: '业务对象', fields: [] }], blocks: [{ id: 'count', name: '记录数', type: 'metric', aggregation: 'count' }], relations: [{ id: 'binding', type: 'dataBinding', blockId: 'count', entityId: 'object' }] }, 'EMPTY_FIELDS'],
  ]
  const orphan = loadFixture(cases[0].id)
  orphan.entities.push({ id: 'unused', name: '孤立对象', fields: [{ id: 'unused-text', name: '说明', type: 'text', required: false }] })
  samples.push([orphan, 'UNUSABLE_ENTITY'])
  const countOnly = loadFixture(cases[0].id)
  countOnly.blocks = countOnly.blocks.filter(block => block.type === 'metric')
  countOnly.relations = countOnly.relations.filter(link => link.blockId === countOnly.blocks[0].id)
  samples.push([countOnly, 'UNUSABLE_ENTITY'])
  for (const [spec, code] of samples) {
    assertAppSpec(spec) // Documents the current schema/quality boundary.
    assert.ok(errorsFor(spec).includes(code))
  }
})

test('wrong field types, weakened required flags and missing business select options fail', () => {
  for (const [mutate, code] of [
    [spec => { spec.entities[0].fields[0].type = 'number' }, 'FIELD_TYPE'],
    [spec => { spec.entities[0].fields[0].required = false }, 'REQUIRED_FIELD'],
    [spec => { spec.entities[0].fields[1].options.pop() }, 'SELECT_OPTIONS'],
  ]) {
    const spec = loadFixture(cases[0].id); mutate(spec)
    assertAppSpec(spec)
    assert.ok(errorsFor(spec).includes(code))
  }
})

test('optional fields must be usable in required modules; schema-only decoration fails', () => {
  const spec = loadFixture(cases[0].id)
  const optional = spec.entities[0].fields.find(field => !field.required).id
  for (const block of spec.blocks) if (block.fieldIds) block.fieldIds = block.fieldIds.filter(id => id !== optional)
  assertAppSpec(spec)
  assert.ok(errorsFor(spec).includes('BUSINESS_MODULE'))
})

test('ambiguous business entity or field labels cannot silently bind to the first match', () => {
  const duplicateEntity = loadFixture(cases[0].id)
  duplicateEntity.entities.push({ id: 'second-applicants', name: '报名者', fields: [{ id: 'second-name', name: '姓名', type: 'text', required: false }] })
  assert.ok(errorsFor(duplicateEntity).includes('BUSINESS_ENTITY'))
  const duplicateField = loadFixture(cases[0].id)
  duplicateField.entities[0].fields.push({ id: 'second-name', name: '姓名', type: 'text', required: false })
  assert.ok(errorsFor(duplicateField).includes('BUSINESS_FIELD'))
})

test('right aggregate must bind the business measure and entity, not any numeric field or count', () => {
  const contract = cases.find(item => item.id === 'reading-log')
  const spec = loadFixture(contract.id)
  const sum = spec.blocks.find(block => block.aggregation === 'sum')
  const entity = spec.entities.find(entity => entity.id === spec.relations.find(link => link.blockId === sum.id).entityId)
  entity.fields.push({ id: 'unrelated-number', name: '其他数字', type: 'number', required: false })
  sum.fieldId = 'unrelated-number'
  assertAppSpec(spec)
  assert.ok(errorsFor(spec, contract).includes('BUSINESS_MODULE'))
  sum.aggregation = 'count'; delete sum.fieldId
  assertAppSpec(spec)
  assert.ok(errorsFor(spec, contract).includes('BUSINESS_MODULE'))
  const eventContract = cases.find(item => item.id === 'event-registration')
  const events = loadFixture(eventContract.id)
  const report = passes(events, eventContract)
  events.relations.find(link => link.blockId === report.bindings.modules['registration-count']).entityId = report.bindings.entities.events
  assertAppSpec(events)
  assert.ok(errorsFor(events, eventContract).includes('BUSINESS_MODULE'))
})

for (const name of ['训练计时器', '训练日历', '自动训练编排', '阅读连续打卡天数', '完成率', '去重人数', '扫码签到', '名额限制', '待办数量']) {
  test(`a renamed v1 block does not implement ${name}`, () => {
    const spec = loadFixture(cases[0].id)
    spec.blocks[1].name = name
    assertAppSpec(spec)
    assert.ok(errorsFor(spec).includes('UNSUPPORTED_CLAIM'))
  })
}

test('five domains have different fingerprints, even after ID/order/title changes', () => {
  const entries = cases.map(contract => ({ caseId: contract.id, spec: loadFixture(contract.id) }))
  assert.equal(evaluateDiversity(entries).ok, true)
  for (const { spec } of entries) assert.equal(domainFingerprint(varyIdsAndOrder(spec)), domainFingerprint(spec))
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    assert.notEqual(domainFingerprint(entries[i].spec), domainFingerprint(entries[j].spec))
  }
})

test('one template copied five times with changed IDs and all titles is rejected', () => {
  const entries = cases.map((contract, index) => {
    const spec = varyIdsAndOrder(loadFixture(cases[0].id))
    spec.name = contract.title
    spec.entities.forEach(entity => { entity.name = `新实体名称 ${index}` })
    return { caseId: contract.id, spec }
  })
  const report = evaluateDiversity(entries)
  assert.equal(report.ok, false)
  assert.equal(report.errors.filter(error => error.code === 'HOMOGENEOUS_RESULTS').length, 4)
})

test('changing only modules cannot substitute for entity or field differences', () => {
  const original = loadFixture(cases[0].id)
  const changed = structuredClone(original)
  const block = { ...changed.blocks[1], id: 'another-list', name: '更多模块' }
  changed.blocks.push(block)
  changed.relations.push({ ...changed.relations[1], id: 'another-binding', blockId: block.id })
  assertAppSpec(changed)
  assert.equal(evaluateDiversity([{ caseId: 'first', spec: original }, { caseId: 'second', spec: changed }]).ok, false)
})

test('all 20 wrong-domain substitutions fail even with the requested app title', () => {
  for (const expected of cases) for (const actual of cases) if (expected.id !== actual.id) {
    const spec = loadFixture(actual.id)
    spec.name = expected.title
    assert.equal(evaluateSpec(spec, expected).ok, false, `${actual.id} must not satisfy ${expected.id}`)
  }
})

test('local-output CLI returns structured success/failure and never needs AI configuration', () => {
  assert.equal(evaluateDirectory().ok, true)
  const cli = path.join(__dirname, 'check.cjs')
  const success = spawnSync(process.execPath, [cli], { encoding: 'utf8', env: { ...process.env, DEEPSEEK_API_KEY: '', DEEPSEEK_MODEL: '' } })
  assert.equal(success.status, 0, success.stderr)
  assert.equal(JSON.parse(success.stdout).results.length, 5)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blockcraft-quality-'))
  try {
    fs.writeFileSync(path.join(directory, `${cases[0].id}.json`), '{not-json')
    const failure = spawnSync(process.execPath, [cli, directory], { encoding: 'utf8' })
    assert.equal(failure.status, 1, failure.stderr)
    const report = JSON.parse(failure.stdout)
    assert.equal(report.ok, false)
    assert.ok(report.results.every(result => result.errors[0].code === 'INPUT_ERROR'))
    assert.equal(evaluateDiversity([{ caseId: 'broken', spec: null }]).errors[0].code, 'DIVERSITY_INVALID_SPEC')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
