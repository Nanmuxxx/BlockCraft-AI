import { StudioAccessStatus, type StudioStatus } from "./StudioAccessStatus"
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createAppRuntime, type AppRuntime } from '../../model/appRuntime'
import { AppSpecWorkshop } from '../app-builder/AppSpecWorkshop'
import { createGeneratedArtifactUI, type GeneratedArtifactUI } from '../../integrations/generated-artifact/ui'
import type { RestoredProject } from '../../integrations/project-json/format'
import { ProjectJsonLandingImport } from '../../integrations/project-json/ProjectJsonLandingImport'
import { createProjectJson, serializeProjectJson } from '../../integrations/project-json/format'
import { saveProjectBackup } from '../../integrations/project-json/backups'
import { ProjectJsonBackups } from '../../integrations/project-json/ProjectJsonBackups'
import { assertNoPackageSecrets } from '../../integrations/project-package/security'
import { generateInteractiveProject, generateProject } from './generateApp'
import { loadTrustedPomodoroFixture, trustedPomodoroSource } from './trustedPomodoroFixture'
import { createGalleryPractice } from '../../integrations/gallery-generation/offline'
import { createWorkspaceSession, restoreWorkspace, type WorkspaceSession } from '../../integrations/project-workspace/session'
import { workspaceRepository, type SavedWorkspace } from '../../integrations/project-workspace/repository'
import { Logo } from '../Logo'
import { MochiCat } from '../MochiCat'
import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react'
import './ai-create.css'

export function AiCreate() {
  const [mode, setMode] = useState<'legacy-v1' | 'trusted-interactive' | 'trusted-fixture' | 'gallery-fixture'>('legacy-v1')
  const offline = mode === 'trusted-fixture' || mode === 'gallery-fixture'
  const [loadingSaved, setLoadingSaved] = useState(true)
  const storageSequence = useRef(0)
  const [idea, setIdea] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const importing = useRef(false)
  const [studio, setStudio] = useState<StudioStatus | null>(null)
  const [credential, setCredential] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [app, setApp] = useState<{ runtime: AppRuntime; generation: number; installation: GeneratedArtifactUI; workspace: WorkspaceSession; source: string } | null>(null)
  const currentApp = useRef(app)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort(); active.current = null; currentApp.current?.workspace.dispose() }, [])
  function activate(runtime: AppRuntime, source: string, saved?: SavedWorkspace) {
    const previous = currentApp.current
    const workspace = createWorkspaceSession(runtime, { sequence: saved?.sequence ?? previous?.workspace.getSequence() ?? storageSequence.current,
      workspaceId: saved?.workspaceId, saved })
    const next = { runtime, generation: (previous?.generation ?? 0) + 1, installation: createGeneratedArtifactUI(runtime.customProject), workspace, source }
    previous?.installation.dispose(); previous?.workspace.dispose()
    currentApp.current = next; setApp(next)
  }
  useEffect(() => {
    let stopped = false
    void (async () => {
      try {
        const saved = await workspaceRepository.read()
        if (stopped) return
        storageSequence.current = saved?.sequence ?? 0
        if (saved) {
          const restored = await restoreWorkspace(saved)
          if (!stopped) activate(createAppRuntime(restored.base, restored.artifacts, restored.project), '从本机已保存作品恢复', saved)
        }
      } catch (failure) { if (!stopped) setError(failure instanceof Error ? failure.message : '无法恢复本机保存作品。') }
      finally { if (!stopped) setLoadingSaved(false) }
    })()
    return () => { stopped = true }
  }, [])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const view = currentApp.current?.workspace.getSnapshot()
      if (view?.dirty || view?.busy || view?.recovery) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  async function refreshStudio() {
    try {
      const response = await fetch('/api/studio/status', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
      if (response.ok) setStudio(await response.json())
    } catch { /* A standalone local renderer may not have this deployment endpoint. */ }
  }
  useEffect(() => { void refreshStudio() }, [])
  async function unlock() {
    if (unlocking) return
    setUnlocking(true); setError('')
    try {
      const response = await fetch('/api/studio/session', { method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) })
      setCredential('')
      if (!response.ok) throw new Error(response.status === 429 ? '解锁尝试过于频繁，请一分钟后重试。' : '未能解锁，请检查测试空间访问码。')
      await refreshStudio()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '解锁失败，请重试。') }
    finally { setUnlocking(false) }
  }

  function changeMode(next: typeof mode) {
    if (active.current || importing.current || loadingSaved || next === mode) return
    try { currentApp.current?.workspace.beforeContextChange(); currentApp.current?.installation.beforeContextChange() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '正在确认添加，请稍后重试。'); return }
    setMode(next)
  }

  function cancelGeneration() {
    active.current?.abort()
    active.current = null
    setPending(false)
    setError('已取消生成。')
  }

  async function generate(event: FormEvent) {
    event.preventDefault()
    if (active.current || importing.current || loadingSaved) return
    try { currentApp.current?.workspace.beforeContextChange(); currentApp.current?.installation.beforeContextChange() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '正在确认添加，请稍后重试。'); return }
    const controller = new AbortController()
    active.current = controller
    setPending(true)
    setError('')
    try {
      const requestedMode = mode
      let generatedState
      let generatedSource: string
      if (requestedMode === 'gallery-fixture') {
        generatedState = createGalleryPractice()
        generatedSource = '图库离线练习 · 不调用 AI 模型'
      } else if (requestedMode === 'trusted-fixture') {
        generatedState = await loadTrustedPomodoroFixture(controller.signal)
        generatedSource = trustedPomodoroSource
      } else if (requestedMode === 'trusted-interactive') {
        const generated = await generateInteractiveProject(idea, controller.signal)
        generatedState = generated.state
        generatedSource = `${generated.source === 'deepseek' ? 'DeepSeek 真实生成' : '可信交互 Mock'} · ${generated.model}`
      } else {
        generatedSource = 'AI 应用 · 响应未提供可验证的模型来源'
        generatedState = await generateProject(idea, controller.signal, source => { generatedSource = source })
      }
      if (active.current === controller) {
        // Recheck at async completion: an install may have started during generation.
        // Never put a side effect in a React state updater (StrictMode can replay it).
        currentApp.current?.workspace.beforeContextChange()
        currentApp.current?.installation.beforeContextChange()
        const runtime = createAppRuntime(generatedState)
        const verifyBackup = await backupCurrentProject()
        if (active.current !== controller) return
        verifyBackup()
        currentApp.current?.installation.beforeContextChange()
        currentApp.current?.workspace.beforeContextChange()
        activate(runtime, generatedSource)
      }
    } catch (failure) {
      if (active.current === controller) setError(failure instanceof Error ? failure.message : '生成失败，请重试。')
    } finally {
      if (active.current === controller) { active.current = null; setPending(false) }
      void refreshStudio()
    }
  }

  async function backupCurrentProject() {
    const previous = currentApp.current
    const snapshot = previous?.runtime.customProject.getSnapshot()
    if (previous) {
      const document = await createProjectJson(snapshot!, previous.runtime.customProject.registry)
      assertNoPackageSecrets(document)
      const backup = serializeProjectJson(document)
      await saveProjectBackup(backup, snapshot!.base.spec.name)
    }
    // Recheck synchronously at publication, after all asynchronous backup work.
    return () => {
      if (currentApp.current !== previous || previous?.runtime.customProject.getSnapshot() !== snapshot) throw new Error('当前项目在备份期间发生变化，请重试。')
    }
  }

  async function importProject(restored: RestoredProject) {
    if (active.current || importing.current || loadingSaved) throw new Error('正在读取、生成或导入应用，请稍后再导入。')
    importing.current = true
    try {
      currentApp.current?.workspace.beforeContextChange()
      currentApp.current?.installation.beforeContextChange()
      const runtime = createAppRuntime(restored.base, restored.artifacts, restored.project)
      const verifyBackup = await backupCurrentProject()
      verifyBackup()
      currentApp.current?.installation.beforeContextChange()
      currentApp.current?.workspace.beforeContextChange()
      activate(runtime, '从项目文件恢复 · 点击保存到本机可在刷新后继续')
      setError('')
    } finally { importing.current = false }
  }

  async function recoverSaved() {
    if (active.current || importing.current || loadingSaved || currentApp.current?.workspace.getSnapshot().busy) throw new Error('请先完成当前操作。')
    importing.current = true
    try {
      const saved = await workspaceRepository.read()
      if (!saved) throw new Error('尚无本机保存作品，请先保存或导入项目文件。')
      const restored = await restoreWorkspace(saved)
      const verifyBackup = await backupCurrentProject()
      verifyBackup()
      currentApp.current?.installation.beforeContextChange()
      activate(createAppRuntime(restored.base, restored.artifacts, restored.project), '从本机已保存作品恢复', saved)
      setError('')
    } finally { importing.current = false }
  }

  const prompt = <form className="composer ai-create-prompt" onSubmit={generate} aria-busy={pending}>
    {studio && <div className="ai-create-access">
      {studio.authenticated ? <StudioAccessStatus studio={studio} />
      : studio.configured ? <div><label htmlFor="studio-access">解锁 AI 创作</label><div className="ai-create-access__row"><input id="studio-access" type="password" autoComplete="off" maxLength={43} value={credential} onChange={event => setCredential(event.target.value)} placeholder="输入测试空间访问码（不是 API Key）" /><button type="button" className="btn-secondary" disabled={unlocking || credential.length !== 43} onClick={() => { void unlock() }}>{unlocking ? '解锁中…' : '解锁'}</button></div><small>访问码仅用于本测试空间，API Key 始终保留在服务端。</small></div>
      : <p>{studio.unavailable === 'AI_AUTHORIZATION_EXPIRED' ? '本次 AI 测试授权已到期。' : studio.unavailable === 'AI_AUTHORIZATION_LOCKED' ? '本次 AI 测试授权已安全锁定，需要负责人复核；额度不会自动恢复。' : 'AI 服务正在配置。'}可以体验下方明确标注的离线番茄钟、学习示例和组件展厅。</p>}
    </div>}
    <div className="ai-create-mode"><label htmlFor="generation-mode">创建方式</label>
      <select id="generation-mode" value={mode} disabled={pending || loadingSaved} onChange={event => changeMode(event.target.value as typeof mode)}>
        <option value="legacy-v1">DeepSeek · 自定义数据应用</option>
        <option value="trusted-interactive">DeepSeek · 交互番茄钟</option>
        <option value="trusted-fixture">可信番茄钟（离线演示）</option>
        <option value="gallery-fixture">图库单张练习（离线，不调用模型）</option>
      </select>
    </div>
    {!offline && <div className="ai-create-examples" aria-label="创意灵感">
      <button type="button" disabled={pending} onClick={() => { changeMode('legacy-v1'); setIdea('创建一个社团活动报名工具：包含姓名、专业、报名活动三个字段的表单，可查看报名名单，并统计报名总人数。所有数据从空白开始，由用户真实填写。') }}>社团报名</button>
      <button type="button" disabled={pending} onClick={() => { changeMode('legacy-v1'); setIdea('创建一个个人读书清单：可以录入书名、作者、阅读状态和笔记，查看全部书籍，并统计书籍数量。所有数据初始为空。') }}>读书清单</button>
      <button type="button" disabled={pending} onClick={() => { changeMode('legacy-v1'); setIdea('创建一个活动报名管理工具：录入姓名、部门和报名人数；搜索姓名并按部门筛选名单与人数统计，按部门显示人数合计柱状图，点击图表分组筛选名单，点击名单查看完整报名详情。所有记录初始为空。') }}>交互报名管理</button>
      <button type="button" disabled={pending} onClick={() => { changeMode('trusted-interactive'); setIdea('创建一个名叫「星光专注站」的 25 分钟学习番茄钟，要能开始、暂停、继续和重置计时。') }}>专注番茄钟</button>
    </div>}
    {!offline ? <>
    <label htmlFor="software-idea" className="sr-only">你想做什么软件？</label>
    <textarea className="composer__input" id="software-idea" value={idea} maxLength={4000} required disabled={pending} onChange={event => setIdea(event.target.value)} placeholder="告诉 Mochi，你今天想创造什么……例如社团报名工具，包含表单、名单和人数统计。" />
    </> : <p className="ai-create-hint">{mode === 'gallery-fixture' ? '打开空白图库，练习单张生成、预览、确认采用、本机保存与项目包恢复。图片由本地绘图程序生成，不是 AI 生成。' : `${trustedPomodoroSource}。加载固定的 25 分钟番茄钟配置，由可信内置组件计时；此演示不会根据自然语言生成内容。`}</p>}
    <div className="composer__bar"><small className="composer__count">{offline ? '离线练习 · 无模型费用' : `${idea.length} / 4000`}</small>{pending && <button type="button" className="btn-secondary" onClick={cancelGeneration}>取消生成</button>}<button className="btn-primary" type="submit" disabled={pending || loadingSaved || (!offline && (!idea.trim() || Boolean(studio && !studio.authenticated) || Boolean(studio?.budget?.halted) || Boolean(studio?.budget && studio.budget.maxCalls !== null && studio.budget.calls >= studio.budget.maxCalls) || studio?.budget?.remainingCny === 0))}>{pending ? <><LoaderCircle size={18} className="spin" aria-hidden="true" />处理中…</> : <>{mode === 'gallery-fixture' ? '打开离线图库' : mode === 'trusted-fixture' ? '加载离线番茄钟' : error ? '重试生成' : app ? '生成新应用' : '生成应用'}<ArrowRight size={18} aria-hidden="true" /></>}</button></div>
    {!app && <><ProjectJsonLandingImport onImportProject={importProject} /><ProjectJsonBackups onRestore={importProject} /></>}
    <p className="ai-create-hint">{mode === 'legacy-v1' && 'DeepSeek 根据描述设计表单、列表、统计、搜索筛选、分组图表和记录详情；生成结果经过结构校验。'}{mode === 'trusted-interactive' && 'AI 设计番茄钟配置，内置计时组件负责真实交互。'}成功创建后可预览、编辑和导出，替换前自动保留本地备份；失败或取消保留原应用和数据。当前作品可保存到本机并在刷新后恢复；跨浏览器请下载项目 ZIP 或 JSON。Mochi 修改会先展示预览，经你确认后应用。</p>
  </form>
  return <main className={`ai-create${app ? ' ai-create--workshop' : ' app'}`}>
    {!app && <><div className="app__bg" aria-hidden="true" /><header className="topbar"><Logo /><span className="topbar__tag"><span className="pixel-dot" aria-hidden="true" />AI 创作</span></header></>}
    {app ? <details className="ai-create-regenerate" open={pending || Boolean(error) || undefined}><summary>新的想法 · 重新生成</summary>{prompt}</details> : <div className="main"><div className="home">
      <section className="hero"><p className="eyebrow"><Sparkles size={14} aria-hidden="true" />像搭乐高一样创造软件</p><h1 className="hero__title">把想法，<br /><span className="hero__accent">搭成现实。</span></h1><p className="hero__sub">和 Mochi 一起，用真实 AI 把一句想法变成可操作的应用。</p>{prompt}<nav className="ai-create-links" aria-label="演示导航"><a href="/demo">学习管理示例</a><a href="/app-renderer">积木组件展厅</a></nav></section>
      <aside className="stage" aria-label="Mochi 展示区"><div className="speech" role="note"><span className="speech__name">Mochi</span>你负责天马行空，我们一起把想法一块块搭起来。</div><div className="stage__scene"><span className="float-brick float-brick--a" aria-hidden="true" /><span className="float-brick float-brick--b" aria-hidden="true" /><span className="float-brick float-brick--c" aria-hidden="true" /><MochiCat className="mochi" /><div className="stage__shadow" aria-hidden="true" /><div className="stage__plate" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div></div></aside>
    </div></div>}
    {pending && <p className="ai-create-status" role="status">{mode === 'gallery-fixture' ? '正在创建离线图库' : mode === 'trusted-fixture' ? '正在验证离线配置' : 'AI 正在设计应用'}，请稍候。已有应用仍可使用。</p>}
    {error && <p role="alert" className="ai-create-error">{error}{app && ' 当前应用和数据已保留。'}</p>}
    {app && <p className="ai-create-source" aria-label="当前应用来源">{app.source}</p>}
    {loadingSaved && <p role="status">正在读取本机保存作品…</p>}
    {app && <AppSpecWorkshop key={app.generation} runtime={app.runtime} installation={app.installation} onImportProject={importProject} workspace={app.workspace} onRecoverSaved={recoverSaved} />}
    {!app && <footer className="footer">BlockCraft AI · 把想法，搭成现实</footer>}
  </main>
}
