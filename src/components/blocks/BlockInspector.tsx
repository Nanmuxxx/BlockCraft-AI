import { useId, useState, type FormEvent } from 'react'
import type { BlockBuilderBindings, BlockModuleData } from './contract'
import { combination, featureKind, hasRelation, RECIPES } from './rules'

interface Props<Id extends string> {
  module: BlockModuleData<Id>
  modules: readonly BlockModuleData<Id>[]
  builder?: BlockBuilderBindings<Id>
  onCombine: () => void
}

export function BlockInspector<Id extends string>({ module, modules, builder, onCombine }: Props<Id>) {
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const inputId = useId()
  const kind = featureKind(module)
  const relations = builder?.relations.filter(({ sourceId, targetId }) => sourceId === module.id || targetId === module.id) ?? []
  const canCombine = modules.some((other) => {
    const candidate = combination(module, other, builder?.availableRecipes ?? [])
    return candidate && !hasRelation(builder?.relations ?? [], candidate)
  })
  const configure = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const name = String(values.get('name') ?? '').trim()
    if (!name) { setError('给这块积木起一个名称吧。'); return }
    setError('')
    if (builder) builder.onEdit({ type: 'configure', moduleId: module.id, name, ...(kind === 'tasks' ? { settings: { showCompleted: values.has('showCompleted') } } : {}) })
  }
  return <aside className="block-canvas-inspector" aria-label={`${module.name}的功能设置`}>
    <div className="block-canvas-inspector-heading"><div><small>这块积木可以做什么</small><h3>{module.name}</h3></div><button type="button" disabled={!canCombine} onClick={onCombine}>组合功能</button></div>
    {!canCombine && builder && <p>暂时没有可组合的积木，或所有可用组合已建立。</p>}
    {builder && <form key={`${module.name}:${module.settings?.showCompleted}`} onSubmit={configure}>
      <label htmlFor={inputId}>在软件中显示的名称</label>
      <div className="block-canvas-name"><input id={inputId} name="name" defaultValue={module.name} required maxLength={30} /><button type="submit">保存设置</button></div>
      {error && <p role="alert">{error}</p>}
      {kind === 'tasks' && <label className="block-canvas-checkbox"><input name="showCompleted" type="checkbox" defaultChecked={module.settings?.showCompleted ?? true} />在任务清单中显示已完成任务</label>}
    </form>}
    {removing ? <div className="block-canvas-remove"><strong>移除「{module.name}」？</strong><p>同时取消 {relations.length} 个组合。已有任务和课程数据会保留，可撤销这次功能修改。</p><button type="button" onClick={() => setRemoving(false)}>保留积木</button><button type="button" onClick={() => builder?.onEdit({ type: 'remove', moduleId: module.id })}>确认移除</button></div>
      : <button type="button" className="block-canvas-remove-button" disabled={!builder} onClick={() => setRemoving(true)}>移除这块积木</button>}
    {relations.map((relation) => <p key={relation.id}>{RECIPES[relation.recipe].undo}</p>)}
  </aside>
}
