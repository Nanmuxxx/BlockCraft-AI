import { useState, useSyncExternalStore } from 'react'
import type { WriteAuthorization } from './owner'
import type { CustomProjectSession } from '../../model/customProjectSession'
import { assertJson, cloneJson, id, keys, object } from '../../custom-block/json'
import { assertArtifactReference, type CustomBlockInstance } from '../../custom-block'
import type { GeneratedArtifactUI, InstallUIState } from '../generated-artifact/ui'
import '../generated-artifact/ui.css'

const inactive: InstallUIState = { phase: 'idle', message: '' }
const noopSubscribe = () => () => {}
const inactiveSnapshot = () => inactive

export function GeneratedArtifactPreview({ state: ai, readOnly, action }: {
  state: InstallUIState; readOnly: boolean; action: (name: 'prepare' | 'confirm' | 'cancel') => void
}) {
  return <div className="generated-artifact-preview" aria-label="AI 积木添加预览" aria-busy={['reading', 'preparing', 'confirming'].includes(ai.phase)}>
    {ai.candidate && <div><h3>{ai.candidate.name}</h3><p>{ai.candidate.source}</p><p>精确版本：<code>{ai.candidate.definitionId} / {ai.candidate.versionDigest}</code></p><p>参数：</p><pre>{JSON.stringify(ai.candidate.props, null, 2)}</pre><p><strong>pending-build · 尚未构建，暂不可运行</strong></p></div>}
    {ai.phase === 'loaded' && <button type="button" disabled={readOnly} onClick={() => action('prepare')}>预览添加</button>}
    {ai.phase === 'preview' && <button type="button" disabled={readOnly} onClick={() => action('confirm')}>确认添加</button>}
    {['reading', 'loaded', 'preparing', 'preview', 'error'].includes(ai.phase) && <button type="button" onClick={() => action('cancel')}>取消添加</button>}
    {ai.message && <p role={ai.phase === 'error' ? 'alert' : 'status'}>{ai.message}</p>}
  </div>
}

/** File contents remain inert JSON. Selection/confirmation is a local draft;
 * install is the only write boundary and recomputes the artifact digest.
 */
export function CustomBlockImport({ owner, generated }: { owner: CustomProjectSession; generated?: GeneratedArtifactUI }) {
  const authorization = useSyncExternalStore(owner.subscribe, owner.getAuthorization, owner.getAuthorization)
  const ai = useSyncExternalStore(generated?.subscribe ?? noopSubscribe, generated?.getSnapshot ?? inactiveSnapshot, generated?.getSnapshot ?? inactiveSnapshot)
  const [path, setPath] = useState('manual')
  const aiBusy = ai.phase === 'reading' || ai.phase === 'preparing' || ai.phase === 'confirming'
  const [draftAuthorization, setDraftAuthorization] = useState<WriteAuthorization | null>(null)
  const [draft, setDraft] = useState<{ instance: CustomBlockInstance; artifact: unknown; baseRevision: number; expectedReference: { definitionId: string; versionDigest: string } | null } | null>(null)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  return <details className="custom-block-import"><summary>导入自定义积木</summary>
    {generated && <label>导入方式<select value={path} disabled={busy || aiBusy} onChange={event => {
      try { generated.beforeContextChange(); setPath(event.target.value); setDraft(null); setFeedback('') }
      catch (error) { setFeedback(error instanceof Error ? error.message : '暂不可切换。') }
    }}><option value="manual">手动导入 · 添加或明确换版</option><option value="ai">AI 代码积木 · 仅新增</option></select></label>}
    <p>{path === 'ai' ? '导入已取得的 AI 源码制品，先预览，再由你确认添加。本页面不会调用模型。' : '选择积木制品 JSON，确认后添加或替换同 ID 积木。源码仅登记，隔离运行暂不可用；替换版本会清除旧运行状态。'}</p>
    <label>积木制品 JSON<input type="file" accept="application/json,.json" disabled={busy || aiBusy || authorization.readOnly} onChange={async event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = '' // selecting the same file after cancellation must work.
      setDraft(null); setFeedback('')
      if (!file) return
      if (path === 'ai' && generated) {
        try { await generated.readFile(file) } catch (error) { setFeedback(error instanceof Error ? error.message : '暂不可读取制品。') }
        return
      }
      // Lock the intent/revision before the async file read; input stays disabled until it completes.
      const current = owner.getSnapshot()
      const captured = owner.getAuthorization()
      setDraftAuthorization(captured)
      setBusy(true)
      try {
        if (file.size > 4_000_000) throw new Error('制品文件过大。')
        const input: unknown = JSON.parse(await file.text())
        assertJson(input); object(input); keys(input, ['instance', 'artifact']); object(input.instance)
        keys(input.instance, ['id', 'definitionId', 'versionDigest', 'props']); id(input.instance.id); object(input.instance.props)
        assertArtifactReference({ definitionId: input.instance.definitionId, versionDigest: input.instance.versionDigest })
        const instance = input.instance as unknown as CustomBlockInstance
        const previous = current.custom.instances.find(item => item.id === instance.id)
        setDraft({ instance: cloneJson(instance), artifact: cloneJson(input.artifact), baseRevision: current.revision,
          expectedReference: previous ? { definitionId: previous.definitionId, versionDigest: previous.versionDigest } : null })
      } catch (error) { setFeedback(error instanceof Error ? error.message : '无法读取制品。') }
      finally { setBusy(false) }
    }} /></label>
    {path === 'ai' && generated && <GeneratedArtifactPreview state={ai} readOnly={authorization.readOnly} action={name => {
      const failure = (error: unknown) => setFeedback(error instanceof Error ? error.message : '制品操作失败。')
      try { void Promise.resolve(generated[name]()).catch(failure) } catch (error) { failure(error) }
    }} />}
    {draft && <div><p>{draft.expectedReference ? '替换版本' : '添加积木'}：{String(draft.instance.id)}<br /><code>{String(draft.instance.definitionId)} / {String(draft.instance.versionDigest)}</code></p>
      <button type="button" disabled={busy || authorization.readOnly || draftAuthorization !== authorization} onClick={async () => {
        setBusy(true)
        const result = await owner.install(draft, draftAuthorization!)
        setFeedback(result.ok ? '制品已校验并登记，运行暂不可用。' : `${result.error.code}: ${result.error.message}`)
        if (result.ok) setDraft(null)
        setBusy(false)
      }}>{draft.expectedReference ? '确认替换版本' : '确认添加积木'}</button></div>}
    {draft && draftAuthorization !== authorization && <p role="alert">写入授权已变化，请重新选择制品文件。</p>}
    {feedback && <p role="status">{feedback}</p>}
  </details>
}
