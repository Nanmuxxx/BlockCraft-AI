import { createRoot } from 'react-dom/client'
import { createAppRuntime } from '../../model/appRuntime'
import { createReadingLogExample } from '../../model/appSpecExamples'
import { AppSpecCanvas } from './AppSpecCanvas'

const runtime = createAppRuntime(createReadingLogExample())
const subscribe = runtime.subscribe
const moveBlock = runtime.moveBlock
const root = createRoot(document.getElementById('root')!)
const qa = document.getElementById('qa')!
const statusOutput = document.getElementById('status-message')!
const activePointers = new Map<number, string>()
const pointerEvents: {
  at: string; phase: string; blockId: string; targetBlockId: string | null
  pointerId: number; pointerType: string; button: number; clientX: number; clientY: number; isTrusted: boolean
}[] = []
const moves: { at: string; id: string; position: { x: number; y: number }; result: ReturnType<typeof runtime.moveBlock> }[] = []
const snapshots: {
  at: string; stage: string; revision: number; positions: ReturnType<typeof runtime.getSnapshot>['blockPositions']
  moves: typeof moves; status: ReturnType<typeof readStatus>; pointerEventCount: number
}[] = []
let subscriptions = 0
let notifications = 0
let unmountCheck: {
  before: { notifications: number; revision: number; subscriptions: number }
  after: { notifications: number; revision: number; subscriptions: number }
  notificationDelta: number; revisionDelta: number
  result: ReturnType<typeof runtime.moveBlock>
  finalPosition: { x: number; y: number } | undefined
} | null = null

function readStatus() {
  const element = document.querySelector<HTMLElement>('.app-spec-canvas > .block-canvas-stage > .block-canvas-feedback[role="status"]')
  return element ? { text: element.textContent?.trim() ?? '', visible: getComputedStyle(element).display !== 'none' }
    : { text: '', visible: false }
}

function renderReport() {
  const status = readStatus()
  statusOutput.textContent = status.visible ? status.text || '(empty)' : `(hidden or absent) ${status.text}`
  qa.textContent = JSON.stringify({
    subscriptions, notifications, pointerEvents, moves, snapshots, unmountCheck,
    current: { revision: runtime.getSnapshot().revision, positions: runtime.getSnapshot().blockPositions, status },
  }, null, 2)
}

function takeSnapshot(stage: string) {
  const snapshot = runtime.getSnapshot()
  snapshots.push({
    at: new Date().toISOString(), stage, revision: snapshot.revision,
    positions: structuredClone(snapshot.blockPositions),
    moves: moves.map(move => ({ ...move, position: { ...move.position } })),
    status: readStatus(), pointerEventCount: pointerEvents.length,
  })
  renderReport()
}

runtime.subscribe = listener => {
  subscriptions++
  const unsubscribe = subscribe(() => { notifications++; listener() })
  renderReport()
  return () => { subscriptions--; unsubscribe(); renderReport() }
}
runtime.moveBlock = (id, position) => {
  const result = moveBlock(id, position)
  moves.push({ at: new Date().toISOString(), id, position: { ...position }, result })
  renderReport()
  return result
}

function recordPointer(event: PointerEvent) {
  const targetBlockId = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-block-key]')?.dataset.blockKey?.replace(/^module:/, '') ?? null
    : null
  if (event.type === 'pointerdown' && targetBlockId) {
    takeSnapshot('before-pointerdown')
    activePointers.set(event.pointerId, targetBlockId)
  }
  const blockId = activePointers.get(event.pointerId)
  if (!blockId) return
  pointerEvents.push({
    at: new Date().toISOString(), phase: event.type, blockId, targetBlockId,
    pointerId: event.pointerId, pointerType: event.pointerType, button: event.button,
    clientX: event.clientX, clientY: event.clientY, isTrusted: event.isTrusted,
  })
  if (event.type === 'pointerup' || event.type === 'pointercancel') {
    activePointers.delete(event.pointerId)
    requestAnimationFrame(() => takeSnapshot(`after-${event.type}`))
  } else renderReport()
}
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) {
  document.addEventListener(type, recordPointer, true)
}

new MutationObserver(renderReport).observe(document.getElementById('root')!, { childList: true, subtree: true, characterData: true, attributes: true })
document.getElementById('capture')!.addEventListener('click', () => takeSnapshot('manual'))
document.getElementById('external')!.addEventListener('click', () => {
  takeSnapshot('before-external-move')
  runtime.moveBlock('reading-history', { x: 0.7, y: 0.7 })
  requestAnimationFrame(() => takeSnapshot('after-external-move'))
})
document.getElementById('unmount')!.addEventListener('click', () => {
  takeSnapshot('before-unmount')
  const before = { notifications, revision: runtime.getSnapshot().revision, subscriptions }
  root.unmount()
  const result = runtime.moveBlock('reading-history', { x: 0.6, y: 0.6 })
  const after = { notifications, revision: runtime.getSnapshot().revision, subscriptions }
  unmountCheck = {
    before, after, notificationDelta: after.notifications - before.notifications,
    revisionDelta: after.revision - before.revision, result,
    finalPosition: runtime.getSnapshot().blockPositions['reading-history'],
  }
  takeSnapshot('after-unmount-and-runtime-move')
})

root.render(<AppSpecCanvas runtime={runtime} />)
requestAnimationFrame(() => takeSnapshot('initial'))
