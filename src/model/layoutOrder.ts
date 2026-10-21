import type { CustomProject } from '../custom-block/types'

/** Saved canvas coordinates define reading order; exact ties retain prior order. */
export function syncLayoutOrder(project: CustomProject): void {
  const point = (item: CustomProject['renderOrder'][number]) =>
    (item.kind === 'builtin' ? project.base.blockPositions : project.custom.positions)[item.id]
      ?? { x: .5, y: .5 }
  project.renderOrder.sort((a, b) => point(a).y - point(b).y || point(a).x - point(b).x)
}
