import { protocol, json, ensure } from './protocol.mjs'
import { validateRecord } from './store.mjs'

/** Trusted host bridge only; no route, generation, build or project write.
 * Export exactly the existing CustomBlockImport file shape. Provenance stays
 * separate and is never an execution or project authorization credential.
 */
export async function exportPendingInstall(store, input) {
  protocol.assertJson(input); json.object(input)
  json.keys(input, ['reference', 'instanceId', 'props'])
  protocol.assertArtifactReference(input.reference); json.id(input.instanceId); json.object(input.props)
  const captured = structuredClone(input)
  const raw = await store.inspect(captured.reference)
  ensure(raw !== undefined, 'ARTIFACT_NOT_FOUND')
  protocol.assertJson(raw)
  const record = await validateRecord(structuredClone(raw))
  ensure(record.entry.versionDigest === captured.reference.versionDigest && record.entry.artifact.manifest.definitionId === captured.reference.definitionId, 'STORE_REFERENCE_MISMATCH')
  // Generation v1 grants no host capabilities/events. Do not widen on export.
  ensure(record.entry.artifact.manifest.requestedCapabilities.length === 0 && Object.keys(record.entry.artifact.manifest.events).length === 0, 'CAPABILITIES_REJECTED')
  protocol.assertSchemaValue(record.entry.artifact.manifest.propsSchema, captured.props)
  return {
    importFile: { instance: { id: captured.instanceId, ...captured.reference, props: captured.props }, artifact: record.entry },
    provenance: record.provenance,
    status: 'pending-build', validation: 'source-admitted', build: 'not-attempted', execution: 'denied',
  }
}
