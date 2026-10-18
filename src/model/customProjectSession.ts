import type { ProjectState } from './appSpec'
import type { RuntimeResult } from './appRuntime'
import type { ArtifactReference, ArtifactRegistry, CustomBlockInstance, CustomProject, RegisteredArtifact } from '../custom-block'
import { assertArtifactReference, migrateProjectState, parseCustomProject, resolveArtifact } from '../custom-block'
import { assertCustomProjectStructure } from '../custom-block/project'
import { assertSchemaValue } from '../custom-block/schema'
import { assertJson, check, cloneJson, CustomBlockError, keys, object, revision } from '../custom-block/json'
import { createProjectRevisionOwner, type ProjectRevisionOwner, type WriteAuthorization } from '../integrations/custom-block-bc/owner'

export interface CustomProjectSession extends ProjectRevisionOwner {
  registry: ArtifactRegistry
  /** Import inert artifacts only. Null expectedReference means create, never replace. */
  install: (request: unknown, authorization?: WriteAuthorization) => Promise<RuntimeResult>
  /** Trusted host permission control; never exposed to artifact code or JSON. */
  setReadOnly: (readOnly: boolean) => void
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const key = (ref: ArtifactReference) => `${ref.definitionId}/${ref.versionDigest}`
const same = (a: ArtifactReference, b: ArtifactReference) => key(a) === key(b)
function failure(error: unknown): RuntimeResult {
  return { ok: false, error: error instanceof CustomBlockError ? { code: error.code, message: error.message }
    : { code: 'ARTIFACT_UNAVAILABLE', message: '制品校验失败，项目未修改。' } }
}

/** The only current business snapshot. The v1 facade is a frozen read projection;
 * commands/CRUD/layout/custom edits all publish here and share subscribers.
 * Artifact storage contains immutable build inputs, never another project store.
 */
export function createProjectSession(initial: ProjectState, onCustomCommit: () => void) {
  const artifacts = new Map<string, RegisteredArtifact>()
  const registry: ArtifactRegistry = Object.freeze({ async resolve(ref: ArtifactReference) { return artifacts.get(key(ref)) } })
  // Candidate-bound synchronous effects carry no project state. Only the sole
  // owner's persist hook may install metadata/history alongside publication.
  const effects = new WeakMap<CustomProject, () => void>()
  const admissions = new WeakMap<CustomProject, RegisteredArtifact>()
  const authority = createProjectRevisionOwner(migrateProjectState(initial), { persist(next) {
    const effect = effects.get(next)
    if (effect) effect()
    else onCustomCommit()
    return undefined
  } })
  let projected = authority.getSnapshot()
  let base = freeze({ revision: projected.revision, ...projected.base })
  const owner: CustomProjectSession = Object.freeze({
    ...authority,
    registry,
    compareAndSwap(expected: CustomProject, next: CustomProject, authorization: WriteAuthorization): RuntimeResult {
      try {
        // As in #24, callers must parse artifacts/Schema before this trusted CAS.
        // Structure validation is synchronous; authorization is checked last by
        // the authority, with no await before its persist/publication boundary.
        assertCustomProjectStructure(next)
        for (const instance of next.custom.instances) {
          const staged = admissions.get(next)
          const registered = staged && staged.versionDigest === instance.versionDigest && staged.artifact.manifest.definitionId === instance.definitionId
            ? staged : artifacts.get(key(instance))
          check(registered, '此版本制品尚未准入。', 'VERSION_MISSING')
          assertSchemaValue(registered.artifact.manifest.propsSchema, instance.props)
          const state = next.custom.states[instance.id]
          if (state) assertSchemaValue(registered.artifact.manifest.stateSchema, state.value)
          for (const cap of registered.artifact.manifest.requestedCapabilities) if (cap.kind === 'records.create') {
            check(next.base.spec.entities.some(entity => entity.id === cap.entityId), 'Capability references unknown project entity')
          }
        }
        return authority.compareAndSwap(expected, next, authorization)
      } catch (error) { return failure(error) }
    },
    async install(input: unknown, authorization = authority.getAuthorization()): Promise<RuntimeResult> {
      try {
        assertJson(input); const request = cloneJson(input); object(request); keys(request, ['baseRevision', 'instance', 'artifact', 'expectedReference']); revision(request.baseRevision)
        const current = authority.getSnapshot()
        check(request.baseRevision === current.revision, '项目已变化，请重新导入。', 'REVISION_CONFLICT')
        check(current.revision < Number.MAX_SAFE_INTEGER, 'Revision exhausted', 'REVISION_EXHAUSTED')
        object(request.instance); keys(request.instance, ['id', 'definitionId', 'versionDigest', 'props'])
        const instance = cloneJson(request.instance) as unknown as CustomBlockInstance
        const reference = { definitionId: instance.definitionId, versionDigest: instance.versionDigest }
        const registered = await resolveArtifact({ async resolve() { return request.artifact } }, reference)
        const index = current.custom.instances.findIndex(item => item.id === instance.id)
        if (request.expectedReference === null) check(index < 0, '积木已存在，请明确确认版本替换。', 'INSTANCE_EXISTS')
        else {
          assertArtifactReference(request.expectedReference)
          check(index >= 0 && same(current.custom.instances[index], request.expectedReference), '原积木版本已变化。', 'VERSION_CONFLICT')
        }
        const next = cloneJson(current)
        if (index < 0) {
          next.custom.instances.push(instance)
          next.custom.positions[instance.id] = { x: .1, y: .7 }
          next.renderOrder.push({ kind: 'custom', id: instance.id })
        } else {
          next.custom.instances[index] = instance
          // Never transfer state across different definitions or versions.
          if (!same(current.custom.instances[index], instance)) delete next.custom.states[instance.id]
        }
        next.revision++
        const stagedRegistry: ArtifactRegistry = { async resolve(ref) { return same(ref, reference) ? registered : registry.resolve(ref) } }
        const validated = await parseCustomProject(next, stagedRegistry)
        effects.set(validated, () => { onCustomCommit(); artifacts.set(key(reference), registered) })
        admissions.set(validated, registered)
        try { return owner.compareAndSwap(current, validated, authorization) }
        finally { effects.delete(validated); admissions.delete(validated) }
      } catch (error) { return failure(error) }
    },
  })
  return {
    owner, getBaseSnapshot: () => {
      const current = authority.getSnapshot()
      if (projected !== current) {
        projected = current
        base = freeze({ revision: current.revision, ...current.base })
      }
      return base
    },
    /** Sync builtin transactions preserve all admitted custom data. Only base and
     * builtin references change; structure catches global ID collisions. */
    commitBuiltin(next: ProjectState, beforePublish: () => void, expected: CustomProject, authorization: WriteAuthorization) {
      const { revision: nextRevision, ...nextBase } = next
      const ids = new Set(next.spec.blocks.map(block => block.id))
      const renderOrder = expected.renderOrder.filter(item => item.kind === 'custom' || ids.delete(item.id))
      ids.forEach(id => renderOrder.push({ kind: 'builtin', id }))
      const candidate = { ...expected, revision: nextRevision, base: nextBase, renderOrder }
      effects.set(candidate, beforePublish)
      try { return owner.compareAndSwap(expected, candidate, authorization) }
      finally { effects.delete(candidate) }
    },
  }
}
