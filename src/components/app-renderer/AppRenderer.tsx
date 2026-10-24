import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { BlockSpec, EntityRecord, FieldSpec } from '../../model/appSpec'
import { metricValue, parseFieldDraft, type AppRuntime, type FieldDraft } from '../../model/appRuntime'
import './app-renderer.css'
import { readBlockPresentation, blockCardStyle } from '../blocks/presentation'
import { visibleRecords } from '../../model/appInteractions'
import { FilterControls, GroupChart, RecordDetails, InteractionScope } from './InteractiveBlocks'
import { Pomodoro } from './Pomodoro'

function RecordEditor({ fields, initial, onSave, onCancel, buttonText }: {
  fields: FieldSpec[]; initial?: EntityRecord; buttonText?: string
  onSave: (values: EntityRecord['values']) => void; onCancel?: () => void
}) {
  const [draft, setDraft] = useState<FieldDraft>(() => Object.fromEntries(fields.map(field => {
    const value = initial?.values[field.id]
    return [field.id, value === undefined ? '' : typeof value === 'boolean' ? value : String(value)]
  })))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  return <form className="renderer-editor" noValidate onSubmit={event => {
    event.preventDefault(); setError(''); setNotice('')
    try {
      const values = { ...initial?.values }
      // Keep fields outside this editor; clearing an optional field removes its value.
      fields.forEach(field => { delete values[field.id] })
      Object.assign(values, parseFieldDraft(fields, draft))
      onSave(values)
      if (!initial) setDraft({})
      setNotice('已保存')
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败') }
  }}>
    {fields.map(field => <label key={field.id}>
      <span>{field.name}{field.required ? ' *' : ''}</span>
      {field.type === 'select' || field.type === 'boolean'
        ? <select value={String(draft[field.id] ?? '')} onChange={event => {
          const value = event.target.value
          setDraft(current => ({ ...current, [field.id]: field.type === 'boolean' && value !== '' ? value === 'true' : value }))
        }}>
          <option value="">请选择{field.required ? '' : '（可留空）'}</option>
          {(field.type === 'select' ? field.options : ['true', 'false']).map(option => <option key={option} value={option}>{field.type === 'boolean' ? option === 'true' ? '是' : '否' : option}</option>)}
        </select>
        : <input type={field.type === 'text' ? 'text' : field.type} step={field.type === 'number' ? 'any' : undefined}
          value={String(draft[field.id] ?? '')} onChange={event => setDraft(current => ({ ...current, [field.id]: event.target.value }))} />}
    </label>)}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="renderer-actions"><button type="submit">{initial ? '保存修改' : buttonText ?? '提交'}</button>{onCancel && <button type="button" onClick={onCancel}>取消</button>}</div>
  </form>
}

function RecordList({ runtime, blockId, entityId, fieldIds }: { runtime: AppRuntime; blockId: string; entityId: string; fieldIds: string[] }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const entity = state.spec.entities.find(entity => entity.id === entityId)!
  const fields = fieldIds.map(id => entity.fields.find(field => field.id === id)!)
  const view = useSyncExternalStore(runtime.subscribeInteractions, runtime.getInteractionSnapshot, runtime.getInteractionSnapshot)
  const rows = visibleRecords(state, view, blockId)
  const hasDetails = state.spec.blocks.some(b => b.type === 'details' && b.sourceBlockId === blockId)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  // A list may omit required fields: expose them for valid creation/editing.
  const editorFields = entity.fields.filter(field => fieldIds.includes(field.id) || field.required)
  function create(values: EntityRecord['values']) {
    runtime.dispatch({ type: 'create', entityId, record: { id: `record-${crypto.randomUUID()}`, values } })
    setAdding(false)
  }
  return <>
    <InteractionScope runtime={runtime} blockId={blockId} />
    <p role="status">显示 {rows.length} / {(state.records[entityId] ?? []).length} 条记录</p>
    <button type="button" onClick={() => { setAdding(true); setEditing(null) }}>新增记录</button>
    {adding && <RecordEditor fields={editorFields} onSave={create} onCancel={() => setAdding(false)} />}
    {rows.length === 0 && <p>暂无记录</p>}
    <div className="renderer-table"><table>
      <thead><tr>{fields.map(field => <th key={field.id}>{field.name}</th>)}<th>操作</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>{fields.map(field => <td key={field.id}>{typeof row.values[field.id] === 'boolean' ? row.values[field.id] ? '是' : '否' : String(row.values[field.id] ?? '—')}</td>)}
        <td><div className="renderer-actions">{hasDetails && <button type="button" aria-pressed={view.records[blockId] === row.id} onClick={() => { const result = runtime.interact({ type: 'selectRecord', blockId, recordId: row.id }); setError(result.ok ? '' : result.error.message) }}>查看详情</button>}<button type="button" onClick={() => { setEditing(row.id); setAdding(false) }}>编辑</button><button type="button" onClick={() => {
          try { runtime.dispatch({ type: 'delete', entityId, recordId: row.id }); if (editing === row.id) setEditing(null); setError('') }
          catch (error) { setError(error instanceof Error ? error.message : '删除失败') }
        }}>删除</button></div></td></tr>)}</tbody>
    </table></div>
    {error && <p role="alert">{error}</p>}
    {rows.filter(row => row.id === editing).map(row => <RecordEditor key={row.id} fields={editorFields} initial={row} onCancel={() => setEditing(null)} onSave={values => {
      runtime.dispatch({ type: 'update', entityId, recordId: row.id, values }); setEditing(null)
    }} />)}
  </>
}

function GalleryBlock({ runtime, block }: { runtime: AppRuntime; block: Extract<BlockSpec, { type: 'gallery' }> }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [failedImages, setFailedImages] = useState<Record<string, string>>({})
  const previewRef = useRef<HTMLDivElement>(null)
  const assets = state.assets ?? {}
  const active = activeId && block.imageIds.includes(activeId) && failedImages[activeId] !== assets[activeId]?.dataUrl ? assets[activeId] : undefined
  useEffect(() => {
    if (!active) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const closeButton = previewRef.current?.querySelector('button')
    closeButton?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveId(null)
      // The close button is the preview's only interactive control.
      if (event.key === 'Tab') { event.preventDefault(); closeButton?.focus() }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape); previousFocus?.focus() }
  }, [active])
  const markFailed = (id: string, dataUrl: string) => setFailedImages(current => ({ ...current, [id]: dataUrl }))
  return <section className="renderer-block renderer-block--gallery" aria-label={block.name} style={blockCardStyle(readBlockPresentation(block))}>
    <h2>{block.name}</h2>
    {!block.imageIds.length
      ? <p className="renderer-gallery-empty">画廊还没有图片，请在 B 模式添加项目图片。</p>
      : <div className="renderer-gallery-grid" aria-label="图片画廊">
        {block.imageIds.map(id => {
          const asset = assets[id]
          if (!asset || failedImages[id] === asset.dataUrl) return <div className="renderer-gallery-missing" key={id} role="alert">图片资源不可用：{asset?.name || id}</div>
          return <button type="button" className="renderer-gallery-item" key={id} onClick={() => setActiveId(id)} aria-label={`预览 ${asset.altText || asset.name}`}>
            <img src={asset.dataUrl} alt={asset.altText || asset.name} loading="lazy" onError={() => markFailed(id, asset.dataUrl)} />
            <span>{asset.name}</span>
          </button>
        })}
      </div>}
    {active && <div ref={previewRef} tabIndex={-1} className="renderer-gallery-preview" role="dialog" aria-modal="true" aria-label={`预览 ${active.altText || active.name}`} onClick={event => { if (event.target === event.currentTarget) setActiveId(null) }}>
      <button type="button" onClick={() => setActiveId(null)} aria-label="关闭图片预览">关闭</button>
      <img src={active.dataUrl} alt={active.altText || active.name} onError={() => markFailed(active.id, active.dataUrl)} />
    </div>}
  </section>
}

/** Render exactly one trusted builtin against the shared runtime facade. */
export function BuiltinBlockRenderer({ runtime, blockId }: { runtime: AppRuntime; blockId: BlockSpec['id'] }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const view = useSyncExternalStore(runtime.subscribeInteractions, runtime.getInteractionSnapshot, runtime.getInteractionSnapshot)
  const block = state.spec.blocks.find(block => block.id === blockId)
  const binding = state.spec.relations.find(relation => relation.blockId === blockId)
  const entity = state.spec.entities.find(entity => entity.id === binding?.entityId)
  if (block?.type === 'pomodoro') return <Pomodoro runtime={runtime} block={block} />
  if (block?.type === 'gallery') return <GalleryBlock runtime={runtime} block={block} />
  if (!block || !entity) return null
  const presentation = readBlockPresentation(block)
  return <section className={`renderer-block renderer-block--${block.type}`} aria-label={block.name} style={blockCardStyle(presentation)}>
    <h2>{block.name}</h2>
    {block.type === 'filter' ? <FilterControls runtime={runtime} block={block} />
      : block.type === 'chart' ? <GroupChart runtime={runtime} block={block} />
      : block.type === 'details' ? <RecordDetails runtime={runtime} block={block} />
      : block.type === 'metric' ? <><InteractionScope runtime={runtime} blockId={blockId} /><output className="renderer-metric" aria-live="polite">{metricValue(state, block, visibleRecords(state, view, blockId)).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</output></>
      : block.type === 'list' ? <RecordList runtime={runtime} blockId={blockId} entityId={entity.id} fieldIds={block.fieldIds} />
        : <RecordEditor buttonText={presentation.buttonText} fields={block.fieldIds.map(id => entity.fields.find(field => field.id === id)!)} onSave={values => runtime.dispatch({ type: 'create', entityId: entity.id, record: { id: `record-${crypto.randomUUID()}`, values } })} />}
  </section>
}

/** Legacy/Demo composition retains canonical v1 ordering. */
export function AppRenderer({ runtime }: { runtime: AppRuntime }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  return <div className="app-renderer">{state.spec.blocks.map(block => <BuiltinBlockRenderer key={block.id} runtime={runtime} blockId={block.id} />)}</div>
}
