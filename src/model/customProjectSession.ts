import type { ProjectState } from './appSpec'
import type { RuntimeResult } from './appRuntime'
import type { ArtifactReference, ArtifactRegistry, CustomBlockInstance, CustomProject, RegisteredArtifact } from '../custom-block'
import { assertArtifactReference, migrateProjectState, parseCustomProject, resolveArtifact } from '../custom-block'
import { assertCustomProjectStructure } from '../custom-block/project'
import { assertJson, check, cloneJson, CustomBlockError, keys, object, revision } from '../custom-block/json'
import type { ProjectRevisionOwner } from '../integrations/custom-block-bc/adapter'

export interface CustomProjectSession extends ProjectRevisionOwner {
  registry: ArtifactRegistry
  /** Import inert artifacts only. Null expectedReference means create, never replace. */
  install: (request: unknown) => Promise<RuntimeResult>
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
  let project = freeze(migrateProjectState(initial))
  let base = freeze({ revision: project.revision, ...project.base })
  const artifacts = new Map<string, RegisteredArtifact>()
  const listeners = new Set<() => void>()
  const registry: ArtifactRegistry = Object.freeze({ async resolve(ref: ArtifactReference) { return artifacts.get(key(ref)) } })
  const publish = (next: CustomProject) => {
    project = freeze(next)
    base = freeze({ revision: project.revision, ...project.base })
    listeners.forEach(listener => listener())
  }
  const owner: CustomProjectSession = Object.freeze({
    registry,
    getSnapshot: () => project,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async compareAndSwap(expected: CustomProject, next: CustomProject): Promise<RuntimeResult> {
      try {
        check(expected === project, '项目已变化。', 'REVISION_CONFLICT')
        check(next.revision === expected.revision + 1, 'Invalid next revision', 'REVISION_CONFLICT')
        const validated = await parseCustomProject(next, registry)
        check(expected === project, '校验期间项目已变化。', 'REVISION_CONFLICT')
        onCustomCommit(); publish(validated)
        return { ok: true, duplicate: false, committedRevision: project.revision }
      } catch (error) { return failure(error) }
    },
    async install(input: unknown): Promise<RuntimeResult> {
      try {
        assertJson(input); const request = cloneJson(input); object(request); keys(request, ['baseRevision', 'instance', 'artifact', 'expectedReference']); revision(request.baseRevision)
        const current = project
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
        check(current === project, '制品准入期间项目已变化。', 'REVISION_CONFLICT')
        artifacts.set(key(reference), registered)
        onCustomCommit(); publish(validated)
        return { ok: true, duplicate: false, committedRevision: project.revision }
      } catch (error) { return failure(error) }
    },
  })
  return {
    owner, getBaseSnapshot: () => base,
    /** Sync builtin transactions preserve all admitted custom data. Only base and
     * builtin references change; structure catches global ID collisions. */
    commitBuiltin(next: ProjectState, beforePublish: () => void) {
      const { revision: nextRevision, ...nextBase } = next
      const ids = new Set(next.spec.blocks.map(block => block.id))
      const renderOrder = project.renderOrder.filter(item => item.kind === 'custom' || ids.delete(item.id))
      ids.forEach(id => renderOrder.push({ kind: 'builtin', id }))
      const candidate = { ...project, revision: nextRevision, base: nextBase, renderOrder }
      assertCustomProjectStructure(candidate)
      beforePublish(); publish(candidate)
    },
  }
}
