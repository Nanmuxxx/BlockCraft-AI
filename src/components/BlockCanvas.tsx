import { useEffect, useId, useRef, useState } from 'react'
import { Blocks, CalendarDays, ChartNoAxesColumnIncreasing, LayoutGrid, ListChecks, Plus, Undo2, Unlink } from 'lucide-react'
import type { ModuleId } from '../model/appConfig'
import type { BlockCanvasProps, BlockModuleData, VisualExample } from './blocks/contract'
import { featureKind, hasRelation, FEATURE_CATALOG, RECIPES, combination } from './blocks/rules'
import { BlockInspector } from './blocks/BlockInspector'
import { useSnapCanvas } from './blocks/useSnapCanvas'
import { CARD_HEIGHT, stackFor } from './blocks/snap-layout'
import { appBlockKind, APP_BLOCK_CATALOG } from './blocks/app-canvas'
import './block-canvas.css'
import { readBlockPresentation, blockCardStyle } from './blocks/presentation'

export type { BlockCanvasProps, BlockModuleData, BlockBuilderBindings, BlockEdit, BlockRelation, RecipeId, VisualExample, AppBlockType, AppCanvasEdit, AppCanvasBindings } from './blocks/contract'
export { toAppCanvasModules } from './blocks/app-canvas'
const ICONS = { tasks: ListChecks, courses: CalendarDays, stats: ChartNoAxesColumnIncreasing }

export function BlockCanvas<Id extends string = ModuleId>({ modules: requestedModules, positions, selectedModuleId, onSelectModule, onMoveModule, builder, appBuilder, examples = [] }: BlockCanvasProps<Id>) {
  const isSupported = (module: BlockModuleData<Id>) => {
    const appKind = appBlockKind(module)
    if (appKind) return !builder && (!appBuilder || appBuilder.availableTypes.includes(appKind))
    if (appBuilder) return false
    const kind = featureKind(module)
    return kind !== null && (!builder || builder.availableFeatures.includes(kind))
  }
  const modules = requestedModules.filter(isSupported)
  const unsupported = requestedModules.filter((module) => !isSupported(module))
  const items: { key: string; name: string; module?: BlockModuleData<Id>; example?: VisualExample }[] = [
    ...modules.map((module) => ({ key: `module:${module.id}`, name: module.name, module })),
    ...examples.map((example) => ({ key: `example:${example.id}`, name: example.name, example })),
  ]
  const [selectedExample, setSelectedExample] = useState<string | null>(null)
  const [combineFrom, setCombineFrom] = useState<Id | null>(null)
  const [partnerId, setPartnerId] = useState<Id | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const combinationRef = useRef<HTMLDivElement>(null)
  const helpId = useId()
  const catalogId = useId()
  const selected = modules.find(({ id }) => id === selectedModuleId)
  const source = builder ? modules.find(({ id }) => id === combineFrom) : undefined
  const partner = modules.find(({ id }) => id === partnerId)
  const candidate = source && partner ? combination(source, partner, builder?.availableRecipes ?? []) : null
  const alreadyCombined = candidate && hasRelation(builder?.relations ?? [], candidate)
  const choose = (key: string) => {
    const item = items.find((item) => item.key === key)
    if (!item) return
    if (source) { if (item.module) setPartnerId(item.module.id === combineFrom ? null : item.module.id); return }
    setSelectedExample(item.example ? key : null)
    if (item.module) onSelectModule(item.module.id)
  }
  const snap = useSnapCanvas({
    ids: items.map(({ key }) => key),
    saved: Object.fromEntries(items.map(({ key, module }) => [key, module ? positions[module.id] : undefined])),
    localIds: items.filter(({ example }) => example).map(({ key }) => key),
    onMove: (key, position) => { const module = items.find((item) => item.key === key)?.module; if (module) onMoveModule(module.id, position) },
    onSelect: choose,
    disabled: Boolean(source),
  })
  const selectedKey = selectedExample ?? (selected ? `module:${selected.id}` : null)
  const selectedStack = selectedKey ? stackFor(selectedKey, snap.stacks) : []
  useEffect(() => { if (combineFrom) combinationRef.current?.focus() }, [combineFrom, partnerId])
  const cancelCombination = () => { setCombineFrom(null); setPartnerId(null) }
  const confirmCombination = () => {
    if (!builder || !candidate || alreadyCombined) return
    builder.onEdit({ type: 'combine', ...candidate })
    cancelCombination()
  }

  return <section className="block-canvas-stage" aria-label="功能积木画布">
    <div className="block-canvas-toolbar">
      <span><Blocks size={16} aria-hidden="true" />我的功能 · {items.length} 块积木</span>
      <div className="block-canvas-actions">
        {appBuilder && <>
          <button type="button" disabled={!appBuilder.canUndo} onClick={appBuilder.onUndo}><Undo2 size={14} aria-hidden="true" />撤销结构修改</button>
          <button type="button" disabled={!selected || ['metric', 'pomodoro', 'gallery'].includes(appBlockKind(selected) ?? '')} onClick={() => selected && appBuilder.onEdit({ type: 'configure', blockId: selected.id })}>配置字段</button>
          <button type="button" disabled={!selected} onClick={() => selected && appBuilder.onEdit({ type: 'remove', blockId: selected.id })}>移除积木</button>
        </>}
        {builder && <button type="button" disabled={!builder.canUndo} onClick={builder.onUndo}><Undo2 size={14} aria-hidden="true" />撤销功能修改</button>}
        <button type="button" disabled={selectedStack.length < 2 || snap.dragging.length > 0} onClick={() => selectedKey && snap.detach(selectedKey)}><Unlink size={14} aria-hidden="true" />拆开这组</button>
        <button type="button" disabled={!items.length || snap.dragging.length > 0} onClick={snap.arrange}><LayoutGrid size={14} aria-hidden="true" />一键整理</button>
        {(builder || appBuilder) && <button type="button" aria-expanded={catalogOpen} aria-controls={catalogId} onClick={() => setCatalogOpen(!catalogOpen)}><Plus size={14} aria-hidden="true" />添加积木</button>}
      </div>
    </div>
    {appBuilder && catalogOpen && <div className="block-canvas-catalog" id={catalogId} aria-label="可用积木类型">
      {appBuilder.availableTypes.map(kind => <button type="button" key={kind} onClick={() => { appBuilder.onEdit({ type: 'add', kind }); setCatalogOpen(false) }}><strong>{APP_BLOCK_CATALOG[kind].name}</strong><span>{APP_BLOCK_CATALOG[kind].description}</span></button>)}
    </div>}
    {builder && catalogOpen && <div className="block-canvas-catalog" id={catalogId} aria-label="可用功能">
      {builder.availableFeatures.map((kind) => {
        const exists = modules.some((module) => featureKind(module) === kind)
        return <button type="button" key={kind} disabled={exists} onClick={() => { builder.onEdit({ type: 'add', kind }); setCatalogOpen(false) }}><strong>{FEATURE_CATALOG[kind].name}</strong><span>{exists ? '已添加' : FEATURE_CATALOG[kind].description}</span></button>
      })}
      <p>提醒通知和学习目标目前仅可在画布中展示与拼接，尚未提供业务功能。</p>
    </div>}
    {builder?.unsupportedRequirements?.length ? <div className="block-canvas-limit" role="note"><strong>这些需求暂时还搭不出来</strong><ul>{builder.unsupportedRequirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul></div> : null}
    <div className="block-canvas-play-note"><span>上下靠近，轻轻拼上</span><small>拼接只调整布局，软件功能保持不变。{examples.length > 0 && '提醒通知、学习目标为展示积木。'}</small></div>
    {!builder && !appBuilder && !examples.length && <p className="block-canvas-limit">当前可查看功能与调整布局。添加、配置和组合功能尚未开放。</p>}
    {unsupported.length > 0 && <p className="block-canvas-limit" role="note">{unsupported.map(({ name }) => `「${name}」`).join('、')}尚未提供可运行功能，未加入画布。</p>}
    {source && <div ref={combinationRef} tabIndex={-1} className="block-canvas-combine" role="region" aria-label="确认组合功能" onKeyDown={(event) => { if (event.key === 'Escape') cancelCombination() }}>
      <div><strong>将「{source.name}」和另一块组合功能</strong><p>点击另一块功能积木，先看看它们能一起做什么。</p></div>
      {partner && (candidate ? <div><strong>{RECIPES[candidate.recipe].name}</strong><p>{RECIPES[candidate.recipe].effect}</p><small>{RECIPES[candidate.recipe].undo}</small></div> : <p role="status">这两块暂时没有可用的组合方式。</p>)}
      <div className="block-canvas-actions"><button type="button" onClick={cancelCombination}>取消</button><button type="button" disabled={!candidate || Boolean(alreadyCombined)} onClick={confirmCombination}>{alreadyCombined ? '已经组合' : '确认组合'}</button></div>
    </div>}
    <div ref={snap.canvasRef} className={`block-canvas${source ? ' is-combining' : ''}`} style={{ height: snap.board.height }} aria-describedby={helpId}>
      <span className="block-canvas-watermark" aria-hidden="true">A LITTLE SPACE TO BUILD</span>
      {!items.length && <div className="block-canvas-empty"><Blocks size={30} aria-hidden="true" /><strong>从一个能用的功能开始</strong><p>{builder || appBuilder ? '点击“添加积木”，选择软件需要的功能。' : '还没有功能积木，先明确你想解决的事情。'}</p></div>}
      {snap.stacks.flatMap((stack) => stack.slice(1).map((key, index) => {
        const top = snap.scene[stack[index]]
        const bottom = snap.scene[key]
        if (!top || !bottom) return null
        return <i key={`joint:${key}`} aria-hidden="true" className={`block-canvas-joint${snap.celebrating.includes(key) ? ' is-glowing' : ''}`} style={{ left: top.x, top: (top.y + bottom.y) / 2, width: snap.board.cardWidth - 30 }} />
      }))}
      {snap.preview && <div className="block-canvas-snap-preview" aria-hidden="true">
        {snap.preview.moving.map((key) => <i key={key} className="block-canvas-ghost" style={{ left: snap.preview!.scene[key].x, top: snap.preview!.scene[key].y, width: snap.board.cardWidth, height: CARD_HEIGHT }} />)}
        <span className="block-canvas-snap-label" style={{ left: snap.preview.seam.x, top: snap.preview.seam.y }}>松手，拼到{snap.preview.direction === 'above' ? '上方' : '下方'}</span>
      </div>}
      {items.map((item, index) => {
        const { key, name, module, example } = item
        const kind = module ? featureKind(module) : null
        const appKind = module ? appBlockKind(module) : null
        const defaults = kind ? FEATURE_CATALOG[kind] : appKind ? APP_BLOCK_CATALOG[appKind] : null
        const Icon = example?.icon ?? module?.icon ?? (kind ? ICONS[kind] : Blocks)
        const point = snap.scene[key]
        if (!point) return null
        const presentation = readBlockPresentation({ type: appKind, presentation: module?.presentation })
        const group = stackFor(key, snap.stacks)
        const related = module ? builder?.relations.filter(({ sourceId, targetId }) => sourceId === module.id || targetId === module.id).length ?? 0 : 0
        return <button type="button" key={key} data-block-key={key}
          className={`block-canvas__block block-canvas__block--${example?.tone ?? module?.tone ?? defaults?.tone ?? 'apricot'}${selectedKey === key ? ' is-selected' : ''}${snap.dragging.includes(key) ? ' is-dragging' : ''}${module && combineFrom === module.id ? ' is-source' : ''}${module && partnerId === module.id ? ' is-partner' : ''}${snap.celebrating.includes(key) ? ' is-snapped' : ''}`}
          aria-pressed={source && module ? combineFrom === module.id || partnerId === module.id : selectedKey === key}
          aria-label={`${name}${example ? '，展示积木' : ''}${group.length > 1 ? `，已拼接 ${group.length} 块，可整组拖动` : ''}`}
          style={{ left: point.x, top: point.y, width: snap.board.cardWidth, height: CARD_HEIGHT, ...blockCardStyle(presentation) }}
          onPointerDown={(event) => snap.startDrag(event, key)} onPointerMove={snap.updateDrag}
          onPointerUp={(event) => snap.finishDrag(event)} onPointerCancel={(event) => snap.finishDrag(event, true)} onLostPointerCapture={(event) => snap.finishDrag(event, true)}
          onKeyDown={(event) => { if (event.key === 'Escape') cancelCombination() }} onClick={() => { if (!snap.consumeDragClick(key)) choose(key) }}>
          <span className="block-canvas__studs" aria-hidden="true"><i /><i /></span>
          <span className="block-canvas__top"><span className="block-canvas__icon"><Icon size={20} aria-hidden="true" /></span><span className="block-canvas__number">{example ? '展示' : String(index + 1).padStart(2, '0')}</span></span>
          <span className="block-canvas__title">{name}</span>
          <span className="block-canvas__description">{example?.description ?? module?.description ?? defaults?.description}</span>
          <span className="block-canvas__detail">{group.length > 1 ? `${group.length} 块拼在一起 · 可整组移动` : example ? '展示积木 · 暂无业务功能' : related ? `已组合 · ${related} 项能力` : presentation.buttonText ? `按钮：${presentation.buttonText}` : module?.detail ?? defaults?.detail}</span>
        </button>
      })}
    </div>
    <div className="block-canvas-bottom"><p className="block-canvas-note" id={helpId}>拖动到另一块的上方或下方，出现落点提示后松手。选中一组可拆开，一键整理会解除所有拼接。</p><span>{selectedStack.length > 1 ? `已选中 ${selectedStack.length} 块拼接组` : '自由搭建'}</span></div>
    <p className="block-canvas-feedback" role="status" aria-live="polite">{snap.message}{snap.preview ? '松手即可拼接，功能保持不变。' : ''}</p>
    {selected && !selectedExample && !source && builder && <BlockInspector key={selected.id} module={selected} modules={modules} builder={builder} onCombine={() => { setCombineFrom(selected.id); setPartnerId(null) }} />}
    {builder && <div className="block-canvas-relations" aria-label="已经组合的功能">
      <strong>搭在一起的功能 · {builder.relations.length}</strong>
      {builder.relations.length ? builder.relations.map((relation) => {
        const from = modules.find(({ id }) => id === relation.sourceId)
        const to = modules.find(({ id }) => id === relation.targetId)
        if (!from || !to) return null
        return <div key={relation.id}><span>{from.name} ＋ {to.name}<small>{RECIPES[relation.recipe].effect}</small></span><button type="button" onClick={() => builder.onEdit({ type: 'disconnect', relationId: relation.id })}>取消组合</button></div>
      }) : <p>还没有功能组合。视觉拼接只影响布局。</p>}
    </div>}
    {builder && <p className="block-canvas-feedback" role="status" aria-live="polite">{builder.feedback}</p>}
    {appBuilder && <p className="block-canvas-feedback" role="status" aria-live="polite">{appBuilder.feedback}</p>}
  </section>
}
