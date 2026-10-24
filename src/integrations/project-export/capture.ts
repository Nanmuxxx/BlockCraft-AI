import { resolveArtifact, type RegisteredArtifact } from '../../custom-block'
import type { CustomProjectSession } from '../../model/customProjectSession'

export class ExportFailure extends Error {
  constructor(public code: string) { super(code) }
}

/** Capture the sole owner's immutable snapshot; never creates an owner or writes. */
export async function captureExport(owner: Pick<CustomProjectSession, 'getSnapshot' | 'registry'>) {
  const project = owner.getSnapshot()
  if (project.base.spec.version !== 1) throw new ExportFailure('UNSUPPORTED_APP_SPEC')
  if (project.base.spec.blocks.some(block => ['filter', 'chart', 'details'].includes(block.type))) throw new ExportFailure('UNSUPPORTED_INTERACTIVE_EXPORT')
  const refs = new Map(project.custom.instances.map(({ definitionId, versionDigest }) =>
    [`${definitionId}/${versionDigest}`, { definitionId, versionDigest }]))
  if (refs.size > 32) throw new ExportFailure('ARTIFACT_COUNT_LIMIT')
  const artifacts: RegisteredArtifact[] = []
  for (const ref of refs.values()) artifacts.push(await resolveArtifact(owner.registry, ref))
  const assertCurrent = () => { if (owner.getSnapshot() !== project) throw new ExportFailure('STALE_SNAPSHOT') }
  assertCurrent()
  return { input: { project, artifacts }, assertCurrent }
}
