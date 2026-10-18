import { useState, useSyncExternalStore } from 'react'
import type { WriteAuthorization } from './owner'
import type { CustomProjectSession } from '../../model/customProjectSession'
import { assertJson, cloneJson, id, keys, object } from '../../custom-block/json'
import { assertArtifactReference, type CustomBlockInstance } from '../../custom-block'

/** File contents remain inert JSON. Selection/confirmation is a local draft;
 * install is the only write boundary and recomputes the artifact digest.
 */
export function CustomBlockImport({ owner }: { owner: CustomProjectSession }) {
  const authorization = useSyncExternalStore(owner.subscribe, owner.getAuthorization, owner.getAuthorization)
  const [draftAuthorization, setDraftAuthorization] = useState<WriteAuthorization | null>(null)
  const [draft, setDraft] = useState<{ instance: CustomBlockInstance; artifact: unknown; baseRevision: number; expectedReference: { definitionId: string; versionDigest: string } | null } | null>(null)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  return <details className="custom-block-import"><summary>导入自定义积木</summary>
    <p>选择积木制品 JSON，确认后添加或替换同 ID 积木。源码仅登记，隔离运行暂不可用；替换版本会清除旧运行状态。</p>
    <label>积木制品 JSON<input type="file" accept="application/json,.json" disabled={busy || authorization.readOnly} onChange={async event => {
      const file = event.currentTarget.files?.[0]
      setDraft(null); setFeedback('')
      if (!file) return
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
