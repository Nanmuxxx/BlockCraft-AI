import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import type { CustomProjectSession } from '../../model/customProjectSession'
import type { RestoredProject } from './format'
import { createProjectJson, parseProjectJsonText, serializeProjectJson, PROJECT_JSON_MAX_BYTES } from './format'
import { downloadProjectJson } from './download'
import { ProjectJsonBackups } from './ProjectJsonBackups'

const messages: Record<string, string> = {
  LIMIT: '项目 JSON 超过 4 MB，当前项目未更改。',
  INVALID_FILE: '项目 JSON 无效或已损坏，当前项目未更改。',
  UNSUPPORTED_FORMAT: '项目 JSON 格式版本不受支持，当前项目未更改。',
  VERSION_MISSING: '项目引用的组件版本不完整，当前项目未更改。',
  DIGEST_MISMATCH: '项目组件版本校验失败，当前项目未更改。',
}
function message(error: unknown, fallback: string) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return messages[code] ?? (error instanceof Error ? error.message : fallback)
}

export function ProjectJsonControls({ owner, onImportProject }: {
  owner: CustomProjectSession
  onImportProject: (restored: RestoredProject) => void | Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<'export' | 'import' | null>(null)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>({ error: false, text: '' })

  async function download() {
    if (pending) return
    setPending('export'); setFeedback({ error: false, text: '正在校验并准备项目 JSON…' })
    try {
      const projectDocument = await createProjectJson(owner.getSnapshot(), owner.registry)
      const text = serializeProjectJson(projectDocument)
      downloadProjectJson(text, 'blockcraft-project.json')
      setFeedback({ error: false, text: `已发起项目 JSON 下载（版本 ${projectDocument.project.revision}），请确认浏览器已保存文件。` })
    } catch (error) {
      setFeedback({ error: true, text: `${message(error, '项目 JSON 导出失败。')} 当前项目未更改。` })
    } finally { setPending(null) }
  }

  async function readFile(file: File) {
    if (pending) return
    setPending('import'); setFeedback({ error: false, text: '正在校验项目 JSON，当前项目保持不变…' })
    try {
      if (file.size > PROJECT_JSON_MAX_BYTES) throw new Error('项目文件超过 4 MB，当前项目未更改。')
      const restored = await parseProjectJsonText(await file.text())
      await onImportProject(restored)
      setFeedback({ error: false, text: `项目 JSON 已导入（版本 ${restored.project.revision}）。` })
    } catch (error) {
      setFeedback({ error: true, text: `${message(error, '项目 JSON 导入失败。')} 当前项目未更改。` })
    } finally {
      setPending(null)
      if (input.current) input.current.value = ''
    }
  }

  return <div className="workshop-json-controls" aria-label="项目 JSON">
    <button type="button" onClick={() => void download()} disabled={pending !== null} aria-describedby="workshop-json-feedback"><Download size={16} aria-hidden="true" />{pending === 'export' ? '正在导出…' : '下载项目 JSON'}</button>
    <button type="button" onClick={() => input.current?.click()} disabled={pending !== null} aria-describedby="workshop-json-feedback"><Upload size={16} aria-hidden="true" />{pending === 'import' ? '正在导入…' : '导入项目 JSON'}</button>
    <input ref={input} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file) }} />
    <p id="workshop-json-feedback" role={feedback.error ? 'alert' : 'status'} aria-live="polite">{feedback.text || '下载后可稍后继续编辑，导入失败不会覆盖当前项目。'}</p>
    <ProjectJsonBackups onRestore={onImportProject} />
  </div>
}
