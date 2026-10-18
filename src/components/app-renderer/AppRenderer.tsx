import { useState, useSyncExternalStore } from 'react'
import type { BlockSpec, EntityRecord, FieldSpec } from '../../model/appSpec'
import { metricValue, parseFieldDraft, type AppRuntime, type FieldDraft } from '../../model/appRuntime'
import './app-renderer.css'
import { Pomodoro } from './Pomodoro'

function RecordEditor({ fields, initial, onSave, onCancel }: {
  fields: FieldSpec[]; initial?: EntityRecord
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
    <div className="renderer-actions"><button type="submit">{initial ? '保存修改' : '提交'}</button>{onCancel && <button type="button" onClick={onCancel}>取消</button>}</div>
  </form>
}

function RecordList({ runtime, entityId, fieldIds }: { runtime: AppRuntime; entityId: string; fieldIds: string[] }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const entity = state.spec.entities.find(entity => entity.id === entityId)!
  const fields = fieldIds.map(id => entity.fields.find(field => field.id === id)!)
  const rows = state.records[entityId] ?? []
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
    <button type="button" onClick={() => { setAdding(true); setEditing(null) }}>新增记录</button>
    {adding && <RecordEditor fields={editorFields} onSave={create} onCancel={() => setAdding(false)} />}
    {rows.length === 0 && <p>暂无记录</p>}
    <div className="renderer-table"><table>
      <thead><tr>{fields.map(field => <th key={field.id}>{field.name}</th>)}<th>操作</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>{fields.map(field => <td key={field.id}>{typeof row.values[field.id] === 'boolean' ? row.values[field.id] ? '是' : '否' : String(row.values[field.id] ?? '—')}</td>)}
        <td><div className="renderer-actions"><button type="button" onClick={() => { setEditing(row.id); setAdding(false) }}>编辑</button><button type="button" onClick={() => {
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

/** Render exactly one trusted builtin against the shared runtime facade. */
export function BuiltinBlockRenderer({ runtime, blockId }: { runtime: AppRuntime; blockId: BlockSpec['id'] }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const block = state.spec.blocks.find(block => block.id === blockId)
  const binding = state.spec.relations.find(relation => relation.blockId === blockId)
  const entity = state.spec.entities.find(entity => entity.id === binding?.entityId)
  if (block?.type === 'pomodoro') return <Pomodoro runtime={runtime} block={block} />
  if (!block || !entity) return null
  return <section className={`renderer-block renderer-block--${block.type}`} aria-label={block.name}>
    <h2>{block.name}</h2>
    {block.type === 'metric' ? <output className="renderer-metric" aria-live="polite">{metricValue(state, block).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</output>
      : block.type === 'list' ? <RecordList runtime={runtime} entityId={entity.id} fieldIds={block.fieldIds} />
        : <RecordEditor fields={block.fieldIds.map(id => entity.fields.find(field => field.id === id)!)} onSave={values => runtime.dispatch({ type: 'create', entityId: entity.id, record: { id: `record-${crypto.randomUUID()}`, values } })} />}
  </section>
}

/** Legacy/Demo composition retains canonical v1 ordering. */
export function AppRenderer({ runtime }: { runtime: AppRuntime }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  return <div className="app-renderer">{state.spec.blocks.map(block => <BuiltinBlockRenderer key={block.id} runtime={runtime} blockId={block.id} />)}</div>
}
