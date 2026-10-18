import type { MochiHostContext } from './MochiTypes'

export type MochiSuggestionSource = 'local_rule' | 'deepseek'
export type MochiSuggestionRule = 'form-missing-contact-field' | 'contact-not-in-form' | 'contact-not-in-list'

export interface MochiRecommendation {
  id: string
  ruleId: MochiSuggestionRule
  source: MochiSuggestionSource
  entityId: string
  affectedBlockIds: string[]
  fingerprint: string
  dedupeKey: string
  label: string
  prompt: string
  rationale: string
}

const contactTerms = ['联系方式', '联系', '电话', '手机', '邮箱', 'contact', 'phone', 'mobile', 'email']
const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s_\-()（）]/g, '')
const looksLikeContact = (value: string) => {
  const normalized = normalize(value)
  return contactTerms.some((term) => normalized.includes(normalize(term)))
}

function fingerprint(entityId: string, fields: Array<{ id: string; name: string }>, blocks: Array<{ id: string; type: string; fieldIds?: string[] }>) {
  const fieldPart = fields.map((field) => `${field.id}:${normalize(field.name)}`).sort().join(',')
  const blockPart = blocks.map((block) => `${block.id}:${block.type}:${(block.fieldIds ?? []).slice().sort().join(',')}`).sort().join('|')
  return `${entityId}::${fieldPart}::${blockPart}`
}

function makeRecommendation(ruleId: MochiSuggestionRule, entity: { id: string; name: string }, blocks: Array<{ id: string; type: string; fieldIds?: string[] }>, fields: Array<{ id: string; name: string }>, label: string, prompt: string, rationale: string): MochiRecommendation {
  const affectedBlockIds = blocks.map((block) => block.id).sort()
  const currentFingerprint = fingerprint(entity.id, fields, blocks)
  const dedupeKey = [ruleId, entity.id, affectedBlockIds.join(','), currentFingerprint].join('::')
  return { id: dedupeKey, ruleId, source: 'local_rule', entityId: entity.id, affectedBlockIds, fingerprint: currentFingerprint, dedupeKey, label, prompt, rationale }
}

/** Pure, deterministic rules. Missing field arrays are intentionally not interpreted. */
export function evaluateMochiSuggestions(context: MochiHostContext): MochiRecommendation[] {
  const selected = context.selectedBlockId ? context.blocks.find((block) => block.id === context.selectedBlockId) : undefined
  const candidateBlocks = selected ? [selected] : context.blocks
  const recommendations: MochiRecommendation[] = []

  for (const block of candidateBlocks) {
    if (block.type !== 'form' && block.type !== 'list') continue
    const relation = context.relations.find((item) => item.blockId === block.id)
    if (!relation) continue
    const entity = context.entities.find((item) => item.id === relation.entityId)
    if (!entity || !Array.isArray(entity.fields)) continue
    const fields = entity.fields.map(({ id, name }) => ({ id, name }))
    const contactField = entity.fields.find((field) => looksLikeContact(`${field.id} ${field.name}`))
    const relatedBlocks = context.blocks.filter((candidate) => {
      if (candidate.type !== 'form' && candidate.type !== 'list') return false
      return context.relations.some((item) => item.blockId === candidate.id && item.entityId === entity.id)
    })
    const relevantBlocks = relatedBlocks.length ? relatedBlocks : [block]

    if (!contactField) {
      if (block.type !== 'form') continue
      recommendations.push(makeRecommendation('form-missing-contact-field', entity, relevantBlocks, fields, '为表单补充联系方式', `为「${entity.name}」新增联系方式，并加入表单与相关列表`, '当前实体字段结构中没有可识别的联系方式字段。'))
      continue
    }

    if (block.type === 'form' && !(block.fieldIds ?? []).includes(contactField.id)) {
      recommendations.push(makeRecommendation('contact-not-in-form', entity, relevantBlocks, fields, '把联系方式加入表单', `将「${contactField.name}」加入「${block.name}」表单`, '实体已有联系方式字段，但当前表单没有展示它。'))
    }
    if (block.type === 'list' && !(block.fieldIds ?? []).includes(contactField.id)) {
      recommendations.push(makeRecommendation('contact-not-in-list', entity, relevantBlocks, fields, '把联系方式加入列表', `将「${contactField.name}」加入「${block.name}」列表`, '实体已有联系方式字段，但当前列表没有展示它。'))
    }
  }

  return dedupeMochiSuggestions(recommendations)
}

export function dedupeMochiSuggestions(recommendations: MochiRecommendation[], dismissedKeys: ReadonlySet<string> = new Set()) {
  const seen = new Set<string>()
  return recommendations.filter((recommendation) => {
    if (seen.has(recommendation.dedupeKey) || dismissedKeys.has(recommendation.dedupeKey)) return false
    seen.add(recommendation.dedupeKey)
    return true
  })
}

export function createMochiDismissalStore() {
  const dismissed = new Set<string>()
  return {
    dismiss(recommendation: Pick<MochiRecommendation, 'dedupeKey'>) { dismissed.add(recommendation.dedupeKey) },
    has(recommendation: Pick<MochiRecommendation, 'dedupeKey'>) { return dismissed.has(recommendation.dedupeKey) },
    filter(recommendations: MochiRecommendation[]) { return dedupeMochiSuggestions(recommendations, dismissed) },
  }
}
