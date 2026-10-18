import { useEffect, useState, useSyncExternalStore } from 'react'
import type { BlockSpec } from '../../model/appSpec'
import { timerRemaining, type AppRuntime } from '../../model/appRuntime'

/** Only trusted React implements behavior. Model strings are rendered as text. */
export function Pomodoro({ runtime, block }: { runtime: AppRuntime; block: Extract<BlockSpec, { type: 'pomodoro' }> }) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const authorization = useSyncExternalStore(runtime.subscribe, runtime.customProject.getAuthorization, runtime.customProject.getAuthorization)
  const timer = snapshot.timers?.[block.id] ?? { remainingMs: block.durationSeconds * 1000, startedAt: null }
  const [now, setNow] = useState(Date.now)
  const [error, setError] = useState('')
  const remaining = Math.ceil(timerRemaining(timer, Math.max(now, Date.now())) / 1000)
  const running = timer.startedAt !== null && remaining > 0
  useEffect(() => {
    if (!running) return
    const refresh = () => setNow(Date.now())
    const id = setInterval(refresh, 100)
    // Visibility changes and BFCache restore can precede the next throttled tick.
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [timer.startedAt, running])
  function act(action: 'start' | 'pause' | 'reset') {
    const result = runtime.timerAction(block.id, action)
    setNow(Date.now()); setError(result.ok ? '' : result.error.message)
  }
  return <section className="renderer-block renderer-block--pomodoro" aria-label={block.name}>
    <h2>{block.name}</h2><p>时长：{block.durationSeconds} 秒 · 可信番茄钟</p>
    <output className="renderer-metric" aria-label="剩余时间">{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</output>
    <p role="status">{remaining === 0 ? '本轮专注已完成' : running ? '计时中' : '已暂停 / 待开始'}</p>
    <div className="renderer-actions"><button disabled={authorization.readOnly || running || remaining === 0} onClick={() => act('start')}>开始</button><button disabled={authorization.readOnly || !running} onClick={() => act('pause')}>暂停</button><button disabled={authorization.readOnly} onClick={() => act('reset')}>重置</button></div>
    {error && <p role="alert">{error}</p>}
  </section>
}
