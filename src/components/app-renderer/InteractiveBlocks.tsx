import { useState, useSyncExternalStore } from 'react'
import type { BlockSpec, FieldValue } from '../../model/appSpec'
import type { AppRuntime } from '../../model/appRuntime'
import { boundEntityId, chartPoints, selectedRecord } from '../../model/appInteractions'

export const displayValue = (value: FieldValue | undefined) => value === undefined ? '—' : typeof value === 'boolean' ? value ? '是' : '否' : String(value)

export function InteractionScope({ runtime, blockId }: { runtime: AppRuntime; blockId: string }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const view = useSyncExternalStore(runtime.subscribeInteractions, runtime.getInteractionSnapshot, runtime.getInteractionSnapshot)
  const sources = state.spec.blocks.flatMap(b => {
    if (b.type === 'filter' && b.targetBlockIds.includes(blockId)) {
      const filter = view.filters[b.id]
      return filter && (filter.query.trim() || Object.keys(filter.values).length) ? [`${b.name}：${[filter.query.trim(), ...Object.values(filter.values).map(displayValue)].filter(Boolean).join('、')}`] : []
    }
    return b.type === 'chart' && b.targetBlockIds.includes(blockId) && Object.prototype.hasOwnProperty.call(view.chartSelections, b.id)
      ? [`${b.name}：${displayValue(view.chartSelections[b.id])}`] : []
  })
  return sources.length ? <p className="renderer-scope" role="status">当前结果受以下筛选影响：{sources.join('；')}</p> : null
}

export function FilterControls({ runtime, block }: { runtime: AppRuntime; block: Extract<BlockSpec, { type: 'filter' }> }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const view = useSyncExternalStore(runtime.subscribeInteractions, runtime.getInteractionSnapshot, runtime.getInteractionSnapshot)
  const filter = view.filters[block.id] ?? { query: '', values: {} }
  const entity = state.spec.entities.find(e => e.id === boundEntityId(state, block.id))!
  const [error, setError] = useState('')
  function update(query: string, values: Record<string, FieldValue>) {
    const result = runtime.interact({ type: 'filter', blockId: block.id, query, values })
    setError(result.ok ? '' : result.error.message)
  }
  function updateValue(id: string, raw: string, type: string) {
    const values = { ...filter.values }
    if (raw === '') delete values[id]
    else values[id] = type === 'number' ? Number(raw) : type === 'boolean' ? raw === 'true' : raw
    update(filter.query, values)
  }
  return <div className="renderer-editor">
    <p>仅筛选：{block.targetBlockIds.map(id => state.spec.blocks.find(b => b.id === id)!.name).join('、')}。多个条件同时满足时显示；不会修改记录。</p>
    <label>搜索<input type="search" maxLength={200} placeholder="搜索所选字段" value={filter.query} onChange={e => update(e.target.value, filter.values)} /></label>
    {block.fieldIds.map(id => {
      const field = entity.fields.find(f => f.id === id)!
      return <label key={id}><span>{field.name}（精确匹配）</span>{field.type === 'select' || field.type === 'boolean'
        ? <select value={String(filter.values[id] ?? '')} onChange={e => updateValue(id, e.target.value, field.type)}><option value="">全部</option>{(field.type === 'select' ? field.options : ['true', 'false']).map(value => <option key={value} value={value}>{field.type === 'boolean' ? value === 'true' ? '是' : '否' : value}</option>)}</select>
        : <input type={field.type === 'text' ? 'text' : field.type} maxLength={1000} step={field.type === 'number' ? 'any' : undefined} value={String(filter.values[id] ?? '')} onChange={e => updateValue(id, e.target.value, field.type)} />}</label>
    })}
    <button type="button" onClick={() => update('', {})}>清除筛选</button>
    {error && <p role="alert">{error}</p>}
  </div>
}

export function GroupChart({ runtime, block }: { runtime: AppRuntime; block: Extract<BlockSpec, { type: 'chart' }> }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const view = useSyncExternalStore(runtime.subscribeInteractions, runtime.getInteractionSnapshot, runtime.getInteractionSnapshot)
  const points = chartPoints(state, view, block)
  const [error, setError] = useState('')
  const overflow = points.some(p => !Number.isFinite(p.value))
  const low = points.reduce((min, p) => Math.min(min, p.value), 0), high = points.reduce((max, p) => Math.max(max, p.value), 0)
  // Normalize first so opposite large finite values cannot overflow the SVG scale.
  const scale = Math.max(Math.abs(low), Math.abs(high), 1)
  const y = (value: number) => 150 - (value / scale - low / scale) / ((high / scale - low / scale) || 1) * 130
  const width = Math.max(300, points.length * 70)
  const select = (value: FieldValue | null) => {
    const result = runtime.interact({ type: 'chartSelect', blockId: block.id, value })
    setError(result.ok ? '' : result.error.message)
  }
  return <>
    <InteractionScope runtime={runtime} blockId={block.id} />
    <p>{block.chartType === 'bar' ? '柱状图' : '折线图'} · {block.aggregation === 'count' ? '记录数' : block.aggregation === 'sum' ? '数值合计' : '数值均值'}（无分组值的记录不参与）</p>
    {overflow ? <p role="alert">统计数值超出可显示范围，请调整数据或筛选。</p> : !points.length ? <p role="status">暂无可统计数据，请录入记录或清除筛选。</p> : <>
      <div className="renderer-chart-plot"><svg width={width} height="180" role="img" aria-label={`${block.name}，分组数 ${points.length}；具体数值见下方按钮`}>
        <line x1="0" x2={width} y1={y(0)} y2={y(0)} stroke="currentColor" />
        {block.chartType === 'line' && <polyline fill="none" stroke="#4a7a6b" strokeWidth="3" points={points.map((p, i) => `${(i + .5) * width / points.length},${y(p.value)}`).join(' ')} />}
        {points.map((p, i) => block.chartType === 'bar'
          ? <rect key={p.key} x={(i + .15) * width / points.length} width={width / points.length * .7} y={Math.min(y(0), y(p.value))} height={Math.max(1, Math.abs(y(0) - y(p.value)))} fill="#4a7a6b" />
          : <circle key={p.key} cx={(i + .5) * width / points.length} cy={y(p.value)} r="4" fill="#4a7a6b" />)}
      </svg></div>
      <div className="renderer-chart-values" aria-label="图表分组数值">{points.map(p => <button key={p.key} type="button" disabled={!block.targetBlockIds.length} aria-pressed={view.chartSelections[block.id] === p.category} onClick={() => select(view.chartSelections[block.id] === p.category ? null : p.category)}>{p.label}：{p.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</button>)}</div>
    </>}
    {!!block.targetBlockIds.length && <><p>点击分组筛选：{block.targetBlockIds.map(id => state.spec.blocks.find(b => b.id === id)!.name).join('、')}。</p><button type="button" onClick={() => select(null)}>清除图表选择</button></>}
    {error && <p role="alert">{error}</p>}
  </>
}

export function RecordDetails({ runtime, block }: { runtime: AppRuntime; block: Extract<BlockSpec, { type: 'details' }> }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const view = useSyncExternalStore(runtime.subscribeInteractions, runtime.getInteractionSnapshot, runtime.getInteractionSnapshot)
  const entity = state.spec.entities.find(e => e.id === boundEntityId(state, block.id))!
  const row = selectedRecord(state, view, block)
  const [error, setError] = useState('')
  return <>
    <p>在「{state.spec.blocks.find(b => b.id === block.sourceBlockId)!.name}」中点击“查看详情”。</p>
    {row ? <><dl>{block.fieldIds.map(id => <div key={id}><dt>{entity.fields.find(f => f.id === id)!.name}</dt><dd>{displayValue(row.values[id])}</dd></div>)}</dl><button type="button" onClick={() => {
      const result = runtime.interact({ type: 'selectRecord', blockId: block.sourceBlockId, recordId: null }); setError(result.ok ? '' : result.error.message)
    }}>关闭详情</button></> : <p role="status">尚未选择记录，或所选记录已被筛除、删除。</p>}
    {error && <p role="alert">{error}</p>}
  </>
}
