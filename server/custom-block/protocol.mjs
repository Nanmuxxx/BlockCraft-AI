import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Fixed trusted paths. Generated components never enter this module loader.
export const protocol = require('./.generated/custom-block/index.js')
export const json = require('./.generated/custom-block/json.js')

export class GenerationError extends Error {
  constructor(code) { super(code); this.name = 'GenerationError'; this.code = code }
}
export function ensure(condition, code) { if (!condition) throw new GenerationError(code) }
export function guarded(code, action) {
  try { return action() } catch (error) {
    if (error instanceof GenerationError) throw error
    throw new GenerationError(code)
  }
}
export const LIMITS = Object.freeze({
  requirementChars: 4000, outputBytes: 393216, upstreamBytes: 1048576,
  sourceFileBytes: 65536, sourceFiles: 8, sourceTokens: 24000, sourceNesting: 96,
  timeoutMs: 30000, storeBytes: 524288,
})
export function validateRequest(input) {
  return guarded('INVALID_REQUEST', () => {
    protocol.assertJson(input, { ...protocol.MESSAGE_LIMITS, maxBytes: 24576 })
    json.object(input); json.keys(input, ['contractVersion', 'requestId', 'definitionId', 'requirement'])
    json.id(input.requestId); json.id(input.definitionId)
    ensure(input.contractVersion === 1, 'INVALID_REQUEST')
    ensure(typeof input.requirement === 'string' && input.requirement.trim().length > 0 && input.requirement.length <= LIMITS.requirementChars, 'INVALID_REQUEST')
    return structuredClone(input)
  })
}
