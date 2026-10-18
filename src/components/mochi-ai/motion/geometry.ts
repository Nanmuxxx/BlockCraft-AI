export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }
export const SIZE = { width: 58, height: 58 }
export function overlaps(a: Rect, b: Rect, gap = 6) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
}
export function safe(point: Point, bounds: Rect, obstacles: Rect[]) {
  const rect = { ...point, ...SIZE }
  return rect.x >= bounds.x && rect.y >= bounds.y && rect.x + rect.width <= bounds.x + bounds.width && rect.y + rect.height <= bounds.y + bounds.height && !obstacles.some(box => overlaps(rect, box))
}
export function landing(target: Rect, bounds: Rect, obstacles: Rect[], previousSide = '') {
  const candidates = [
    { x: target.x + target.width + 14, y: target.y + target.height / 2 - SIZE.height / 2, side: 'right' },
    { x: target.x - SIZE.width - 14, y: target.y + target.height / 2 - SIZE.height / 2, side: 'left' },
    { x: target.x + target.width / 2 - SIZE.width / 2, y: target.y - SIZE.height - 22, side: 'top' },
    { x: target.x + target.width / 2 - SIZE.width / 2, y: target.y + target.height + 16, side: 'bottom' },
  ].map(point => ({ ...point,
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - SIZE.width, point.x)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - SIZE.height, point.y)),
  }))
  const adjacent = candidates.filter(point => safe(point, bounds, obstacles))
  if (adjacent.length) return adjacent.find(point => point.side === previousSide) ?? adjacent[0]
  const free: Array<Point & { side: string }> = []
  for (let y = bounds.y; y + SIZE.height <= bounds.y + bounds.height; y += 32) {
    for (let x = bounds.x; x + SIZE.width <= bounds.x + bounds.width; x += 32) {
      if (safe({ x, y }, bounds, obstacles)) free.push({ x, y, side: 'parked' })
    }
  }
  free.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))
  return free[0] ?? null
}

/** Visibility graph routes the full hit box around content, including during travel. */
export function route(start: Point, end: Point, bounds: Rect, obstacles: Rect[]): Point[] | null {
  const clear = (a: Point, b: Point) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8)
    for (let i = 1; i <= steps; i++) if (!safe({ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }, bounds, obstacles)) return false
    return true
  }
  if (clear(start, end)) return [start, end]
  const nodes = [start, end, ...obstacles.flatMap(box => [
    { x: box.x - SIZE.width - 9, y: box.y - SIZE.height - 9 },
    { x: box.x + box.width + 9, y: box.y - SIZE.height - 9 },
    { x: box.x - SIZE.width - 9, y: box.y + box.height + 9 },
    { x: box.x + box.width + 9, y: box.y + box.height + 9 },
  ]).map(point => ({
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - SIZE.width, point.x)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - SIZE.height, point.y)),
  })).filter(point => safe(point, bounds, obstacles))]
  const distance = nodes.map(() => Infinity), parent = nodes.map(() => -1), visited = new Set<number>()
  distance[0] = 0
  for (let iteration = 0; iteration < nodes.length; iteration++) {
    let current = -1
    nodes.forEach((_, index) => { if (!visited.has(index) && (current < 0 || distance[index] < distance[current])) current = index })
    if (current < 0 || !Number.isFinite(distance[current])) return null
    if (current === 1) {
      const result = [end]
      while (current !== 0) { current = parent[current]; result.unshift(nodes[current]) }
      return result
    }
    visited.add(current)
    nodes.forEach((point, index) => {
      if (visited.has(index)) return
      const next = distance[current] + Math.hypot(point.x - nodes[current].x, point.y - nodes[current].y)
      if (next < distance[index] && clear(nodes[current], point)) { distance[index] = next; parent[index] = current }
    })
  }
  return null
}
