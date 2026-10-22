import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import type { RestoredProject } from './format'
import { parseProjectFile } from '../project-package/file'
import { projectFileErrorMessage } from '../project-package/messages'

export function ProjectJsonLandingImport({ onImportProject }: { onImportProject: (restored: RestoredProject) => void | Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [failed, setFailed] = useState(false)
  async function readFile(file: File) {
    if (busy.current) return
    busy.current = true
    setPending(true); setFailed(false); setFeedback('正在校验项目文件与资源…')
    try {
      await onImportProject(await parseProjectFile(file))
      setFeedback('项目已恢复。')
    } catch (error) {
      setFailed(true); setFeedback(projectFileErrorMessage(error))
    } finally {
      busy.current = false
      setPending(false)
      if (input.current) input.current.value = ''
    }
  }
  return <div className="project-json-landing-import">
    <button type="button" disabled={pending} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />{pending ? '正在恢复…' : '导入项目文件'}</button>
    <input ref={input} type="file" accept="application/json,.json,application/zip,.zip" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file) }} />
    <p role={failed ? 'alert' : 'status'} aria-live="polite">{feedback || '打开项目 ZIP 或旧项目 JSON，恢复图片、数据与布局。'}</p>
  </div>
}
