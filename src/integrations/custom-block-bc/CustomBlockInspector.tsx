import { useState, useSyncExternalStore } from 'react'
import type { CustomBlockInstance, JsonObject, JsonValue, ObjectSchema, RestrictedSchema } from '../../custom-block'
import { cloneJson } from '../../custom-block/json'
import { referenceOf, type CustomBlockBCAdapter } from './adapter'
import './custom-block-bc.css'

function Fields({ schema, value, path, change }: {
  schema: ObjectSchema; value: JsonObject; path: string[]
  change: (path: string[], value: JsonValue | undefined) => void
}) {
  return <>{Object.entries(schema.properties).map(([key, field]) => {
    const fieldPath = [...path, key], label = field.title ?? key
    const current = value[key], present = Object.prototype.hasOwnProperty.call(value, key), required = schema.required.includes(key)
    const scalarEnum = field.type !== 'object' ? field.enum : undefined
    return <div className="custom-block-bc__field" key={key}>
      {!required && <label className="custom-block-bc__presence"><input type="checkbox" checked={present} aria-label={`启用 ${fieldPath.join('.')}`} onChange={event => change(fieldPath, event.currentTarget.checked ? emptyValue(field) : undefined)} />启用 {label}</label>}
      {(present || required) && (field.type === 'object'
        ? <fieldset><legend>{label}{required ? ' *' : ''}</legend><Fields schema={field} value={(current ?? {}) as JsonObject} path={fieldPath} change={change} /></fieldset>
        : <label><span>{label}{required ? ' *' : ''}</span>
          {scalarEnum ? <select aria-label={fieldPath.join('.')} value={current === undefined ? '' : String(scalarEnum.indexOf(current as never))} onChange={event => change(fieldPath, event.currentTarget.value === '' ? undefined : scalarEnum[Number(event.currentTarget.value)])}>
            <option value="">请选择</option>{scalarEnum.map((value, index) => <option key={index} value={index}>{String(value)}</option>)}
          </select> : field.type === 'boolean'
            ? <select aria-label={fieldPath.join('.')} value={current === undefined ? '' : String(current)} onChange={event => change(fieldPath, event.currentTarget.value === '' ? undefined : event.currentTarget.value === 'true')}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>
            : field.type === 'string'
              ? <input aria-label={fieldPath.join('.')} value={typeof current === 'string' ? current : ''} maxLength={field.maxLength} minLength={field.minLength} onChange={event => change(fieldPath, event.currentTarget.value)} />
              : <input type="number" aria-label={fieldPath.join('.')} value={typeof current === 'number' && Number.isFinite(current) ? current : ''} step={field.type === 'integer' ? 1 : 'any'} min={field.minimum} max={field.maximum} onChange={event => change(fieldPath, event.currentTarget.value.trim() === '' ? undefined : Number(event.currentTarget.value))} />}
        </label>)}
    </div>
  })}</>
}
// Values are explicit UI drafts after the user enables a field, not Schema defaults.
function emptyValue(schema: RestrictedSchema): JsonValue {
  if (schema.type !== 'object' && schema.enum) return schema.enum[0]
  return schema.type === 'object' ? {} : schema.type === 'string' ? '' : schema.type === 'boolean' ? false : 0
}
function Editor({ adapter, instance, schema, baseRevision }: {
  adapter: CustomBlockBCAdapter; instance: CustomBlockInstance; schema: ObjectSchema; baseRevision: number
}) {
  const [draft, setDraft] = useState(() => ({ props: cloneJson(instance.props), baseRevision }))
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const stale = draft.baseRevision !== baseRevision
  const change = (path: string[], value: JsonValue | undefined) => setDraft(previous => {
    const props = cloneJson(previous.props)
    let parent = props
    for (const key of path.slice(0, -1)) {
      if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) parent[key] = {}
      parent = parent[key] as JsonObject
    }
    if (value === undefined) delete parent[path[path.length - 1]]
    else parent[path[path.length - 1]] = value
    return { ...previous, props }
  })
  return <form noValidate aria-label="自定义积木参数" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setFeedback('')
    const result = await adapter.editProps({ baseRevision: draft.baseRevision, instanceId: instance.id, reference: referenceOf(instance), props: draft.props })
    setBusy(false)
    setFeedback(result.ok ? '参数已由宿主校验并保存。' : `${result.error.code}: ${result.error.message}`)
    if (result.ok) {
      const latest = adapter.getSnapshot(), current = latest.custom.instances.find(item => item.id === instance.id)
      if (current && current.versionDigest === instance.versionDigest && current.definitionId === instance.definitionId) setDraft({ props: cloneJson(current.props), baseRevision: latest.revision })
    }
  }}>
    <fieldset disabled={busy}><legend>可编辑参数</legend><Fields schema={schema} value={draft.props} path={[]} change={change} /></fieldset>
    {stale && <p role="alert">项目已变化；请重新载入参数后再保存。</p>}
    <div className="custom-block-bc__actions"><button type="submit" disabled={busy || stale}>保存参数</button>
      <button type="button" disabled={busy} onClick={() => { setDraft({ props: cloneJson(instance.props), baseRevision }); setFeedback('') }}>重新载入参数</button></div>
    {feedback && <p role={feedback.startsWith('参数已') ? 'status' : 'alert'}>{feedback}</p>}
  </form>
}
export function CustomBlockInspector({ adapter, instanceId }: { adapter: CustomBlockBCAdapter; instanceId: string | null }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot)
  const instance = snapshot.custom.instances.find(item => item.id === instanceId)
  const manifest = instance && adapter.manifestFor(instance)
  return <aside className="custom-block-bc custom-block-bc__inspector" aria-label="自定义积木属性"><h2>积木属性</h2>
    {!instance ? <p>请选择一块自定义积木。</p> : !manifest ? <p role="alert">此版本的元数据不可用，暂时无法编辑。</p> : <>
      <h3>{manifest.name}</h3><p>参数修改将在宿主校验通过后保存。</p>
      <Editor key={`${instance.id}/${instance.definitionId}/${instance.versionDigest}`} adapter={adapter} instance={instance} schema={manifest.propsSchema} baseRevision={snapshot.revision} />
    </>}
  </aside>
}
