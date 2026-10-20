import { createHash } from 'node:crypto'

export const CONTINUITY_POLICY = Object.freeze({
  id: 'budget-continuity-v1',
  target: Object.freeze({ profile: 'production', version: 1 }),
  maxCalls: 3,
  maxSpendNano: 20_000_000_000,
  requiredConsumedCalls: 1,
  requiredConservativeReserveNano: 36_658_000,
})

const fail = code => { throw Object.assign(new Error(code), { code }) }
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const sha256Pattern = /^[a-f0-9]{64}$/

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function buildContinuityPlan({ source, target, sourceReceipt, importedSourceDigests = [] }) {
  if (!isRecord(source) || !isRecord(source.profile) || !isRecord(source.accounting)) fail('CONTINUITY_SOURCE_INVALID')
  if (!isRecord(target) || !isRecord(target.profile) || !isRecord(target.limits)) fail('CONTINUITY_TARGET_INVALID')
  if (source.profile.name !== 'local-smoke' || source.profile.version !== 2) fail('CONTINUITY_SOURCE_PROFILE_UNSUPPORTED')
  if (target.profile.name !== CONTINUITY_POLICY.target.profile || target.profile.version !== CONTINUITY_POLICY.target.version
    || target.policyId !== CONTINUITY_POLICY.id) fail('CONTINUITY_TARGET_POLICY_MISMATCH')
  if (target.limits.maxCalls !== CONTINUITY_POLICY.maxCalls || target.limits.maxSpendNano !== CONTINUITY_POLICY.maxSpendNano) fail('CONTINUITY_TARGET_LIMIT_MISMATCH')

  const { consumedCalls, conservativeReserveNano, unknownItems, uncertain } = source.accounting
  if (!Number.isSafeInteger(consumedCalls) || !Number.isSafeInteger(conservativeReserveNano)
    || !Array.isArray(unknownItems) || typeof uncertain !== 'boolean') fail('CONTINUITY_ACCOUNTING_UNKNOWN')
  if (unknownItems.length || uncertain) fail('CONTINUITY_ACCOUNTING_UNCERTAIN')
  if (consumedCalls !== CONTINUITY_POLICY.requiredConsumedCalls
    || conservativeReserveNano !== CONTINUITY_POLICY.requiredConservativeReserveNano) fail('CONTINUITY_ACCOUNTING_MISMATCH')

  if (!isRecord(sourceReceipt) || typeof sourceReceipt.reference !== 'string' || !sourceReceipt.reference
    || typeof sourceReceipt.digest !== 'string' || !sha256Pattern.test(sourceReceipt.digest)) fail('CONTINUITY_RECEIPT_INVALID')
  if (!Array.isArray(importedSourceDigests) || importedSourceDigests.some(digest => typeof digest !== 'string')) fail('CONTINUITY_IMPORT_INDEX_INVALID')
  if (importedSourceDigests.includes(sourceReceipt.digest)) fail('CONTINUITY_DUPLICATE_IMPORT')

  const openingDebit = Object.freeze({
    type: 'opening-debit',
    policyId: target.policyId,
    targetProfile: target.profile.name,
    targetVersion: target.profile.version,
    calls: consumedCalls,
    reservedNano: conservativeReserveNano,
    receiptReference: sourceReceipt.reference,
    receiptDigest: sourceReceipt.digest,
  })
  const planBody = Object.freeze({
    policyId: target.policyId,
    targetProfile: Object.freeze({ ...target.profile }),
    sourceProfile: Object.freeze({ ...source.profile }),
    openingDebit,
    limits: Object.freeze({ ...target.limits }),
    importedSourceDigests: Object.freeze([...importedSourceDigests, sourceReceipt.digest]),
  })
  return Object.freeze({ ...planBody, planDigest: createHash('sha256').update(canonical(planBody)).digest('hex') })
}
