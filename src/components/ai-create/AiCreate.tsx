import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createAppRuntime, type AppRuntime } from '../../model/appRuntime'
import { AppSpecWorkshop } from '../app-builder/AppSpecWorkshop'
import { generateProject } from './generateApp'
import { Logo } from '../Logo'
import { MochiCat } from '../MochiCat'
import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react'
import './ai-create.css'

export function AiCreate() {
  const [idea, setIdea] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [app, setApp] = useState<{ runtime: AppRuntime; generation: number } | null>(null)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort(); active.current = null }, [])

  async function generate(event: FormEvent) {
    event.preventDefault()
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setPending(true)
    setError('')
    try {
      const state = await generateProject(idea, controller.signal)
      const runtime = createAppRuntime(state)
      if (active.current === controller) setApp(current => ({ runtime, generation: (current?.generation ?? 0) + 1 }))
    } catch (failure) {
      if (active.current === controller) setError(failure instanceof Error ? failure.message : '生成失败，请重试。')
    } finally {
      if (active.current === controller) { active.current = null; setPending(false) }
    }
  }

  const prompt = <form className="composer ai-create-prompt" onSubmit={generate} aria-busy={pending}>
    <label htmlFor="software-idea" className="sr-only">你想做什么软件？</label>
    <textarea className="composer__input" id="software-idea" value={idea} maxLength={4000} required disabled={pending} onChange={event => setIdea(event.target.value)} placeholder="告诉 Mochi，你今天想创造什么……例如社团报名工具，包含表单、名单和人数统计。" />
    <div className="composer__bar"><small className="composer__count">{idea.length} / 4000</small><button className="btn-primary" type="submit" disabled={pending || !idea.trim()}>{pending ? <><LoaderCircle size={18} className="spin" aria-hidden="true" />正在生成…</> : <>{error ? '重试生成' : app ? '生成新应用' : '生成应用'}<ArrowRight size={18} aria-hidden="true" /></>}</button></div>
    <p className="ai-create-hint">点击将请求 DeepSeek。生成新应用成功后会替换当前应用；数据仅保留在当前页面，刷新后清空。</p>
  </form>
  return <main className={`ai-create${app ? ' ai-create--workshop' : ' app'}`}>
    {!app && <><div className="app__bg" aria-hidden="true" /><header className="topbar"><Logo /><span className="topbar__tag"><span className="pixel-dot" aria-hidden="true" />AI 创作</span></header></>}
    {app ? <details className="ai-create-regenerate" open={pending || Boolean(error) || undefined}><summary>新的想法 · 重新生成</summary>{prompt}</details> : <div className="main"><div className="home">
      <section className="hero"><p className="eyebrow"><Sparkles size={14} aria-hidden="true" />像搭乐高一样创造软件</p><h1 className="hero__title">把想法，<br /><span className="hero__accent">搭成现实。</span></h1><p className="hero__sub">和 Mochi 一起，把每个奇思妙想搭成属于自己的软件。</p>{prompt}<nav className="ai-create-links" aria-label="演示导航"><a href="/">学习管理 Demo</a><a href="/app-renderer">AppRenderer 示例</a></nav></section>
      <aside className="stage" aria-label="Mochi 展示区"><div className="speech" role="note"><span className="speech__name">Mochi</span>你负责天马行空，我们一起把想法一块块搭起来。</div><div className="stage__scene"><span className="float-brick float-brick--a" aria-hidden="true" /><span className="float-brick float-brick--b" aria-hidden="true" /><span className="float-brick float-brick--c" aria-hidden="true" /><MochiCat className="mochi" /><div className="stage__shadow" aria-hidden="true" /><div className="stage__plate" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div></div></aside>
    </div></div>}
    {pending && <p className="ai-create-status" role="status">AI 正在设计应用，请稍候。已有应用仍可使用。</p>}
    {error && <p role="alert" className="ai-create-error">{error}{app && ' 当前应用和数据已保留。'}</p>}
    {app && <AppSpecWorkshop key={app.generation} runtime={app.runtime} />}
    {!app && <footer className="footer">BlockCraft AI · 把想法，搭成现实</footer>}
  </main>
}
