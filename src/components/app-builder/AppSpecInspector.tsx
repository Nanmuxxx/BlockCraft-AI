import { useState } from 'react'
import type { AppCommand, CommandRequest, FieldSpec, ProjectState } from '../../model/appSpec'
import type { AppRuntime } from '../../model/appRuntime'
import './app-spec-inspector.css'

interface AppSpecInspectorProps {
  runtime: AppRuntime
  snapshot: ProjectState
  blockId: string | null
}

let idSequence = 0
function newId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${++idSequence}`}`
}

function target(state: ProjectState, blockId: string | null) {
  const block = state.spec.blocks.find(block => block.id === blockId)
  const bindings = state.spec.relations.filter(relation => relation.blockId === blockId)
  const entity = bindings.length === 1 ? state.spec.entities.find(entity => entity.id === bindings[0].entityId) : undefined
  return { block, entity }
}

/** Only draft inputs and feedback are local; committed configuration comes from the host snapshot. */
export function AppSpecInspector({ runtime, snapshot, blockId }: AppSpecInspectorProps) {
  const [name, setName] = useState('联系方式')
  const [type, setType] = useState<FieldSpec['type']>('text')
  const [required, setRequired] = useState(false)
  const [options, setOptions] = useState('')
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null)
  const { block, entity } = target(snapshot, blockId)

  // Build both the command payload and revision from the same current snapshot, never a render-time copy.
  function submit(build: (state: ProjectState) => AppCommand[] | string, success: string) {
    const current = runtime.getSnapshot()
    const commands = build(current)
    if (typeof commands === 'string') {
      setFeedback({ error: true, message: commands })
      return
    }
    const request: CommandRequest = { requestId: newId('inspector-request'), baseRevision: current.revision, commands }
    const result = runtime.executeCommand(request)
    setFeedback(result.ok
      ? { error: false, message: result.duplicate ? '请求已处理，请以当前配置为准。' : success }
      : { error: true, message: `${result.error.code}: ${result.error.message}${result.error.code === 'REVISION_CONFLICT' ? '；配置已变化，请检查当前字段后重新操作。' : ''}` })
  }

  function toggleField(fieldId: string, checked: boolean) {
    submit(current => {
      const latest = target(current, blockId)
      if (!latest.block || !latest.entity) return '当前积木或绑定实体已失效，请重新选择积木。'
      if (latest.block.type === 'metric') return '指标积木不支持展示字段配置。'
      const field = latest.entity.fields.find(field => field.id === fieldId)
      if (!field) return '字段已不存在，请检查当前配置。'
      if (!checked && latest.block.type === 'form' && field.required) return '表单必须展示全部必填字段，不能移除此字段。'
      // Keep the existing order; newly checked fields are appended in the user's selection order.
      const fieldIds = checked
        ? latest.block.fieldIds.includes(fieldId) ? [...latest.block.fieldIds] : [...latest.block.fieldIds, fieldId]
        : latest.block.fieldIds.filter(id => id !== fieldId)
      if (!fieldIds.length) return '至少保留一个展示字段。'
      return [{ type: 'configureBlockFields', blockId: latest.block.id, fieldIds }]
    }, '展示字段已保存。')
  }

  function addField() {
    submit(current => {
      const latest = target(current, blockId)
      if (!latest.block || !latest.entity) return '当前积木或绑定实体已失效，请重新选择积木。'
      if (!name.trim()) return '请输入字段名称。'
      const fieldOptions = options.split(/\r?\n/).map(option => option.trim())
      if (type === 'select' && (fieldOptions.some(option => !option) || new Set(fieldOptions).size !== fieldOptions.length)) {
        return '选项不能为空或重复，请每行输入一个不同的选项。'
      }
      const base = { id: newId('inspector-field'), name: name.trim(), required }
      const field: FieldSpec = type === 'select' ? { ...base, type, options: fieldOptions } : { ...base, type }
      return [{ type: 'addField', entityId: latest.entity.id, field }]
    }, block?.type === 'metric' ? '实体字段已新增。' : '实体字段已新增，请勾选它以加入当前积木的展示字段。')
  }

  return <aside className="app-spec-inspector" aria-label="积木属性">
    <h2>积木属性</h2>
    {!block ? <p className="app-spec-inspector__empty">请选择一块积木，查看并编辑属性。</p> : <>
      <h3>{block.name}</h3>
      <dl>
        <dt>类型</dt><dd>{block.type}</dd>
        <dt>积木 ID</dt><dd><code>{block.id}</code></dd>
        <dt>绑定实体</dt><dd>{entity ? <>{entity.name}<br /><code>{entity.id}</code></> : '绑定异常'}</dd>
      </dl>
      {!entity ? <p role="alert">绑定异常：当前积木需要唯一的数据绑定及有效实体，请联系负责人修复。</p> : <>
        {block.type === 'metric' ? <section aria-label="当前配置">
          <h3>当前配置</h3><p>聚合：{block.aggregation}</p>
          {block.aggregation !== 'count' && <p>字段：{entity.fields.find(field => field.id === block.fieldId)?.name ?? block.fieldId}（{block.fieldId}）</p>}
        </section> : <>
          <section aria-label="当前配置">
            <h3>当前展示顺序</h3>
            <ol>{block.fieldIds.map(id => {
              const field = entity.fields.find(field => field.id === id)
              return <li key={id}>{field ? `${field.name} · ${field.type} · ${field.required ? '必填' : '可选'}` : `未知字段：${id}`}</li>
            })}</ol>
          </section>
          <fieldset>
            <legend>展示字段</legend>
            <p>勾选即保存，新选字段追加到末尾；取消勾选仅移除展示。</p>
            {block.type === 'form' && <p>表单必须保留全部必填字段。</p>}
            {entity.fields.map(field => <label className="app-spec-inspector__choice" key={field.id}>
              <input type="checkbox" aria-label={`展示 ${field.name}`} checked={block.fieldIds.includes(field.id)} onChange={event => toggleField(field.id, event.currentTarget.checked)} />
              <span>{field.name}<small>{field.type} · {field.required ? '必填' : '可选'} · {field.id}</small></span>
            </label>)}
          </fieldset>
        </>}
        <form onSubmit={event => { event.preventDefault(); addField() }} aria-label="新增实体字段">
          <h3>新增实体字段</h3>
          <label>字段名称<input value={name} onChange={event => setName(event.currentTarget.value)} /></label>
          <label>字段类型<select value={type} onChange={event => setType(event.currentTarget.value as FieldSpec['type'])}>
            {(['text', 'number', 'boolean', 'date', 'select'] as const).map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label className="app-spec-inspector__choice"><input type="checkbox" checked={required} onChange={event => setRequired(event.currentTarget.checked)} />必填字段</label>
          {required && <p>新增必填字段可能因现有记录缺值或其他表单未展示该字段而被拒绝。</p>}
          {type === 'select' && <label>选项（每行一个，不可为空或重复）<textarea value={options} onChange={event => setOptions(event.currentTarget.value)} /></label>}
          <p>{block.type === 'metric' ? '字段添加到绑定实体；可在对应表单或列表中分别勾选展示。' : '字段添加到绑定实体后，可在上方勾选展示；其他积木的展示配置需分别设置。'}</p>
          <button type="submit">新增字段</button>
        </form>
      </>}
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'app-spec-inspector__error' : 'app-spec-inspector__success'}>{feedback.message}</p>}
    </>}
  </aside>
}
