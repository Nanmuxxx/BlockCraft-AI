import { useState } from 'react'
import type { AppCommand, CommandRequest, FieldSpec, ProjectState, ProjectAsset } from '../../model/appSpec'
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
  const [assetBusy, setAssetBusy] = useState(false)
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
      if (latest.block.type !== 'list' && latest.block.type !== 'form') return '当前积木不支持展示字段配置。'
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

  function runCommands(commands: AppCommand[], success: string, authorization = runtime.customProject.getAuthorization()) {
    const current = runtime.getSnapshot()
    const request: CommandRequest = { requestId: newId('inspector-request'), baseRevision: current.revision, commands }
    const result = runtime.executeCommand(request, authorization)
    setFeedback(result.ok
      ? { error: false, message: result.duplicate ? '请求已处理，请以当前配置为准。' : success }
      : { error: true, message: `${result.error.code}: ${result.error.message}` })
  }

  async function importImage(file: File | undefined) {
    if (!file || assetBusy) return
    const authorization = runtime.customProject.getAuthorization()
    setAssetBusy(true)
    try {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片。')
      if (file.size <= 0 || file.size > 512 * 1024) throw new Error('单张图片大小需在 1 字节到 512 KiB 之间。')
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('读取图片失败，请重试。'))
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片格式无效。'))
        reader.readAsDataURL(file)
      })
      const asset: ProjectAsset = { id: newId('image'), name: file.name.slice(0, 120) || '图片', altText: file.name.slice(0, 240), mimeType: file.type as ProjectAsset['mimeType'], dataUrl }
      runCommands([{ type: 'addProjectAsset', asset }], '图片已加入项目资源。', authorization)
    } catch (error) {
      setFeedback({ error: true, message: error instanceof Error ? error.message : '导入图片失败。' })
    } finally { setAssetBusy(false) }
  }

  function toggleGalleryAsset(assetId: string, checked: boolean) {
    const current = runtime.getSnapshot()
    const gallery = current.spec.blocks.find(item => item.id === blockId)
    if (!gallery || gallery.type !== 'gallery') return
    const imageIds = checked
      ? gallery.imageIds.includes(assetId) ? [...gallery.imageIds] : [...gallery.imageIds, assetId]
      : gallery.imageIds.filter(id => id !== assetId)
    runCommands([{ type: 'configureGallery', blockId: gallery.id, imageIds }], '画廊图片已保存。')
  }

  function removeAsset(assetId: string) {
    runCommands([{ type: 'removeProjectAsset', assetId }], '项目图片已移除。')
  }

  return <aside className="app-spec-inspector" aria-label="积木属性">
    <h2>积木属性</h2>
    {!block ? <p className="app-spec-inspector__empty">请选择一块积木，查看并编辑属性。</p> : <>
      <h3>{block.name}</h3>
      <details><summary>积木与数据详情</summary><dl>
        <dt>类型</dt><dd>{block.type}</dd>
        <dt>积木 ID</dt><dd><code>{block.id}</code></dd>
        <dt>绑定实体</dt><dd>{block.type === 'pomodoro' || block.type === 'gallery' ? '无需数据绑定' : entity ? <>{entity.name}<br /><code>{entity.id}</code></> : '绑定异常'}</dd>
      </dl></details>
      {block.type === 'pomodoro' ? <section aria-label="番茄钟配置"><p>时长：{block.durationSeconds} 秒</p><p>可信交互协议：1 · AppSpec v2</p><p>开始 / 暂停 / 重置由内置 React 组件执行。此版本暂不支持 ZIP 导出。</p></section>
        : block.type === 'gallery' ? <section className="app-spec-gallery-editor" aria-label="画廊配置">
          <h3>项目图片</h3>
          <p>导入 PNG、JPEG、WebP 或 GIF 文件，最多 32 张；单张不超过 512 KiB，项目总量不超过 1 MiB。</p>
          <label>添加图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={assetBusy} onChange={event => { void importImage(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></label>
          <fieldset><legend>画廊展示图片</legend>
            {Object.values(snapshot.assets ?? {}).length ? Object.values(snapshot.assets ?? {}).map(asset => <div className="app-spec-gallery-editor__asset" key={asset.id}>
              <label className="app-spec-inspector__choice"><input type="checkbox" checked={block.imageIds.includes(asset.id)} onChange={event => toggleGalleryAsset(asset.id, event.currentTarget.checked)} /><span>{asset.name}<small>{asset.mimeType} · {(asset.dataUrl.length * 3 / 4 / 1024).toFixed(0)} KiB</small></span></label>
              <button type="button" disabled={snapshot.spec.blocks.some(candidate => candidate.type === 'gallery' && candidate.imageIds.includes(asset.id))} onClick={() => removeAsset(asset.id)}>移除资源</button>
            </div>) : <p>尚无项目图片。</p>}
          </fieldset>
          {!block.imageIds.length && <p>画廊为空。选择项目图片后会显示在 C 模式。</p>}
          <p>布局：网格 · 交互：点击预览</p>
        </section>
        : !entity ? <p role="alert">绑定异常：当前积木需要唯一的数据绑定及有效实体，请联系负责人修复。</p> : <>
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
