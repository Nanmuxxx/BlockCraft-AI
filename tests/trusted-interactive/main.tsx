// OFFLINE ACCEPTANCE ONLY. Uses unchanged formal Workshop and real server route.
// Not imported by production. No modifications to the temporarily locked UI files.
import { useState, useSyncExternalStore, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import { generateInteractiveProject } from '../../src/components/ai-create/generateApp'
import { createAppRuntime, type AppRuntime } from '../../src/model/appRuntime'
import { AppSpecWorkshop } from '../../src/components/app-builder/AppSpecWorkshop'
function Snapshot({ runtime }: { runtime: AppRuntime }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  return <details><summary>验收快照（测试专用）</summary><pre data-testid="snapshot">{JSON.stringify(state)}</pre></details>
}
function Acceptance() {
  const [idea, setIdea] = useState('做一个 25 分钟的数学专注番茄钟')
  const [app, setApp] = useState<{ runtime: AppRuntime; source: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <><form onSubmit={async event => {
    event.preventDefault(); setError(''); setBusy(true)
    try { const result = await generateInteractiveProject(idea); setApp({ runtime: createAppRuntime(result.state), source: result.source }) }
    catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }}><label>应用需求<input aria-label="应用需求" value={idea} onChange={event => setIdea(event.target.value)} /></label><button disabled={busy}>生成可信配置</button></form>
    <p role="note">离线验收专用：真实 HTTP/DeepSeek 请求格式；模型响应为固定 Fixture；没有付费调用。</p>
    {error && <p role="alert">{error}，现有应用保持原样。</p>}
    {app && <><p data-testid="source">{app.source} · AI 配置 + 可信组件执行</p><AppSpecWorkshop runtime={app.runtime} /><Snapshot runtime={app.runtime} /></>}
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Acceptance /></StrictMode>)
