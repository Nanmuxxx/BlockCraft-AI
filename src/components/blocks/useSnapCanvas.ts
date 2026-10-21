import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { BlockPosition } from '../../model/appConfig'
import { arrangeScene, boardSize, collides, detachStack, findSnap, joinStacks, settleScene, stackFor, translateStack, type Scene, type Stack, type SnapPreview } from './snap-layout'

interface Input {
  ids: readonly string[]
  saved: Readonly<Record<string, BlockPosition | undefined>>
  localIds: readonly string[]
  onMove: (id: string, position: BlockPosition) => void
  onLayout?: (positions: Readonly<Record<string, BlockPosition>>) => void
  onSelect: (id: string) => void
  disabled: boolean
}

export function useSnapCanvas({ ids, saved, localIds, onMove, onLayout, onSelect, disabled }: Input) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [local, setLocal] = useState<Scene>({})
  const [stacks, setStacks] = useState<Stack[]>([])
  const [draft, setDraft] = useState<Scene | null>(null)
  const [preview, setPreview] = useState<SnapPreview | null>(null)
  const [celebrating, setCelebrating] = useState<readonly string[]>([])
  const [message, setMessage] = useState('')
  const suppressedClick = useRef<string | null>(null)
  const dragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; scene: Scene; latest: Scene; moving: Stack; snap: SnapPreview | null; moved: boolean } | null>(null)
  const board = boardSize(width, ids.length)
  const desired = Object.fromEntries(ids.map((id) => [id, local[id] ? { x: local[id].x * board.width, y: local[id].y * board.height }
    : saved[id] ? { x: saved[id]!.x * board.width, y: saved[id]!.y * board.height } : arrangeScene(ids, board)[id]]))
  // Normalize external positions once per render; no layout is written back on resize.
  const scene = useMemo(() => settleScene(ids, desired, stacks, board), [JSON.stringify(desired), JSON.stringify(stacks), width, board.height])

  useEffect(() => {
    if (!canvasRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width <= 0) return
      setWidth(entry.contentRect.width); dragRef.current = null; setDraft(null); setPreview(null)
    })
    observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!celebrating.length) return
    const timer = setTimeout(() => setCelebrating([]), 500)
    return () => clearTimeout(timer)
  }, [celebrating])

  const commit = (next: Scene, moved: readonly string[]) => {
    const normalized = Object.fromEntries(ids.map((id) => [id, { x: next[id].x / board.width, y: next[id].y / board.height }]))
    setLocal(Object.fromEntries(localIds.map((id) => [id, normalized[id]])))
    if (onLayout) onLayout(normalized)
    else moved.forEach((id) => onMove(id, normalized[id]))
  }
  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || dragRef.current || disabled) return
    suppressedClick.current = null
    const moving = stackFor(id, stacks)
    dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scene, latest: scene, moving, snap: null, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    setCelebrating([])
    onSelect(id)
  }
  const updateDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    drag.latest = translateStack(drag.scene, drag.moving, dx, dy, board)
    drag.snap = findSnap(drag.latest, drag.moving, stacks, board)
    setDraft(drag.latest)
    setPreview(drag.snap)
  }
  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!cancel) updateDrag(event)
    if (!cancel && drag.moved) {
      suppressedClick.current = drag.id
      if (drag.snap) {
        const nextStacks = joinStacks(stacks, drag.snap)
        setStacks(nextStacks)
        commit(drag.snap.scene, drag.moving)
        setCelebrating([...drag.snap.merged])
        setMessage(`拼上了！${drag.snap.merged.length} 块积木现在可以一起移动，软件功能不变。`)
      } else if (!collides(drag.latest, drag.moving, board)) {
        commit(drag.latest, drag.moving)
        setMessage(drag.moving.length > 1 ? '整组积木已移动。' : '积木位置已更新。')
      } else {
        setMessage('这里会挡住其他积木，已放回原位。靠近上下接缝可以拼接。')
      }
    }
    dragRef.current = null
    setDraft(null)
    setPreview(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const detach = (id: string) => {
    const result = detachStack(scene, id, stacks, board)
    setStacks(result.stacks)
    commit(result.scene, ids)
    setMessage('这组积木已拆开并留出间距，可以重新拼接。')
  }
  const arrange = () => {
    setStacks([])
    setCelebrating([])
    commit(arrangeScene(ids, board), ids)
    setMessage('已解除全部拼接，积木重新排好了。')
  }
  return { canvasRef, board, scene: draft ?? scene, preview, stacks, celebrating, message, dragging: draft ? dragRef.current?.moving ?? [] : [], startDrag, updateDrag, finishDrag, detach, arrange,
    consumeDragClick: (id: string) => { const consumed = suppressedClick.current === id; suppressedClick.current = null; return consumed } }
}
