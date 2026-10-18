import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { localExportToken } from 'virtual:local-project-export'
import type { CustomProjectSession } from '../../model/customProjectSession'
import { captureExport, ExportFailure } from './capture'

const reasons: Record<string, string> = {
  UNSUPPORTED_APP_SPEC: 'AppSpec v2 可信交互积木暂不支持 React ZIP 导出，已拒绝打包。',
  EXPORT_UNAUTHORIZED: '导出授权无效，请重新打开本机工坊。',
  VERSION_MISSING: '缺少精确版本的源码制品，请重新导入后重试。',
  DIGEST_MISMATCH: '源码制品与版本不符，已拒绝导出。',
  STALE_SNAPSHOT: '项目已变化，请重新导出当前版本。',
  UNSUPPORTED_PROTOCOL: '此自定义积木使用了暂不支持的宿主状态、事件或能力协议。',
  UNSUPPORTED_SOURCE: '此自定义积木的源码不符合导出支持范围。',
  UNSUPPORTED_DEPENDENCY: '此自定义积木的依赖版本不受支持。',
  PRIVATE_CONTENT: '项目包含不适合导出的私密配置，请检查后重试。',
  EXPORT_BUSY: '本机正在打包，请稍后重试。',
}

export function ExportProjectButton({ owner }: { owner: CustomProjectSession }) {
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState({ error: false, message: '' })
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort(); active.current = null }, [owner])

  async function download() {
    if (active.current) return
    if (owner.getSnapshot().base.spec.version !== 1) {
      setFeedback({ error: true, message: `${reasons.UNSUPPORTED_APP_SPEC} 未下载 ZIP。` }); return
    }
    if (!localExportToken) {
      setFeedback({ error: true, message: '下载暂未开放。请在受控本机工坊启动导出；公网部署仍需身份与项目读取授权。' })
      return
    }
    const controller = new AbortController()
    active.current = controller
    setPending(true)
    setFeedback({ error: false, message: '正在校验当前项目并打包…' })
    const timeout = setTimeout(() => controller.abort(), 45_000)
    try {
      const captured = await captureExport(owner)
      if (controller.signal.aborted) return
      const response = await fetch('/api/local-project-export', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localExportToken}` },
        body: JSON.stringify(captured.input), signal: controller.signal, credentials: 'omit', redirect: 'error',
      })
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}))
        throw new ExportFailure(typeof failure.code === 'string' ? failure.code : 'EXPORT_FAILED')
      }
      if (response.headers.get('Content-Type') !== 'application/zip') throw new ExportFailure('INVALID_RESPONSE')
      const blob = await response.blob()
      captured.assertCurrent()
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'blockcraft-project.zip'
      document.body.append(anchor)
      try { anchor.click() } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
      setFeedback({ error: false, message: `React 项目已准备好，已发起下载（版本 ${captured.input.project.revision}）。包含当前记录与参数，请妥善保存。` })
    } catch (error) {
      if (active.current !== controller) return
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'EXPORT_FAILED'
      setFeedback({ error: true, message: `${reasons[code] ?? '导出失败，请检查本机导出服务并重试。'} 未下载 ZIP。` })
    } finally {
      clearTimeout(timeout)
      if (active.current === controller) { active.current = null; setPending(false) }
    }
  }
  return <div className="workshop-export">
    <button type="button" onClick={() => void download()} disabled={pending} aria-describedby="workshop-export-feedback"><Download size={16} aria-hidden="true" />{pending ? '正在导出…' : '导出 React 项目'}</button>
    <p id="workshop-export-feedback" role={feedback.error ? 'alert' : 'status'} aria-live="polite">{feedback.message || '下载源码，继续创造。'}</p>
  </div>
}
