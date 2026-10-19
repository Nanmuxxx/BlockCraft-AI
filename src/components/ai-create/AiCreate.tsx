import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createAppRuntime, type AppRuntime } from '../../model/appRuntime'
import { AppSpecWorkshop } from '../app-builder/AppSpecWorkshop'
import { createGeneratedArtifactUI, type GeneratedArtifactUI } from '../../integrations/generated-artifact/ui'
import { generateInteractiveProject, generateProject } from './generateApp'
import { loadTrustedPomodoroFixture, trustedPomodoroSource } from './trustedPomodoroFixture'
import { Logo } from '../Logo'
import { MochiCat } from '../MochiCat'
import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react'
import './ai-create.css'

export function AiCreate() {
  const [mode, setMode] = useState<'legacy-v1' | 'trusted-interactive' | 'trusted-fixture'>('legacy-v1')
  const [idea, setIdea] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [app, setApp] = useState<{ runtime: AppRuntime; generation: number; installation: GeneratedArtifactUI; source: string } | null>(null)
  const currentApp = useRef(app)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])

  function changeMode(next: typeof mode) {
    if (active.current || next === mode) return
    try { currentApp.current?.installation.beforeContextChange() }
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
    if (active.current) return
    try { currentApp.current?.installation.beforeContextChange() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '正在确认添加，请稍后重试。'); return }
    const controller = new AbortController()
    active.current = controller
    setPending(true)
    setError('')
    try {
      const requestedMode = mode
      let generatedState
      let generatedSource: string
      if (requestedMode === 'trusted-fixture') {
        generatedState = await loadTrustedPomodoroFixture(controller.signal)
        generatedSource = trustedPomodoroSource
      } else if (requestedMode === 'trusted-interactive') {
        const generated = await generateInteractiveProject(idea, controller.signal)
        generatedState = generated.state
        generatedSource = `${generated.source === 'deepseek' ? '可信 AI 生成' : '可信交互 Mock'} · ${generated.model}`
      } else {
        generatedState = await generateProject(idea, controller.signal)
        generatedSource = '原有 AppSpec v1 生成入口 · 响应未提供可验证的模型来源'
      }
      if (active.current === controller) {
        // Recheck at async completion: an install may have started during generation.
        // Never put a side effect in a React state updater (StrictMode can replay it).
        currentApp.current?.installation.beforeContextChange()
        const runtime = createAppRuntime(generatedState)
        currentApp.current?.installation.dispose()
        const next = { runtime, generation: (currentApp.current?.generation ?? 0) + 1, installation: createGeneratedArtifactUI(runtime.customProject), source: generatedSource }
        currentApp.current = next
        setApp(next)
      }
    } catch (failure) {
      if (active.current === controller) setError(failure instanceof Error ? failure.message : '生成失败，请重试。')
    } finally {
      if (active.current === controller) { active.current = null; setPending(false) }
    }
  }

  const prompt = <form className="composer ai-create-prompt" onSubmit={generate} aria-busy={pending}>
    <div className="ai-create-mode"><label htmlFor="generation-mode">创建方式</label>
      <select id="generation-mode" value={mode} disabled={pending} onChange={event => changeMode(event.target.value as typeof mode)}>
        <option value="legacy-v1">AI 应用（原有 v1）</option>
        <option value="trusted-interactive">可信 AI 番茄钟（v2）</option>
        <option value="trusted-fixture">可信番茄钟（离线演示）</option>
      </select>
    </div>
    {mode !== 'trusted-fixture' ? <>
    <label htmlFor="software-idea" className="sr-only">你想做什么软件？</label>
    <textarea className="composer__input" id="software-idea" value={idea} maxLength={4000} required disabled={pending} onChange={event => setIdea(event.target.value)} placeholder="告诉 Mochi，你今天想创造什么……例如社团报名工具，包含表单、名单和人数统计。" />
    </> : <p className="ai-create-hint">{trustedPomodoroSource}。加载固定的 25 分钟番茄钟配置，由可信内置组件计时；此演示不会根据自然语言生成内容。</p>}
    <div className="composer__bar"><small className="composer__count">{mode === 'trusted-fixture' ? '固定配置 · 25 分钟' : `${idea.length} / 4000`}</small>{pending && <button type="button" className="btn-secondary" onClick={cancelGeneration}>取消生成</button>}<button className="btn-primary" type="submit" disabled={pending || (mode !== 'trusted-fixture' && !idea.trim())}>{pending ? <><LoaderCircle size={18} className="spin" aria-hidden="true" />处理中…</> : <>{mode === 'trusted-fixture' ? '加载离线番茄钟' : error ? '重试生成' : app ? '生成新应用' : '生成应用'}<ArrowRight size={18} aria-hidden="true" /></>}</button></div>
    <p className="ai-create-hint">{mode === 'legacy-v1' && '点击将请求 DeepSeek。'}{mode === 'trusted-interactive' && '可信 AI v2 目前仅支持番茄钟配置；服务端审批与 Gateway 预算未就绪时会拒绝请求。'}成功创建后会替换当前应用；失败或取消保留原应用和数据。数据仅保留在当前页面，刷新后清空。</p>
  </form>
  return <main className={`ai-create${app ? ' ai-create--workshop' : ' app'}`}>
    {!app && <><div className="app__bg" aria-hidden="true" /><header className="topbar"><Logo /><span className="topbar__tag"><span className="pixel-dot" aria-hidden="true" />AI 创作</span></header></>}
    {app ? <details className="ai-create-regenerate" open={pending || Boolean(error) || undefined}><summary>新的想法 · 重新生成</summary>{prompt}</details> : <div className="main"><div className="home">
      <section className="hero"><p className="eyebrow"><Sparkles size={14} aria-hidden="true" />像搭乐高一样创造软件</p><h1 className="hero__title">把想法，<br /><span className="hero__accent">搭成现实。</span></h1><p className="hero__sub">和 Mochi 一起，把每个奇思妙想搭成属于自己的软件。</p>{prompt}<nav className="ai-create-links" aria-label="演示导航"><a href="/">学习管理 Demo</a><a href="/app-renderer">AppRenderer 示例</a></nav></section>
      <aside className="stage" aria-label="Mochi 展示区"><div className="speech" role="note"><span className="speech__name">Mochi</span>你负责天马行空，我们一起把想法一块块搭起来。</div><div className="stage__scene"><span className="float-brick float-brick--a" aria-hidden="true" /><span className="float-brick float-brick--b" aria-hidden="true" /><span className="float-brick float-brick--c" aria-hidden="true" /><MochiCat className="mochi" /><div className="stage__shadow" aria-hidden="true" /><div className="stage__plate" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div></div></aside>
    </div></div>}
    {pending && <p className="ai-create-status" role="status">{mode === 'trusted-fixture' ? '正在验证离线配置' : 'AI 正在设计应用'}，请稍候。已有应用仍可使用。</p>}
    {error && <p role="alert" className="ai-create-error">{error}{app && ' 当前应用和数据已保留。'}</p>}
    {app && <p className="ai-create-source" aria-label="当前应用来源">{app.source}</p>}
    {app && <AppSpecWorkshop key={app.generation} runtime={app.runtime} installation={app.installation} />}
    {!app && <footer className="footer">BlockCraft AI · 把想法，搭成现实</footer>}
  </main>
}
