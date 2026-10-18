import { assertProjectState } from '../model/appSpecValidation'
import type { ProjectState } from '../model/appSpec'
import type { ArtifactRegistry, CustomProject } from './types'
import { assertJson, check, cloneJson, digest, id, keys, object, revision } from './json'
import { resolveArtifact } from './artifacts'
import { assertSchemaValue } from './schema'

function position(value: unknown) {
  object(value); keys(value, ['x', 'y'])
  for (const axis of ['x', 'y']) check(typeof value[axis] === 'number' && Number.isFinite(value[axis]) && value[axis] >= 0 && value[axis] <= 1, 'Position outside [0,1]')
}
/** Internal structural pass; custom props/state still require an exact registry resolution. */
export function assertCustomProjectStructure(input: unknown): asserts input is CustomProject {
  assertJson(input); object(input); keys(input, ['formatVersion', 'revision', 'base', 'custom', 'renderOrder'])
  check(input.formatVersion === 2, 'Unknown project format version'); revision(input.revision)
  object(input.base); keys(input.base, ['spec', 'records', 'blockPositions'], ['timers'])
  assertProjectState({ revision: input.revision, ...input.base })
  const base = input.base as unknown as CustomProject['base']
  const globalIds = new Set([base.spec.id, ...base.spec.entities.flatMap(e => [e.id, ...e.fields.map(f => f.id)]), ...base.spec.blocks.map(b => b.id), ...base.spec.relations.map(r => r.id)])
  object(input.custom); keys(input.custom, ['instances', 'positions', 'states'])
  check(Array.isArray(input.custom.instances) && input.custom.instances.length <= 128, 'Invalid custom instance count')
  const customIds = new Set<string>()
  for (const instance of input.custom.instances) {
    object(instance); keys(instance, ['id', 'definitionId', 'versionDigest', 'props'])
    id(instance.id); id(instance.definitionId); digest(instance.versionDigest); object(instance.props)
    check(!globalIds.has(instance.id), 'Custom instance ID collision')
    globalIds.add(instance.id); customIds.add(instance.id)
  }
  object(input.custom.positions)
  check(Object.keys(input.custom.positions).length === customIds.size, 'Every custom instance requires one position')
  for (const [instanceId, p] of Object.entries(input.custom.positions)) { check(customIds.has(instanceId), 'Dangling custom position'); position(p) }
  object(input.custom.states)
  for (const [instanceId, slot] of Object.entries(input.custom.states)) {
    check(customIds.has(instanceId), 'Dangling custom state')
    object(slot); keys(slot, ['versionDigest', 'stateRevision', 'value']); digest(slot.versionDigest); revision(slot.stateRevision); object(slot.value)
    const instance = input.custom.instances.find(i => (i as { id: string }).id === instanceId) as { versionDigest: string }
    check(slot.versionDigest === instance.versionDigest, 'State belongs to another component version')
  }
  check(Array.isArray(input.renderOrder), 'Expected renderOrder')
  const expected = new Set([...base.spec.blocks.map(b => `builtin:${b.id}`), ...Array.from(customIds, value => `custom:${value}`)])
  check(input.renderOrder.length === expected.size, 'renderOrder must cover every block exactly once')
  for (const item of input.renderOrder) {
    object(item); keys(item, ['kind', 'id']); id(item.id)
    check(item.kind === 'builtin' || item.kind === 'custom', 'Unknown render kind')
    check(expected.delete(`${item.kind}:${item.id}`), 'Duplicate/dangling renderOrder reference')
  }
}
/** One-way wrapper; no Runtime, aliasing, revision increment or business-data rewrite. */
export function migrateProjectState(input: unknown): CustomProject {
  assertJson(input); assertProjectState(input)
  const { revision: projectRevision, ...base } = cloneJson(input as unknown as ProjectState)
  const result: CustomProject = {
    formatVersion: 2, revision: projectRevision, base,
    custom: { instances: [], positions: {}, states: {} },
    renderOrder: base.spec.blocks.map(block => ({ kind: 'builtin', id: block.id })),
  }
  assertCustomProjectStructure(result)
  return result
}
/** Async only for reading/verifying artifacts. Validates a snapshot captured before await. */
export async function parseCustomProject(input: unknown, registry: ArtifactRegistry): Promise<CustomProject> {
  assertCustomProjectStructure(input)
  const project = cloneJson(input)
  for (const instance of project.custom.instances) {
    const { artifact } = await resolveArtifact(registry, { definitionId: instance.definitionId, versionDigest: instance.versionDigest })
    assertSchemaValue(artifact.manifest.propsSchema, instance.props)
    const slot = Object.prototype.hasOwnProperty.call(project.custom.states, instance.id) ? project.custom.states[instance.id] : undefined
    if (slot) assertSchemaValue(artifact.manifest.stateSchema, slot.value)
    for (const cap of artifact.manifest.requestedCapabilities) if (cap.kind === 'records.create') {
      check(project.base.spec.entities.some(e => e.id === cap.entityId), 'Capability references unknown project entity')
    }
  }
  return project
}
/** Fail closed on any custom data or ordering loss. No "best effort" v1 export. */
export function exportProjectState(input: unknown) {
  assertCustomProjectStructure(input)
  check(input.custom.instances.length === 0 && Object.keys(input.custom.positions).length === 0 && Object.keys(input.custom.states).length === 0, 'Custom project cannot be exported as v1', 'LOSSY_EXPORT')
  check(input.renderOrder.every((item, index) => item.kind === 'builtin' && item.id === input.base.spec.blocks[index].id), 'v1 export would lose render order', 'LOSSY_EXPORT')
  check(input.base.spec.version === 1, 'AppSpec v2 cannot be exported as v1', 'LOSSY_EXPORT')
  const result = cloneJson({ revision: input.revision, ...input.base })
  assertProjectState(result)
  return result
}
