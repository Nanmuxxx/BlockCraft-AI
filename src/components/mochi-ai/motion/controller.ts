import type { MochiAnchor, MochiEmotion } from '../MochiTypes'
import { landing, route, safe, type Point, type Rect } from './geometry'

const transform = (point: Point) => `translate3d(${point.x}px, ${point.y}px, 0)`
const rectOf = (element: Element): Rect => {
  const box = element.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}
const intersection = (a: Rect, b: Rect): Rect => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y),
  width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
  height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) })

/** DOM-only display controller: no Runtime, host writes, network or per-frame React state. */
export function createMochiMotion(node: HTMLDivElement, getAnchor: () => MochiAnchor | null | undefined,
  react: (emotion: MochiEmotion, milliseconds: number) => void) {
  const scope = node.closest<HTMLElement>('.app-spec-workshop, [data-mochi-surface]') ?? node.parentElement!
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const navigatorHints = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  const limited = (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
    || (navigatorHints.deviceMemory !== undefined && navigatorHints.deviceMemory <= 4) || Boolean(navigatorHints.connection?.saveData)
  node.dataset.motionQuality = limited ? 'limited' : 'full'
  let frame = 0, feedbackFrame = 0, animation: Animation | undefined, disposed = false, following = false, dragging = false
  let selected: Element | null = null, destination: Point | null = null, side = '', initialized = false
  let pointer: Point | null = null, activePointer: number | null = null, snapped = false, settleUntil = 0
  let origin: Point | null = null, pointerMoved = false
  const feedback = new WeakMap<Element, string>()
  const seenSizes = new WeakSet<Element>()
  const observe = new ResizeObserver(entries => {
    const resized = entries.filter(entry => { const seen = seenSizes.has(entry.target); seenSizes.add(entry.target); return seen })
    if (resized.length) schedule(resized.some(entry => entry.target === selected))
  })
  observe.observe(scope)

  const stop = () => { animation?.cancel(); animation = undefined; node.dataset.locomotion = 'rest' }
  const measure = () => {
    frame = 0
    if (disposed) return
    const block = scope.querySelector<HTMLElement>('[data-block-key].is-selected')
    const anchor = getAnchor()
    const changed = block !== selected
    if (changed) {
      if (selected) observe.unobserve(selected)
      selected = block
      if (selected) { seenSizes.delete(selected); observe.observe(selected); react('curious', 1800) }
      side = ''; snapped = false
    }
    const viewport: Rect = { x: 8, y: 8, width: innerWidth - 16, height: innerHeight - 16 }
    const canvas = block?.closest('.block-canvas')
    const rootBox = scope.getBoundingClientRect()
    const target = block ? rectOf(block) : anchor && anchor.visible !== false
      ? { x: rootBox.x + anchor.x, y: rootBox.y + anchor.y, width: anchor.width ?? 0, height: anchor.height ?? 0 } : null
    const visibleTarget = target && intersection(target, viewport)
    if (document.hidden || !target || !visibleTarget?.width || !visibleTarget.height || (block && !block.getClientRects().length)) {
      stop(); node.style.visibility = 'hidden'; initialized = false; destination = null; return
    }
    let bounds = intersection(canvas ? rectOf(canvas) : rectOf(scope), viewport)
    // Respect nested clipping/scroll containers in addition to the viewport.
    for (let parent = canvas?.parentElement; parent && parent !== scope; parent = parent.parentElement) {
      if (/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflow)) bounds = intersection(bounds, rectOf(parent))
    }
    const protectedElements = [...scope.querySelectorAll('[data-block-key], button, input, textarea, select, a, .app-spec-inspector, [data-mochi-avoid]')]
      .filter(element => !node.contains(element) && element.getClientRects().length > 0)
    const obstacles = protectedElements.map(rectOf).filter(box => box.width > 0 && box.height > 0
      && box.x < bounds.x + bounds.width && box.x + box.width > bounds.x && box.y < bounds.y + bounds.height && box.y + box.height > bounds.y)
    if (pointer && activePointer !== null) obstacles.push({ x: pointer.x - 28, y: pointer.y - 28, width: 56, height: 56 })
    const next = landing(target, bounds, obstacles, changed ? '' : side)
    if (!next) { stop(); node.style.visibility = 'hidden'; initialized = false; destination = null; return }
    const isDragging = Boolean(block?.classList.contains('is-dragging'))
    if (isDragging && !dragging) react('curious', 1800)
    dragging = isDragging
    node.dataset.dragging = String(isDragging || activePointer !== null)
    const isSnapped = Boolean(block?.classList.contains('is-snapped'))
    if (isSnapped && !snapped) { react('celebrating', 1800); settleUntil = performance.now() + 520 }
    snapped = isSnapped
    node.dataset.side = next.side
    node.dataset.reducedMotion = String(reduced.matches)
    const same = destination && Math.hypot(next.x - destination.x, next.y - destination.y) < .75
    if (same && initialized && !reduced.matches) {
      following = false
      if (performance.now() < settleUntil) schedule(true)
      return
    }
    const currentBox = node.getBoundingClientRect()
    const start = { x: currentBox.x, y: currentBox.y }
    const distance = Math.hypot(next.x - start.x, next.y - start.y)
    const shouldTravel = initialized && !following && !isDragging && !reduced.matches && distance > 3
    stop()
    node.style.visibility = 'visible'
    if (shouldTravel) {
      const path = route(start, next, bounds, obstacles)
      if (path) {
        // Round a short unobstructed hop with sampled sine offsets. Each sample
        // must be clear; otherwise retain the safe ground route.
        let points: Point[] = path
        if (!limited && path.length === 2 && distance < 260) {
          const hop = Array.from({ length: 13 }, (_, i) => {
            const t = i / 12
            return { x: start.x + (next.x - start.x) * t, y: start.y + (next.y - start.y) * t - Math.sin(Math.PI * t) * Math.min(24, distance * .12) }
          })
          if (hop.every(point => safe(point, bounds, obstacles))) points = hop
        }
        const lengths = points.map((point, i) => i ? Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y) : 0)
        const total = lengths.reduce((a, b) => a + b, 0)
        let travelled = 0
        const frames = points.map((point, i) => { travelled += lengths[i]; return { transform: transform(point), offset: total ? travelled / total : i / (points.length - 1) } })
        node.style.transform = transform(next)
        node.dataset.locomotion = points.length === 13 ? 'hop' : 'travel'
        const moving = node.animate(frames, { duration: Math.min(1100, Math.max(300, total * 1.6)), easing: 'cubic-bezier(.25,.1,.25,1)' })
        animation = moving
        moving.onfinish = () => { if (animation === moving) { animation = undefined; node.dataset.locomotion = 'rest' } }
      } else if (safe(start, bounds, obstacles)) {
        // Disconnected free space: wait at the previous safe spot. Never fly
        // through an Inspector/control or teleport just to reach a target.
        node.style.transform = transform(start); destination = start; following = false; return
      } else node.style.transform = transform(next)
    } else node.style.transform = transform(next)
    initialized = true; destination = next; side = next.side; following = false
    if (performance.now() < settleUntil) schedule(true)
  }
  function schedule(follow = false) {
    if (disposed) return
    following ||= follow
    if (!frame) frame = requestAnimationFrame(measure)
  }
  const mutations = new MutationObserver(records => {
    let relevant = false
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      if (!target || node.contains(target)) continue
      if (target.closest('[data-block-key]') || record.type === 'childList' || record.attributeName === 'hidden') relevant = true
      const statuses = [target.closest('[role="alert"], [role="status"], .app-spec-inspector__success'), ...target.querySelectorAll('[role="alert"], .app-spec-inspector__success')]
      for (const status of statuses) if (status && !status.closest('.mochi-ai')) {
        const text = status.textContent?.trim() ?? ''
        if (text && feedback.get(status) !== text) {
          feedback.set(status, text)
          if (status.matches('[role="alert"]')) react('error', 2500)
          else if (status.matches('.app-spec-inspector__success')) react('happy', 1800)
        }
      }
    }
    if (relevant) schedule()
  })
  mutations.observe(scope, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
  const scroll = () => schedule(true)
  const down = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest('[data-block-key]')) {
      activePointer = event.pointerId; pointer = { x: event.clientX, y: event.clientY }; origin = pointer; pointerMoved = false; schedule()
    }
  }
  const move = (event: PointerEvent) => {
    if (event.pointerId === activePointer) {
      pointer = { x: event.clientX, y: event.clientY }
      pointerMoved ||= Boolean(origin && Math.hypot(pointer.x - origin.x, pointer.y - origin.y) > 4)
      schedule(pointerMoved)
    }
  }
  const up = (event: PointerEvent) => {
    if (event.pointerId === activePointer) { activePointer = null; pointer = null; origin = null; schedule(pointerMoved) }
  }
  const preference = () => { stop(); schedule(true) }
  // Repeated saves can reuse the same status text, producing no status mutation.
  // Read after the existing Inspector handler commits; never perform the save.
  const inspectorAction = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null
    const inspector = target?.closest('.app-spec-inspector')
    if (!inspector || (event.type === 'change' && !target?.matches('input[type="checkbox"][aria-label^="展示 "]'))) return
    cancelAnimationFrame(feedbackFrame)
    feedbackFrame = requestAnimationFrame(() => {
      feedbackFrame = 0
      if (disposed || !inspector.isConnected) return
      if (inspector.querySelector('[role="alert"]')) react('error', 2500)
      else if (inspector.querySelector('.app-spec-inspector__success')) react('happy', 1800)
    })
  }
  document.addEventListener('scroll', scroll, true)
  document.addEventListener('visibilitychange', preference)
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('pointermove', move, { passive: true })
  document.addEventListener('pointerup', up, true)
  document.addEventListener('pointercancel', up, true)
  window.addEventListener('resize', scroll)
  window.visualViewport?.addEventListener('resize', scroll)
  window.visualViewport?.addEventListener('scroll', scroll)
  reduced.addEventListener('change', preference)
  scope.addEventListener('submit', inspectorAction, true)
  scope.addEventListener('change', inspectorAction, true)
  schedule()
  return { schedule: () => schedule(), dispose() {
    disposed = true; cancelAnimationFrame(frame); cancelAnimationFrame(feedbackFrame); stop(); observe.disconnect(); mutations.disconnect()
    document.removeEventListener('scroll', scroll, true)
    document.removeEventListener('visibilitychange', preference)
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up, true)
    document.removeEventListener('pointercancel', up, true)
    window.removeEventListener('resize', scroll)
    window.visualViewport?.removeEventListener('resize', scroll)
    window.visualViewport?.removeEventListener('scroll', scroll)
    reduced.removeEventListener('change', preference)
    scope.removeEventListener('submit', inspectorAction, true)
    scope.removeEventListener('change', inspectorAction, true)
  } }
}
