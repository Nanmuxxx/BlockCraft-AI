/** Browser-safe wire protocol. No Runtime, commands, records, snapshots or credentials. */
export const LIMITS = Object.freeze({ requestBytes: 16_384, contextBytes: 10_000, blocks: 20, entities: 10,
  fields: 24, history: 4, promptChars: 1200, responseBytes: 32_768, messageChars: 1200, suggestions: 5 })
export class MochiError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}
export function check(ok, code = 'INVALID_INPUT', message = 'Mochi 数据格式无效。', status = 400) {
  if (!ok) throw new MochiError(code, message, status)
}
export const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length
export function object(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)))
}
export const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value) && redact(value) === value
const short = (value, max = 80) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
export function redact(value) {
  return String(value).replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g, '[已隐藏密钥]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏密钥]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]')
    .replace(/\b(api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^\s,"';}]+/gi, '$1=[已隐藏]')
}
export function validateContext(c) {
  object(c, ['appId', 'instanceId', 'revision', 'selectedBlockId', 'mode', 'blocks', 'entities', 'relations'])
  check(id(c.appId) && id(c.instanceId) && Number.isSafeInteger(c.revision) && c.revision >= 0)
  check(['blocks', 'run'].includes(c.mode))
  check(Array.isArray(c.blocks) && c.blocks.length <= LIMITS.blocks && Array.isArray(c.entities) && c.entities.length <= LIMITS.entities && Array.isArray(c.relations) && c.relations.length <= c.blocks.length)
  const blockIds = new Set(), entityIds = new Set()
  for (const e of c.entities) {
    object(e, ['id', 'name', 'fields']); check(id(e.id) && short(e.name) && !entityIds.has(e.id)); entityIds.add(e.id)
    check(Array.isArray(e.fields) && e.fields.length <= LIMITS.fields)
    const fields = new Set()
    for (const f of e.fields) {
      object(f, ['id', 'name', 'type']); check(id(f.id) && short(f.name) && ['text','number','boolean','date','select'].includes(f.type) && !fields.has(f.id)); fields.add(f.id)
    }
  }
  for (const b of c.blocks) {
    object(b, ['id', 'name', 'type', 'fieldIds', 'parameters']); check(id(b.id) && short(b.name) && short(b.type, 40) && !blockIds.has(b.id)); blockIds.add(b.id)
    check(Array.isArray(b.fieldIds) && b.fieldIds.length <= LIMITS.fields && b.fieldIds.every(id) && new Set(b.fieldIds).size === b.fieldIds.length)
    if (b.type === 'custom') {
      check(b.fieldIds.length === 0 && Array.isArray(b.parameters) && b.parameters.length <= LIMITS.fields)
      const names = new Set()
      for (const p of b.parameters) {
        object(p, ['name', 'type', 'required'])
        check(short(p.name) && !names.has(p.name) && ['string', 'number', 'integer', 'boolean', 'object'].includes(p.type) && typeof p.required === 'boolean'); names.add(p.name)
      }
    } else check(b.parameters === undefined)
  }
  check(c.selectedBlockId === null || blockIds.has(c.selectedBlockId))
  const bound = new Set()
  for (const r of c.relations) {
    object(r, ['blockId', 'entityId']); check(blockIds.has(r.blockId) && c.blocks.find(b => b.id === r.blockId).type !== 'custom' && entityIds.has(r.entityId) && !bound.has(r.blockId)); bound.add(r.blockId)
    const entity = c.entities.find(e => e.id === r.entityId)
    check(c.blocks.find(b => b.id === r.blockId).fieldIds.every(fid => entity.fields.some(f => f.id === fid)))
  }
  check(c.blocks.every(b => b.type === 'custom' || bound.has(b.id)))
  check(bytes(c) <= LIMITS.contextBytes, 'CONTEXT_TOO_LARGE', '当前结构较大，请缩小分析范围。')
  return c
}
/** Deliberately pick every property; never spread a host view or PlanRequest. */
export function projectContext(source) {
  const c = { appId: source.appId, instanceId: source.instanceId, revision: source.revision,
    selectedBlockId: source.selectedBlockId ?? null, mode: source.mode,
    blocks: source.blocks.map(b => ({ id: b.id, name: redact(b.name), type: b.type, fieldIds: [...(b.fieldIds ?? [])], ...(b.type === 'custom' ? { parameters: (b.parameters ?? []).map(p => ({ name: redact(p.name), type: p.type, required: p.required })) } : {}) })),
    entities: source.entities.map(e => ({ id: e.id, name: redact(e.name), fields: e.fields.map(f => ({ id: f.id, name: redact(f.name), type: f.type })) })),
    relations: source.relations.map(r => ({ blockId: r.blockId, entityId: r.entityId })) }
  return validateContext(c)
}
export function validateRequest(input) {
  object(input, ['version', 'kind', 'context', 'prompt', 'history', 'event'])
  check(input.version === 1 && ['chat', 'proactive'].includes(input.kind))
  validateContext(input.context)
  check(Array.isArray(input.history) && input.history.length <= LIMITS.history && input.history.every(p => short(p, LIMITS.promptChars)))
  if (input.kind === 'chat') check(short(input.prompt, LIMITS.promptChars) && input.event === undefined)
  else {
    check(input.prompt === undefined && input.history.length === 0)
    object(input.event, ['type']); check(['project-opened', 'structure-changed', 'selection-settled'].includes(input.event.type))
  }
  check(bytes(input) <= LIMITS.requestBytes, 'INPUT_TOO_LARGE', '请求超出大小限制。', 413)
  // Re-project at server egress; never forward the raw HTTP object.
  return { version: 1, kind: input.kind, context: projectContext(input.context),
    history: input.history.map(redact), ...(input.kind === 'chat' ? { prompt: redact(input.prompt) } : { event: { type: input.event.type } }) }
}
export function binding(c) { return { appId: c.appId, instanceId: c.instanceId, revision: c.revision, selectedBlockId: c.selectedBlockId, mode: c.mode } }
export function validateAdvice(value, context) {
  object(value, ['message', 'suggestions'])
  check(short(value.message, LIMITS.messageChars) && Array.isArray(value.suggestions) && value.suggestions.length <= LIMITS.suggestions, 'AI_INVALID_RESPONSE', 'Mochi 回复不符合协议。', 502)
  for (const s of value.suggestions) {
    object(s, ['text','reason','blockId','priority','requiresUserAction','kind'])
    check(short(s.text, 240) && short(s.reason, 400) && (s.blockId === null || context.blocks.some(b => b.id === s.blockId)) &&
      ['low','medium','high'].includes(s.priority) && typeof s.requiresUserAction === 'boolean' && ['explain','design-change'].includes(s.kind) &&
      (s.kind !== 'design-change' || s.requiresUserAction), 'AI_INVALID_RESPONSE', 'Mochi 建议无效或引用了未知积木。', 502)
  }
  return value
}
export function fingerprint(s) {
  return JSON.stringify([s.blockId, s.kind, s.text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '')])
}
