import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createAppRuntime, type AppRuntime } from '../../model/appRuntime'
import { AppRenderer } from '../app-renderer/AppRenderer'
import { generateProject } from './generateApp'
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

  return <main className="ai-create">
    <nav aria-label="演示导航"><a href="/">学习管理 Demo</a><a href="/app-renderer">AppRenderer 示例</a></nav>
    <header><p>BlockCraft AI</p><h1>把你的创意变成可用的软件</h1><p>描述需要的表单、列表和统计，点击生成后即可使用。</p></header>
    <form className="ai-create-prompt" onSubmit={generate} aria-busy={pending}>
      <label htmlFor="software-idea">你想做什么软件？</label>
      <textarea id="software-idea" value={idea} maxLength={4000} required disabled={pending} onChange={event => setIdea(event.target.value)} placeholder="例如：做一个社团活动报名工具，记录姓名、意向部门，并统计报名人数。" />
      <div><small>{idea.length} / 4000</small><button type="submit" disabled={pending || !idea.trim()}>{pending ? '正在生成…' : error ? '重试生成' : app ? '生成新应用' : '生成应用'}</button></div>
      <p className="ai-create-hint">点击将请求 DeepSeek。生成新应用成功后会替换当前应用；数据仅保留在当前页面，刷新后清空。</p>
    </form>
    {pending && <p role="status">AI 正在设计应用，请稍候。已有应用仍可使用。</p>}
    {error && <p role="alert" className="ai-create-error">{error}{app && ' 当前应用和数据已保留。'}</p>}
    {app ? <section aria-label="生成的应用"><h2>{app.runtime.getSnapshot().spec.name}</h2><AppRenderer key={app.generation} runtime={app.runtime} /></section>
      : !pending && <p className="ai-create-empty">生成后，表单、列表与统计会显示在这里。</p>}
  </main>
}
