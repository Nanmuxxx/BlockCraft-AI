export interface Point { x: number; y: number }
export type Scene = Record<string, Point>
export type Stack = readonly string[]
export interface Board { width: number; height: number; cardWidth: number }
// Keep enough vertical room for a two-line title, two-line description and
// the small detail row without making any text layer overlap another one.
export const CARD_HEIGHT = 198
export const STACK_STEP = 208
export const PADDING = 26

export function boardSize(width: number, count: number): Board {
  const cardWidth = Math.min(208, Math.max(80, width - 64))
  const columns = Math.max(1, Math.min(3, Math.floor((width - 24) / (cardWidth + 44))))
  const rows = Math.max(1, Math.ceil(count / columns))
  return { width, cardWidth, height: Math.max(900, count * STACK_STEP + PADDING * 2, rows * 250 + PADDING * 2) }
}

export function arrangeScene(ids: readonly string[], board: Board): Scene {
  const columns = Math.max(1, Math.min(3, Math.floor((board.width - 24) / (board.cardWidth + 44))))
  const rows = Math.max(1, Math.ceil(ids.length / columns))
  return Object.fromEntries(ids.map((id, index) => {
    const row = Math.floor(index / columns)
    const rowCount = Math.min(columns, ids.length - row * columns)
    return [id, { x: board.width * ((index % columns + .5) / rowCount), y: board.height * ((row + 1) / (rows + 1)) }]
  }))
}

export function stackFor(id: string, stacks: readonly Stack[]): Stack {
  return stacks.find((stack) => stack.includes(id)) ?? [id]
}

function units(ids: readonly string[], stacks: readonly Stack[]): Stack[] {
  const remaining = new Set(ids)
  const result: Stack[] = []
  for (const stack of stacks) {
    const valid = stack.filter((id) => remaining.delete(id))
    if (valid.length) result.push(valid)
  }
  // Array.from keeps the geometry helper compatible with the local CommonJS
  // smoke-test transpiler as well as the browser build.
  for (const id of Array.from(remaining)) result.push([id])
  return result
}

export function fits(scene: Scene, ids: readonly string[], board: Board) {
  return ids.every((id) => {
    const point = scene[id]
    return point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= board.cardWidth / 2 + PADDING && point.x <= board.width - board.cardWidth / 2 - PADDING
      && point.y >= CARD_HEIGHT / 2 + PADDING && point.y <= board.height - CARD_HEIGHT / 2 - PADDING
  })
}

export function collides(scene: Scene, moving: readonly string[], board: Board) {
  const movingIds = new Set(moving)
  return moving.some((id) => Object.entries(scene).some(([other, point]) => !movingIds.has(other)
    && Math.abs(scene[id].x - point.x) < board.cardWidth + 4 && Math.abs(scene[id].y - point.y) < CARD_HEIGHT + 4))
}

/** Clamp the whole stack as one body so its spacing cannot be distorted at an edge. */
export function translateStack(scene: Scene, moving: readonly string[], dx: number, dy: number, board: Board): Scene {
  const xs = moving.map((id) => scene[id].x)
  const ys = moving.map((id) => scene[id].y)
  const shiftX = Math.min(board.width - PADDING - board.cardWidth / 2 - Math.max(...xs), Math.max(PADDING + board.cardWidth / 2 - Math.min(...xs), dx))
  const shiftY = Math.min(board.height - PADDING - CARD_HEIGHT / 2 - Math.max(...ys), Math.max(PADDING + CARD_HEIGHT / 2 - Math.min(...ys), dy))
  return { ...scene, ...Object.fromEntries(moving.map((id) => [id, { x: scene[id].x + shiftX, y: scene[id].y + shiftY }])) }
}

/** Keep saved coordinates where possible; recover overlaps and adapt stacks on resize. */
export function settleScene(ids: readonly string[], desired: Scene, stacks: readonly Stack[], board: Board, preserve: readonly string[] = []): Scene {
  const fallback = arrangeScene(ids, board)
  const placed: Scene = {}
  const bodies = units(ids, stacks).sort((a, b) => Number(b.some((id) => preserve.includes(id))) - Number(a.some((id) => preserve.includes(id))))
  for (const body of bodies) {
    const first = desired[body[0]]
    const origin = first && Number.isFinite(first.x) && Number.isFinite(first.y) ? first : fallback[body[0]]
    const minX = board.cardWidth / 2 + PADDING
    const maxX = board.width - minX
    const minY = CARD_HEIGHT / 2 + PADDING
    const maxY = board.height - minY - (body.length - 1) * STACK_STEP
    const bounded = (point: Point) => ({ x: Math.min(maxX, Math.max(minX, point.x)), y: Math.min(maxY, Math.max(minY, point.y)) })
    const anchors = [bounded(origin), bounded(fallback[body[0]])]
    for (let y = minY; y <= maxY; y += 20) for (let x = minX; x <= maxX; x += 20) anchors.push({ x, y })
    anchors.push({ x: maxX, y: maxY }, { x: minX, y: maxY }, { x: maxX, y: minY })
    anchors.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))
    for (const anchor of anchors) {
      const candidate = { ...placed, ...Object.fromEntries(body.map((id, index) => [id, { x: anchor.x, y: anchor.y + index * STACK_STEP }])) }
      if (fits(candidate, body, board) && !collides(candidate, body, board)) {
        Object.assign(placed, candidate)
        break
      }
    }
  }
  // The board reserves one full column per possible stack; supported scenes always fit.
  return placed
}

export interface SnapPreview {
  moving: Stack
  target: Stack
  merged: Stack
  scene: Scene
  seam: Point
  direction: 'above' | 'below'
}

/** Only stack endpoints connect. Internal bricks never create branches or cycles. */
export function findSnap(scene: Scene, moving: Stack, stacks: readonly Stack[], board: Board): SnapPreview | null {
  const others = Object.keys(scene).filter((id) => !moving.includes(id))
  let best: SnapPreview | null = null
  let bestDistance = Infinity
  for (const target of units(others, stacks)) for (const direction of ['above', 'below'] as const) {
    const movingEnd = scene[direction === 'below' ? moving[0] : moving[moving.length - 1]]
    const targetEnd = scene[direction === 'below' ? target[target.length - 1] : target[0]]
    const dx = targetEnd.x - movingEnd.x
    const dy = targetEnd.y + (direction === 'below' ? STACK_STEP : -STACK_STEP) - movingEnd.y
    const distance = Math.hypot(dx, dy)
    if (Math.abs(dx) > 64 || Math.abs(dy) > 50 || distance >= bestDistance) continue
    const snapped = { ...scene, ...Object.fromEntries(moving.map((id) => [id, { x: scene[id].x + dx, y: scene[id].y + dy }])) }
    if (!fits(snapped, moving, board) || collides(snapped, moving, board)) continue
    bestDistance = distance
    best = { moving, target, merged: direction === 'below' ? [...target, ...moving] : [...moving, ...target], scene: snapped, direction,
      seam: { x: targetEnd.x, y: targetEnd.y + (direction === 'below' ? STACK_STEP / 2 : -STACK_STEP / 2) } }
  }
  return best
}

export function joinStacks(stacks: readonly Stack[], preview: SnapPreview): Stack[] {
  return [...stacks.filter((stack) => !stack.some((id) => preview.merged.includes(id))), preview.merged]
}

export function detachStack(scene: Scene, id: string, stacks: readonly Stack[], board: Board) {
  const detached = stackFor(id, stacks)
  const nextStacks = stacks.filter((stack) => !stack.includes(id))
  const nextScene: Scene = { ...scene }
  const minX = board.cardWidth / 2 + PADDING
  const maxX = board.width - minX
  const minY = CARD_HEIGHT / 2 + PADDING
  const maxY = board.height - minY

  // Preserve every member's final canvas point. Only move a detached member
  // when its old point is outside the board or overlaps a fixed/member point.
  // Candidate offsets are deterministic and local, so splitting never causes
  // an unrelated brick to be re-laid out.
  const offsets = [
    { x: 0, y: 0 }, { x: 24, y: 0 }, { x: -24, y: 0 },
    { x: 0, y: 24 }, { x: 0, y: -24 }, { x: 48, y: 0 },
    { x: -48, y: 0 }, { x: 0, y: 48 }, { x: 0, y: -48 },
  ]
  for (const key of detached) {
    const origin = scene[key] ?? arrangeScene([key], board)[key]
    const candidates = offsets.map((offset) => ({
      x: Math.min(maxX, Math.max(minX, origin.x + offset.x)),
      y: Math.min(maxY, Math.max(minY, origin.y + offset.y)),
    }))
    const candidate = candidates.find((point) => {
      const candidateScene = { ...nextScene, [key]: point }
      return fits(candidateScene, [key], board) && !collides(candidateScene, [key], board)
    }) ?? { x: Math.min(maxX, Math.max(minX, origin.x)), y: Math.min(maxY, Math.max(minY, origin.y)) }
    nextScene[key] = candidate
  }
  return { stacks: nextStacks, scene: nextScene }
}
