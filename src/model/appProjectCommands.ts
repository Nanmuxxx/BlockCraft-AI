import type { AppCommand, ProjectState } from './appSpec'
import type { CustomProject } from '../custom-block/types'
import { assertCustomProjectStructure } from '../custom-block/project'
import { syncLayoutOrder } from './layoutOrder'

/** The one deterministic projection used by both preview and actual publication.
 * Explicit ordering replaces builtin slots and preserves custom relative slots;
 * new builtin slots append. Structural commands never derive an implicit order
 * from placement: an addition's coordinates grant no authority over siblings.
 * A later drag can intentionally establish a coordinate-derived order. */
export function projectBuiltinChange(expected: CustomProject, next: ProjectState, commands: readonly AppCommand[] = []): CustomProject {
  const { revision, ...base } = structuredClone(next)
  const ids = new Set(base.spec.blocks.map(block => block.id))
  const renderOrder = expected.renderOrder.filter(item => item.kind === 'custom' || ids.delete(item.id)).map(item => ({ ...item }))
  ids.forEach(id => renderOrder.push({ kind: 'builtin', id }))
  const candidate: CustomProject = { ...structuredClone(expected), revision, base, renderOrder }
  if (commands.some(command => command.type === 'reorderBlocks')) {
    let index = 0
    candidate.renderOrder = renderOrder.map(item => item.kind === 'builtin' ? { kind: 'builtin', id: base.spec.blocks[index++].id } : item)
  } else if (commands.length === 0 && Object.entries(next.blockPositions).some(([id, point]) => {
    const previous = expected.base.blockPositions[id]
    return !previous || previous.x !== point.x || previous.y !== point.y
  })) syncLayoutOrder(candidate)
  assertCustomProjectStructure(candidate)
  return candidate
}

/** Undo restores complete project content while the authoritative revision advances. */
export function restoreProjectSnapshot(previous: CustomProject, revision: number): CustomProject {
  const restored = { ...structuredClone(previous), revision }
  assertCustomProjectStructure(restored)
  return restored
}
