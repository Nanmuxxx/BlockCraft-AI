import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import type { CustomProjectSession } from '../../model/customProjectSession'
import type { RestoredProject } from './format'
import { createProjectJson, serializeProjectJson } from './format'
import { downloadProjectJson } from './download'
import { ProjectJsonBackups } from './ProjectJsonBackups'
import { createProjectPackage } from '../project-package/format'
import { parseProjectFile } from '../project-package/file'
import { downloadProjectPackage } from '../project-package/download'
import { projectFileErrorMessage } from '../project-package/messages'
import { assertNoPackageSecrets } from '../project-package/security'

export function ProjectJsonControls({ owner, onImportProject }: {
  owner: CustomProjectSession
  onImportProject: (restored: RestoredProject) => void | Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [pending, setPending] = useState<'json' | 'zip' | 'import' | null>(null)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>({ error: false, text: '' })

  async function download(kind: 'json' | 'zip') {
    if (busy.current) return
    busy.current = true
    setPending(kind); setFeedback({ error: false, text: '正在校验项目与资源，准备下载…' })
    try {
      const snapshot = owner.getSnapshot()
      if (kind === 'zip') downloadProjectPackage(await createProjectPackage(snapshot, owner.registry))
      else {
        const projectDocument = await createProjectJson(snapshot, owner.registry)
        assertNoPackageSecrets(projectDocument)
        downloadProjectJson(serializeProjectJson(projectDocument), 'blockcraft-project.json')
      }
      setFeedback({ error: false, text: `已发起项目 ${kind.toUpperCase()} 下载（版本 ${snapshot.revision}），请确认浏览器已保存文件。` })
    } catch (error) {
      setFeedback({ error: true, text: projectFileErrorMessage(error) })
    } finally { busy.current = false; setPending(null) }
  }

  async function readFile(file: File) {
    if (busy.current) return
    busy.current = true
    setPending('import'); setFeedback({ error: false, text: '正在校验项目文件与资源，当前项目保持不变…' })
    try {
      const restored = await parseProjectFile(file)
      await onImportProject(restored)
      setFeedback({ error: false, text: `项目文件已导入（版本 ${restored.project.revision}）。` })
    } catch (error) {
      setFeedback({ error: true, text: projectFileErrorMessage(error) })
    } finally {
      busy.current = false
      setPending(null)
      if (input.current) input.current.value = ''
    }
  }

  return <div className="workshop-json-controls" aria-label="项目文件">
    <button type="button" onClick={() => void download('zip')} disabled={pending !== null} aria-describedby="workshop-json-feedback"><Download size={16} aria-hidden="true" />{pending === 'zip' ? '正在打包…' : '下载项目 ZIP'}</button>
    <button type="button" onClick={() => void download('json')} disabled={pending !== null} aria-describedby="workshop-json-feedback"><Download size={16} aria-hidden="true" />{pending === 'json' ? '正在导出…' : '下载项目 JSON'}</button>
    <button type="button" onClick={() => input.current?.click()} disabled={pending !== null} aria-describedby="workshop-json-feedback"><Upload size={16} aria-hidden="true" />{pending === 'import' ? '正在导入…' : '导入项目文件'}</button>
    <input ref={input} type="file" accept="application/json,.json,application/zip,.zip" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file) }} />
    <p id="workshop-json-feedback" role={feedback.error ? 'alert' : 'status'} aria-live="polite">{feedback.text || 'ZIP 包含项目和图片，可在另一浏览器导入并继续编辑；也支持旧项目 JSON。'}</p>
    <ProjectJsonBackups onRestore={onImportProject} />
  </div>
}
