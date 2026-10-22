import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import type { RestoredProject } from './format'
import { parseProjectJsonText, PROJECT_JSON_MAX_BYTES } from './format'

export function ProjectJsonLandingImport({ onImportProject }: { onImportProject: (restored: RestoredProject) => void | Promise<void> }) {
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  async function readFile(file: File) {
    if (pending) return
    setPending(true); setFeedback('正在校验项目 JSON…')
    try {
      if (file.size > PROJECT_JSON_MAX_BYTES) throw new Error('项目文件超过 4 MB，当前项目未更改。')
      await onImportProject(await parseProjectJsonText(await file.text()))
      setFeedback('项目已恢复。')
    } catch (error) {
      setFeedback(error instanceof Error ? `${error.message} 当前项目未更改。` : '项目 JSON 导入失败，当前项目未更改。')
    } finally {
      setPending(false)
      if (input.current) input.current.value = ''
    }
  }
  return <div className="project-json-landing-import">
    <button type="button" disabled={pending} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />{pending ? '正在恢复…' : '导入项目 JSON'}</button>
    <input ref={input} type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file) }} />
    <p role={feedback.includes('失败') || feedback.includes('损坏') || feedback.includes('不受支持') ? 'alert' : 'status'} aria-live="polite">{feedback || '打开之前下载的项目文件，继续编辑。'}</p>
  </div>
}
