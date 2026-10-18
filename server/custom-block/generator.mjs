import { createHash } from 'node:crypto'
import { ensure, validateRequest, GenerationError } from './protocol.mjs'
import { admitOutput } from './contract.mjs'

/** No HTTP route, no frontend import, no env-based implicit enablement. */
export function createGenerator({ enabled = false, provider, store } = {}) {
  let busy = false
  return Object.freeze({ async generate(input) {
    ensure(enabled === true, 'EXPERIMENT_DISABLED')
    ensure(provider && ['mock', 'deepseek'].includes(provider.kind) && typeof provider.generate === 'function' && typeof store?.put === 'function', 'GENERATOR_CONFIGURATION')
    ensure(!busy, 'GENERATOR_BUSY')
    const request = validateRequest(input)
    busy = true
    try {
      let output
      try { output = await provider.generate(request) } catch (error) {
        if (error instanceof GenerationError) throw error
        throw new GenerationError('PROVIDER_FAILED')
      }
      const entry = await admitOutput(request, output)
      const record = await store.put({ storageVersion: 1, status: 'pending-build', entry, provenance: {
        kind: provider.kind, requestId: request.requestId,
        requirementDigest: `sha256:${createHash('sha256').update('blockcraft:requirement:v1\n').update(request.requirement, 'utf8').digest('hex')}`,
      } })
      return {
        reference: { definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest },
        status: 'pending-build', provenance: record.provenance,
        // Separate facts: schema/digest admission grants neither quality nor execution.
        validation: 'source-admitted', requirementsReview: 'not-performed',
        build: 'not-attempted', execution: 'denied', bcIntegration: 'not-connected',
      }
    } finally { busy = false }
  } })
}
