import type { BlockSpec } from '../../model/appSpec'
import type { RuntimeResult } from '../../model/appRuntime'
import type { ArtifactReference, ArtifactRegistry, CustomBlockInstance, CustomBlockManifest, CustomProject } from '../../custom-block'
import { assertArtifactReference, parseCustomProject, resolveArtifact } from '../../custom-block'
import { assertJson, check, cloneJson, CustomBlockError, id, keys, object, revision } from '../../custom-block/json'

/** Implemented by the ONE project owner, never by a second adapter store.
 * Both checks and publication must be atomic. Freeze nextProject and publish once.
 * Builtin commands/records/undo, custom edits and persistence share this owner.
 */
export interface ProjectRevisionOwner {
  getSnapshot: () => CustomProject
  subscribe: (listener: () => void) => () => void
  compareAndSwap: (expectedSnapshot: CustomProject, nextProject: CustomProject) => RuntimeResult | Promise<RuntimeResult>
}
export type OrderedBlock =
  | { kind: 'builtin'; id: string; block: BlockSpec }
  | { kind: 'custom'; id: string; instance: CustomBlockInstance; manifest?: CustomBlockManifest }
export interface CustomBlockBCAdapter {
  getSnapshot: ProjectRevisionOwner['getSnapshot']
  subscribe: ProjectRevisionOwner['subscribe']
  manifestFor: (reference: ArtifactReference) => CustomBlockManifest | undefined
  orderedBlocks: (snapshot: CustomProject) => OrderedBlock[]
  /** Unknown at the trusted boundary, even when called by a typed React control. */
  editProps: (request: unknown) => Promise<RuntimeResult>
  moveBlocks: (request: unknown) => Promise<RuntimeResult>
}

export function referenceOf(instance: CustomBlockInstance): ArtifactReference {
  return { definitionId: instance.definitionId, versionDigest: instance.versionDigest }
}
export function sameReference(a: ArtifactReference, b: ArtifactReference) {
  return a.definitionId === b.definitionId && a.versionDigest === b.versionDigest
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function failure(error: unknown): RuntimeResult {
  return { ok: false, error: error instanceof CustomBlockError
    ? { code: error.code, message: error.message }
    : { code: 'HOST_UNAVAILABLE', message: '宿主校验或保存暂不可用。' } }
}

/** Validated metadata only. SourceArtifact never enters a view projection.
 * Admission is async; edits revalidate the entire candidate and digest before CAS.
 * No mutable project, revision counter, Runtime, listener set or persistence here.
 */
export async function createCustomBlockBCAdapter(owner: ProjectRevisionOwner, registry: ArtifactRegistry): Promise<CustomBlockBCAdapter> {
  const initial = owner.getSnapshot()
  const admitted = await parseCustomProject(initial, registry)
  const manifests = new Map<string, CustomBlockManifest>()
  const key = (r: ArtifactReference) => `${r.definitionId}/${r.versionDigest}`
  for (const instance of admitted.custom.instances) {
    if (!manifests.has(key(instance))) {
      const resolved = await resolveArtifact(registry, referenceOf(instance))
      manifests.set(key(instance), resolved.artifact.manifest)
    }
  }
  check(owner.getSnapshot() === initial, 'Project changed during adapter admission', 'REVISION_CONFLICT')
  const manifestFor = (ref: ArtifactReference) => manifests.get(key(ref))
  const transact = async (request: unknown, apply: (next: CustomProject, input: Record<string, unknown>) => void): Promise<RuntimeResult> => {
    try {
      assertJson(request); object(request); revision(request.baseRevision)
      const current = owner.getSnapshot()
      check(request.baseRevision === current.revision, '配置已变化，请检查当前项目后重新操作。', 'REVISION_CONFLICT')
      check(current.revision < Number.MAX_SAFE_INTEGER, '项目版本号已用尽。', 'REVISION_EXHAUSTED')
      const next = cloneJson(current)
      apply(next, request)
      next.revision++
      // Copies synchronously before await; no caller-owned draft aliases survive.
      const validated = freeze(await parseCustomProject(next, registry))
      check(owner.getSnapshot() === current, '校验期间项目已变化，请重新操作。', 'REVISION_CONFLICT')
      return owner.compareAndSwap(current, validated)
    } catch (error) { return failure(error) }
  }
  return Object.freeze({
    getSnapshot: () => owner.getSnapshot(),
    subscribe: (listener: () => void) => owner.subscribe(listener),
    manifestFor,
    orderedBlocks(snapshot: CustomProject): OrderedBlock[] {
      return snapshot.renderOrder.map(item => {
        if (item.kind === 'builtin') {
          const block = snapshot.base.spec.blocks.find(block => block.id === item.id)
          check(block, 'Unknown builtin render reference')
          return { ...item, kind: 'builtin', block }
        }
        const instance = snapshot.custom.instances.find(instance => instance.id === item.id)
        check(instance, 'Unknown custom render reference')
        return { ...item, kind: 'custom', instance, manifest: manifestFor(instance) }
      })
    },
    editProps: (request: unknown) => transact(request, (next, input) => {
      keys(input, ['baseRevision', 'instanceId', 'reference', 'props'])
      id(input.instanceId); assertArtifactReference(input.reference); object(input.props)
      const instance = next.custom.instances.find(instance => instance.id === input.instanceId)
      check(instance, '自定义积木已不存在。', 'INSTANCE_MISSING')
      check(sameReference(instance, input.reference), '积木版本已变化，请重新选择。', 'VERSION_CONFLICT')
      check(manifestFor(instance), '此版本的元数据尚未准入。', 'VERSION_MISSING')
      instance.props = cloneJson(input.props) as CustomBlockInstance['props']
    }),
    moveBlocks: (request: unknown) => transact(request, (next, input) => {
      keys(input, ['baseRevision', 'moves'])
      check(Array.isArray(input.moves) && input.moves.length > 0 && input.moves.length <= next.renderOrder.length, 'Invalid move batch')
      const seen = new Set<string>()
      for (const move of input.moves) {
        object(move); keys(move, ['id', 'kind', 'position']); id(move.id)
        check(move.kind === 'builtin' || move.kind === 'custom', 'Unknown move kind')
        check(!seen.has(move.id), 'Duplicate move'); seen.add(move.id)
        check(next.renderOrder.some(item => item.kind === move.kind && item.id === move.id), 'Unknown move target')
        object(move.position); keys(move.position, ['x', 'y'])
        for (const axis of ['x', 'y']) check(typeof move.position[axis] === 'number' && Number.isFinite(move.position[axis]) && (move.position[axis] as number) >= 0 && (move.position[axis] as number) <= 1, 'Position outside [0,1]')
        const positions = move.kind === 'custom' ? next.custom.positions : next.base.blockPositions
        positions[move.id] = cloneJson(move.position) as { x: number; y: number }
      }
    }),
  })
}

/** One gesture may move a builtin/custom stack. The existing hook emits each
 * member synchronously; collect them into ONE atomic host layout transaction.
 */
export function createLayoutBatch(adapter: CustomBlockBCAdapter, onResult: (result: RuntimeResult) => void) {
  let batch: { snapshot: CustomProject; moves: Map<string, { kind: 'builtin' | 'custom'; id: string; position: { x: number; y: number } }> } | undefined
  return (snapshot: CustomProject, kind: 'builtin' | 'custom', blockId: string, position: { x: number; y: number }) => {
    if (!batch) {
      batch = { snapshot, moves: new Map() }
      queueMicrotask(() => {
        const pending = batch!
        batch = undefined
        void adapter.moveBlocks({ baseRevision: pending.snapshot.revision, moves: [...pending.moves.values()] }).then(onResult)
      })
    }
    check(batch.snapshot === snapshot, 'Mixed layout gesture snapshots', 'REVISION_CONFLICT')
    batch.moves.set(blockId, { kind, id: blockId, position: cloneJson(position) })
  }
}
