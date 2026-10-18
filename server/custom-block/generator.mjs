import { createHash } from 'node:crypto'
import { ensure, validateRequest, GenerationError } from './protocol.mjs'
import { admitOutput } from './contract.mjs'
import { abortable } from '../ai-abort.mjs'

/** No HTTP route, no frontend import, no env-based implicit enablement. */
export function createGenerator({ enabled = false, provider, store } = {}) {
  let busy = false
  return Object.freeze({ async generate(input, { signal } = {}) {
    ensure(enabled === true, 'EXPERIMENT_DISABLED')
    ensure(provider && ['mock', 'deepseek'].includes(provider.kind) && typeof provider.generate === 'function' && typeof store?.put === 'function', 'GENERATOR_CONFIGURATION')
    ensure(!busy, 'GENERATOR_BUSY')
    const request = validateRequest(input)
    ensure(!signal?.aborted, 'CANCELLED')
    const controller = new AbortController()
    const abort = () => controller.abort(new GenerationError('CANCELLED'))
    signal?.addEventListener('abort', abort, { once: true })
    busy = true
    try {
      let output
      try { output = await abortable(provider.generate(request, { signal: controller.signal }), controller.signal) } catch (error) {
        if (controller.signal.aborted) throw new GenerationError('CANCELLED')
        if (error instanceof GenerationError) throw error
        throw new GenerationError('PROVIDER_FAILED')
      }
      const entry = await abortable(admitOutput(request, output), controller.signal)
      ensure(!controller.signal.aborted, 'CANCELLED')
      // Store.put is the irreversible admission boundary. Once entered, report
      // its actual outcome; cancellation cannot imply that a saved record vanished.
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
    } finally { signal?.removeEventListener('abort', abort); controller.abort(); busy = false }
  } })
}
