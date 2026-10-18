// Trusted Node integration example, NOT browser wiring or a project owner.
import { protocol, json } from '../../server/custom-block/protocol.mjs'
import { exportProjectZip, EXPORT_LIMITS, ProjectExportError } from './export.mjs'

/** Accepts the merged Workshop session { getSnapshot, registry } structurally.
 * getSnapshot must return a frozen, identity-stable snapshot from the sole owner.
 * Host download/read permissions remain the integrating application's concern.
 * @param {Pick<import('../../src/model/customProjectSession').CustomProjectSession, 'getSnapshot' | 'registry'>} session
 * @param {import('./export.mjs').ExportOptions} [options]
 */
export async function exportSessionSnapshot(session, options) {
  const captured = session.getSnapshot()
  protocol.assertJson(captured)
  const project = json.cloneJson(captured)
  const references = new Map(project.custom.instances.map(({ definitionId, versionDigest }) =>
    [`${definitionId}/${versionDigest}`, { definitionId, versionDigest }]))
  if (references.size > EXPORT_LIMITS.maxArtifacts) throw new ProjectExportError('ARTIFACT_COUNT_LIMIT')
  const artifacts = []
  for (const ref of references.values()) artifacts.push(await protocol.resolveArtifact(session.registry, ref))
  const result = await exportProjectZip({ project, artifacts }, options)
  // Latest-only UI policy. Revision alone cannot detect a different session.
  if (session.getSnapshot() !== captured) throw new ProjectExportError('STALE_SNAPSHOT')
  return result
}
