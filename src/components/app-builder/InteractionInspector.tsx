import { useState, useSyncExternalStore } from 'react'
import type { AppRuntime } from '../../model/appRuntime'
import type { AppCommand, BlockSpec } from '../../model/appSpec'
import { boundEntityId } from '../../model/appInteractions'

type ViewBlock = Extract<BlockSpec, { type: 'filter' | 'chart' | 'details' }>
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

/** Use the existing atomic command/undo path for all structural configuration. */
export function AddInteractionBlock({ runtime }: { runtime: AppRuntime }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const [entityId, setEntityId] = useState('')
  const [feedback, setFeedback] = useState('')
  const entities = state.spec.entities.filter(e => e.fields.length)
  const selectedId = entities.some(e => e.id === entityId) ? entityId : entities[0]?.id ?? ''
  function add(type: ViewBlock['type']) {
    const current = runtime.getSnapshot()
    const entity = current.spec.entities.find(e => e.id === selectedId)
    if (!entity?.fields.length) { setFeedback('请先生成包含业务实体的应用。'); return }
    const bound = current.spec.blocks.filter(b => boundEntityId(current, b.id) === entity.id)
    const targets = bound.filter(b => b.type === 'list' || b.type === 'metric')
    const list = bound.find(b => b.type === 'list')
    const id = newId(type)
    let block: ViewBlock
    if (type === 'filter') {
      const targetBlockIds = bound.filter(b => ['list', 'metric', 'chart'].includes(b.type)).map(b => b.id)
      if (!targetBlockIds.length) { setFeedback('搜索筛选需要同实体的列表、指标或图表作为目标。'); return }
      block = { id, name: `${entity.name}搜索筛选`, type, fieldIds: entity.fields.map(f => f.id), targetBlockIds }
    } else if (type === 'chart') {
      const group = entity.fields.find(f => f.type === 'select' || f.type === 'date') ?? entity.fields[0]
      block = { id, name: `${entity.name}分组统计`, type, chartType: 'bar', groupFieldId: group.id, aggregation: 'count', targetBlockIds: targets.map(b => b.id) }
    } else {
      if (!list) { setFeedback('记录详情需要同实体的列表作为点击来源。'); return }
      block = { id, name: `${entity.name}记录详情`, type, fieldIds: entity.fields.map(f => f.id), sourceBlockId: list.id }
    }
    const command: AppCommand = { type: 'addBlock', block, binding: { id: newId('binding'), type: 'dataBinding', blockId: id, entityId: entity.id } }
    const result = runtime.executeCommand({ requestId: newId('add-view'), baseRevision: current.revision, commands: [command] })
    setFeedback(result.ok ? '积木已添加，可在画布选择后调整字段与联动目标；可撤销。' : result.error.message)
  }
  return <div className="interaction-builder" aria-label="添加交互积木">
    <label>绑定数据<select value={selectedId} onChange={e => setEntityId(e.target.value)} disabled={!entities.length}>{entities.length ? entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>) : <option value="">暂无实体</option>}</select></label>
    <div className="renderer-actions">{(['filter', 'chart', 'details'] as const).map(type => <button key={type} type="button" disabled={!entities.length || runtime.customProject.getAuthorization().readOnly} onClick={() => add(type)}>添加{{ filter: '搜索筛选', chart: '分组图表', details: '记录详情' }[type]}</button>)}</div>
    {feedback && <p role="status">{feedback}</p>}
  </div>
}

export function InteractionInspector({ runtime, block }: { runtime: AppRuntime; block: ViewBlock }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const entity = state.spec.entities.find(e => e.id === boundEntityId(state, block.id))!
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const siblings = state.spec.blocks.filter(b => b.id !== block.id && boundEntityId(state, b.id) === entity.id)
  function save(next: ViewBlock) {
    // The rendered config and revision form one optimistic transaction.
    const result = runtime.executeCommand({ requestId: newId('configure-view'), baseRevision: state.revision, commands: [{ type: 'configureView', blockId: block.id, block: next }] })
    setFeedback({ ok: result.ok, message: result.ok ? '配置已保存，可撤销。' : result.error.message })
  }
  return <section aria-label="交互积木配置">
    <p>字段、来源与联动目标均绑定「{entity.name}」。配置保存后清空当前筛选与选择。</p>
    {block.type === 'chart' ? <>
      <label>图表类型<select value={block.chartType} onChange={e => save({ ...block, chartType: e.target.value as 'bar' | 'line' })}><option value="bar">柱状图</option><option value="line">折线图</option></select></label>
      <label>分组字段<select value={block.groupFieldId} onChange={e => save({ ...block, groupFieldId: e.target.value })}>{entity.fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <label>统计方式<select value={block.aggregation} onChange={e => {
        const aggregation = e.target.value as 'count' | 'sum' | 'average'
        const { valueFieldId: _old, ...base } = block
        save(aggregation === 'count' ? { ...base, aggregation } : { ...base, aggregation, valueFieldId: entity.fields.find(f => f.type === 'number')!.id })
      }}><option value="count">记录数</option><option value="sum" disabled={!entity.fields.some(f => f.type === 'number')}>合计</option><option value="average" disabled={!entity.fields.some(f => f.type === 'number')}>均值</option></select></label>
      {block.aggregation !== 'count' && <label>数值字段<select value={block.valueFieldId} onChange={e => save({ ...block, valueFieldId: e.target.value })}>{entity.fields.filter(f => f.type === 'number').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
    </> : <fieldset><legend>{block.type === 'filter' ? '可搜索和筛选字段' : '详情展示字段'}</legend>{entity.fields.map(f => <label key={f.id}><input type="checkbox" checked={block.fieldIds.includes(f.id)} onChange={e => save({ ...block, fieldIds: e.target.checked ? [...block.fieldIds, f.id] : block.fieldIds.filter(id => id !== f.id) })} />{f.name}</label>)}</fieldset>}
    {block.type === 'details' ? <label>点击来源列表<select value={block.sourceBlockId} onChange={e => save({ ...block, sourceBlockId: e.target.value })}>{siblings.filter(b => b.type === 'list').map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      : <fieldset><legend>联动目标（仅这些积木受影响）</legend>{siblings.filter(b => b.type === 'list' || b.type === 'metric' || (block.type === 'filter' && b.type === 'chart')).map(b => <label key={b.id}><input type="checkbox" checked={block.targetBlockIds.includes(b.id)} onChange={e => save({ ...block, targetBlockIds: e.target.checked ? [...block.targetBlockIds, b.id] : block.targetBlockIds.filter(id => id !== b.id) })} />{b.name}</label>)}</fieldset>}
    <button type="button" disabled={runtime.customProject.getAuthorization().readOnly} onClick={() => {
      const result = runtime.executeCommand({ requestId: newId('remove-view'), baseRevision: state.revision, commands: [{ type: 'removeBlock', blockId: block.id }] })
      setFeedback({ ok: result.ok, message: result.ok ? '积木已删除，可撤销。' : '删除失败：请先解除其他积木对此积木的引用，再重试。' })
    }}>删除此积木</button>
    <p>Mochi 暂未接入这三类积木的修改，请在这里调整配置。</p>
    {feedback && <p role={feedback.ok ? 'status' : 'alert'}>{feedback.message}</p>}
  </section>
}
