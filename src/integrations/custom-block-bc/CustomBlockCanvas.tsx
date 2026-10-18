import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Blocks, LayoutGrid, Unlink } from 'lucide-react'
import { useSnapCanvas } from '../../components/blocks/useSnapCanvas'
import { CARD_HEIGHT, stackFor } from '../../components/blocks/snap-layout'
import { APP_BLOCK_CATALOG } from '../../components/blocks/app-canvas'
import { createLayoutBatch, type CustomBlockBCAdapter } from './adapter'
import '../../components/block-canvas.css'
import './custom-block-bc.css'

/** A standalone replacement slot for the v2 canvas; existing v1/Demo is untouched. */
export function CustomBlockCanvas({ adapter, selectedId, onSelect }: {
  adapter: CustomBlockBCAdapter; selectedId: string | null; onSelect: (id: string) => void
}) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot)
  const gesture = useRef(snapshot)
  const [error, setError] = useState('')
  const helpId = useId()
  const items = adapter.orderedBlocks(snapshot)
  const queueMove = useMemo(() => createLayoutBatch(adapter, result => setError(result.ok ? '' : `${result.error.code}: ${result.error.message}`)), [adapter])
  const snap = useSnapCanvas({
    ids: items.map(item => item.id),
    saved: { ...snapshot.base.blockPositions, ...snapshot.custom.positions }, localIds: [], disabled: false,
    onSelect: id => { gesture.current = adapter.getSnapshot(); onSelect(id); setError('') },
    onMove: (id, position) => {
      const item = items.find(item => item.id === id)
      if (item) queueMove(gesture.current, item.kind, id, position)
    },
  })
  const selected = items.some(item => item.id === selectedId) ? selectedId : null
  const selectedStack = selected ? stackFor(selected, snap.stacks) : []
  return <section className="block-canvas-stage custom-block-bc" aria-label="自定义与内置积木画布">
    <div className="block-canvas-toolbar"><span><Blocks size={16} aria-hidden="true" />我的功能 · {items.length} 块积木</span>
      <div className="block-canvas-actions">
        <button type="button" disabled={selectedStack.length < 2 || snap.dragging.length > 0} onClick={() => { gesture.current = adapter.getSnapshot(); if (selected) snap.detach(selected) }}><Unlink size={14} aria-hidden="true" />拆开这组</button>
        <button type="button" disabled={!items.length || snap.dragging.length > 0} onClick={() => { gesture.current = adapter.getSnapshot(); snap.arrange() }}><LayoutGrid size={14} aria-hidden="true" />一键整理</button>
      </div>
    </div>
    <div className="block-canvas-play-note"><span>上下靠近，轻轻拼上</span><small>自定义积木可编辑参数；运行取决于隔离服务是否可用。</small></div>
    <div ref={snap.canvasRef} className="block-canvas" style={{ height: snap.board.height }} aria-describedby={helpId}>
      <span className="block-canvas-watermark" aria-hidden="true">A LITTLE SPACE TO BUILD</span>
      {snap.stacks.flatMap(stack => stack.slice(1).map((id, index) => {
        const top = snap.scene[stack[index]], bottom = snap.scene[id]
        return top && bottom ? <i key={`joint:${id}`} aria-hidden="true" className="block-canvas-joint" style={{ left: top.x, top: (top.y + bottom.y) / 2, width: snap.board.cardWidth - 30 }} /> : null
      }))}
      {snap.preview && <div className="block-canvas-snap-preview" aria-hidden="true">
        {snap.preview.moving.map(id => <i key={id} className="block-canvas-ghost" style={{ left: snap.preview!.scene[id].x, top: snap.preview!.scene[id].y, width: snap.board.cardWidth, height: CARD_HEIGHT }} />)}
        <span className="block-canvas-snap-label" style={{ left: snap.preview.seam.x, top: snap.preview.seam.y }}>松手，拼到{snap.preview.direction === 'above' ? '上方' : '下方'}</span>
      </div>}
      {items.map((item, index) => {
        const point = snap.scene[item.id]
        if (!point) return null
        const builtin = item.kind === 'builtin' ? APP_BLOCK_CATALOG[item.block.type] : undefined
        const name = item.kind === 'builtin' ? item.block.name : item.manifest?.name ?? '自定义积木（版本元数据不可用）'
        const group = stackFor(item.id, snap.stacks)
        return <button key={`${item.kind}:${item.id}`} type="button" data-block-key={`${item.kind}:${item.id}`}
          className={`block-canvas__block block-canvas__block--${builtin?.tone ?? 'apricot'}${selected === item.id ? ' is-selected' : ''}${snap.dragging.includes(item.id) ? ' is-dragging' : ''}${snap.celebrating.includes(item.id) ? ' is-snapped' : ''}`}
          style={{ left: point.x, top: point.y, width: snap.board.cardWidth, height: CARD_HEIGHT }}
          aria-pressed={selected === item.id} aria-label={`${name}${item.kind === 'custom' ? '，自定义积木' : ''}${group.length > 1 ? `，已拼接 ${group.length} 块，可整组拖动` : ''}`}
          onPointerDown={event => snap.startDrag(event, item.id)} onPointerMove={snap.updateDrag}
          onPointerUp={event => snap.finishDrag(event)} onPointerCancel={event => snap.finishDrag(event, true)} onLostPointerCapture={event => snap.finishDrag(event, true)}
          onClick={() => { if (!snap.consumeDragClick(item.id)) onSelect(item.id) }}>
          <span className="block-canvas__studs" aria-hidden="true"><i /><i /></span>
          <span className="block-canvas__top"><span className="block-canvas__icon"><Blocks size={20} aria-hidden="true" /></span><span className="block-canvas__number">{String(index + 1).padStart(2, '0')}</span></span>
          <span className="block-canvas__title">{name}</span>
          <span className="block-canvas__description">{builtin?.description ?? '自定义源码积木 · 参数由宿主校验'}</span>
          <span className="block-canvas__detail">{group.length > 1 ? `${group.length} 块拼在一起 · 可整组移动` : builtin?.detail ?? '自定义 · 运行状态见 C 模式'}</span>
        </button>
      })}
    </div>
    <div className="block-canvas-bottom"><p className="block-canvas-note" id={helpId}>拖动到积木上方或下方即可拼接。拼接只调整布局。</p><span>自由搭建</span></div>
    <p className="block-canvas-feedback" role="status" aria-live="polite">{snap.message}</p>
    {error && <p className="custom-block-bc__error" role="alert">{error}</p>}
  </section>
}
