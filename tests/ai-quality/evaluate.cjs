const fs = require('node:fs')
const path = require('node:path')
const { assertAppSpec } = require('./model.cjs')
const cases = require('./cases.cjs')

const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
const matches = (value, aliases) => aliases.some(alias => normalize(alias) === normalize(value))
const issue = (code, at, message) => ({ code, at, message })

// This evaluator measures the v1 business-data contract. The shared schema also
// accepts v2, whose interactive behavior needs a separate quality contract.
function assertQualitySpec(spec) {
  assertAppSpec(spec)
  if (spec.version !== 1) throw new Error('AI quality evaluation requires AppSpec v1')
}

// These are explicit claims of unavailable behavior, not a general language
// classifier. More subtle overpromises still need product review (see README).
const unsupportedClaims = [
  /倒计时|计时器|timer|countdown/i,
  /日历视图|训练日历|calendar/i,
  /完成率|完成百分比|completion\s*rate/i,
  /连续.{0,4}(天数|打卡)|streak/i,
  /自动.{0,4}(提醒|通知|排课|编排|审核)|自动去重|唯一.{0,4}(人数|报名)|去重人数/i,
  /扫码签到|在线收款|自动.{0,4}(候补|限额)|名额限制/i,
  /待办数量|未完成数量|待办数/i,
]

function evaluateSpec(spec, contract) {
  const errors = []
  const bindings = { entities: {}, fields: {}, modules: {} }
  const result = () => ({
    caseId: contract.id, ok: errors.length === 0, errors, bindings,
    // These limitations are always disclosed; a valid fixture does not implement them.
    pending: contract.pending,
  })
  try { assertQualitySpec(spec) }
  catch (error) {
    errors.push(issue('INVALID_SPEC', '$', error.message))
    return result()
  }
  if (!spec.entities.length) errors.push(issue('EMPTY_ENTITIES', 'entities', '应用没有业务实体'))
  if (!spec.blocks.length) errors.push(issue('EMPTY_BLOCKS', 'blocks', '应用没有可用积木'))
  for (const entity of spec.entities) {
    if (!entity.fields.length) errors.push(issue('EMPTY_FIELDS', `entity:${entity.id}`, '业务实体没有字段'))
    const linked = spec.relations.filter(link => link.entityId === entity.id).map(link => spec.blocks.find(b => b.id === link.blockId))
    if (!linked.some(block => block.type === 'form' || block.type === 'list')) {
      errors.push(issue('UNUSABLE_ENTITY', `entity:${entity.id}`, '实体没有录入或查看入口，只有统计也不完整'))
    }
  }
  for (const block of spec.blocks) {
    if (unsupportedClaims.some(pattern => pattern.test(block.name))) {
      errors.push(issue('UNSUPPORTED_CLAIM', `block:${block.id}`, `积木名称声称 v1 不支持的行为：${block.name}`))
    }
  }

  const usedEntities = new Set()
  for (const expected of contract.entities) {
    const at = `entity:${expected.key}`
    const candidates = spec.entities.filter(entity => matches(entity.name, expected.names))
    if (candidates.length !== 1 || usedEntities.has(candidates[0]?.id)) {
      errors.push(issue('BUSINESS_ENTITY', at, `需要唯一的业务对象：${expected.names.join(' / ')}`))
      continue
    }
    const entity = candidates[0]
    usedEntities.add(entity.id)
    bindings.entities[expected.key] = entity.id
    const fields = bindings.fields[expected.key] = {}
    const usedFields = new Set()
    for (const need of expected.fields) {
      const fieldAt = `${at}.${need.key}`
      const found = entity.fields.filter(field => matches(field.name, need.names))
      if (found.length !== 1 || usedFields.has(found[0]?.id)) {
        errors.push(issue('BUSINESS_FIELD', fieldAt, `缺少或歧义字段：${need.names.join(' / ')}`))
        continue
      }
      const field = found[0]
      usedFields.add(field.id)
      fields[need.key] = field.id
      if (field.type !== need.type) errors.push(issue('FIELD_TYPE', fieldAt, `应为 ${need.type}，实际为 ${field.type}`))
      if (need.required && !field.required) errors.push(issue('REQUIRED_FIELD', fieldAt, '必要业务字段必须必填'))
      if (need.options && field.type === 'select') {
        for (const aliases of need.options) {
          if (!field.options.some(option => matches(option, aliases))) {
            errors.push(issue('SELECT_OPTIONS', fieldAt, `缺少业务选项：${aliases.join(' / ')}`))
          }
        }
      }
    }

    const blocks = spec.relations.filter(link => link.entityId === entity.id).map(link => spec.blocks.find(b => b.id === link.blockId))
    for (const need of expected.modules) {
      const candidates = blocks.filter(block => {
        if (block.type !== need.type) return false
        if (need.type === 'metric') return block.aggregation === need.aggregation &&
          (need.aggregation === 'count' || (fields[need.field] && block.fieldId === fields[need.field]))
        return need.fields.every(key => fields[key] && block.fieldIds.includes(fields[key]))
      })
      if (!candidates.length) {
        errors.push(issue('BUSINESS_MODULE', `${at}.${need.key}`, `缺少绑定该实体且配置完整的 ${need.type}${need.aggregation ? `:${need.aggregation}` : ''} 模块`))
      } else bindings.modules[need.key] = candidates[0].id
    }
  }
  return result()
}

// Require domain data differences: different modules alone are insufficient.
// Ignore titles, all IDs, array order and modules. Keep entity grouping and actual
// field names, types, required flags and select choices.
const sorted = values => values.map(value => JSON.stringify(value)).sort()
function domainFingerprint(spec) {
  assertQualitySpec(spec)
  return JSON.stringify(sorted(spec.entities.map(entity => {
    const fieldShape = field => ({ name: normalize(field.name), type: field.type, required: field.required,
      ...(field.type === 'select' ? { options: field.options.map(normalize).sort() } : {}) })
    return {
      fields: sorted(entity.fields.map(fieldShape)),
    }
  })))
}

function evaluateDiversity(entries) {
  const errors = []
  const seen = new Map()
  for (const { caseId, spec } of entries) {
    let fingerprint
    try { fingerprint = domainFingerprint(spec) }
    catch (error) { errors.push(issue('DIVERSITY_INVALID_SPEC', caseId, error.message)); continue }
    if (seen.has(fingerprint)) errors.push(issue('HOMOGENEOUS_RESULTS', caseId, `与 ${seen.get(fingerprint)} 使用相同实体字段，仅改标题、ID、模块或顺序不算业务差异`))
    else seen.set(fingerprint, caseId)
  }
  return { ok: errors.length === 0, errors }
}

function loadFixture(caseId, directory = path.join(__dirname, 'fixtures')) {
  return JSON.parse(fs.readFileSync(path.join(directory, `${caseId}.json`), 'utf8'))
}

function evaluateDirectory(directory = path.join(__dirname, 'fixtures')) {
  const entries = []
  const results = cases.map(contract => {
    try {
      const spec = loadFixture(contract.id, directory)
      entries.push({ caseId: contract.id, spec })
      return evaluateSpec(spec, contract)
    } catch (error) {
      return { caseId: contract.id, ok: false, errors: [issue('INPUT_ERROR', contract.id, error.message)] }
    }
  })
  const diversity = evaluateDiversity(entries)
  return { ok: results.every(result => result.ok) && diversity.ok, source: path.resolve(directory), results, diversity }
}

module.exports = { cases, matches, evaluateSpec, evaluateDiversity, domainFingerprint, loadFixture, evaluateDirectory }
