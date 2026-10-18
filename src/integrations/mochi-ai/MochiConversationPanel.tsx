import { useEffect, useState, useSyncExternalStore } from 'react'
import { createWorkshopMochiConversation, type ConversationHost } from './workshop.mjs'
import type { createMochiConversation } from './client.mjs'
import './conversation.css'

type Conversation = ReturnType<typeof createMochiConversation>
/** Optional, independent composition surface. The integrator owns mounting and the host. */
export function MochiConversationPanel({ host }: { host: ConversationHost }) {
  const [owner, setOwner] = useState<{ host: ConversationHost; conversation: Conversation } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    let live = true
    try {
      const bridge = createWorkshopMochiConversation(host)
      setOwner({ host, conversation: bridge.conversation })
      void bridge.conversation.refreshStatus().catch(() => { if (live) setError('Mochi 暂时无法连接，请稍后重试。') })
      return () => { live = false; bridge.dispose() }
    } catch { setError('当前结构暂不支持 AI 分析，请缩小分析范围。') }
  }, [host])
  if (!owner || owner.host !== host) return <p role="status">{error || '正在检查 Mochi AI 状态…'}</p>
  return <ConversationView conversation={owner.conversation} connectionError={error} />
}
function ConversationView({ conversation, connectionError }: { conversation: Conversation; connectionError: string }) {
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot, conversation.getSnapshot)
  const [prompt, setPrompt] = useState('')
  const [actionError, setActionError] = useState('')
  function act(action: () => unknown) {
    setActionError('')
    void Promise.resolve().then(action).catch(() => setActionError('这次没有完成，可以稍后再试。'))
  }
  return <section className="mochi-conversation" aria-label="和 Mochi 聊聊">
    <header><strong>和 Mochi 聊聊</strong><span>{state.busy ? '想一想…' : state.enabled ? '一起完善你的应用' : 'AI 尚未启用'}</span></header>
    <p className="mochi-conversation__privacy">只分析项目结构和你输入的内容。请勿输入业务记录或密钥。</p>
    <label><input type="checkbox" checked={state.proactiveEnabled} disabled={!state.enabled}
      onChange={event => { const enabled = event.target.checked; act(() => conversation.setProactive(enabled)) }} />主动建议</label>
    <div role="log" aria-label="聊天记录" aria-live="polite">{state.messages.map((message, index) =>
      <p key={index}><strong>{message.role === 'user' ? '你' : 'Mochi'}：</strong>{message.content}</p>)}</div>
    <ul aria-label="Mochi 的建议">{state.suggestions.map(item => <li key={item.id}>
      <strong>{item.text}</strong><p>{item.reason}</p>
      <small>优先级：{{ low: '低', medium: '中', high: '高' }[item.priority]} · {item.requiresUserAction ? '需要你操作' : '供你参考'}</small>
      <div>{item.blockId && <button type="button" onClick={() => act(() => conversation.focusSuggestion(item.id))}>定位积木</button>}
        <button type="button" disabled={state.busy} onClick={() => act(() => conversation.continueSuggestion(item.id))}>聊聊这个</button>
        <button type="button" onClick={() => act(() => conversation.ignore(item.id))}>忽略</button></div>
    </li>)}</ul>
    <form onSubmit={event => { event.preventDefault(); const value = prompt.trim(); if (!value) return; setPrompt(''); act(() => conversation.chat(value)) }}>
      <label htmlFor="mochi-ai-prompt">想问点什么？</label>
      <textarea id="mochi-ai-prompt" value={prompt} maxLength={1200} disabled={!state.enabled}
        placeholder="这个应用下一步可以怎么完善？" onChange={event => setPrompt(event.target.value)} />
      <button disabled={!state.enabled || state.busy || !prompt.trim()}>发送</button>
      {state.busy && <button type="button" onClick={conversation.cancel}>取消</button>}
      <button type="button" disabled={state.busy} onClick={() => act(() => conversation.refreshStatus())}>检查连接</button>
    </form>
    {(state.error || actionError || connectionError) && <p role="status">{state.error?.message || actionError || connectionError}</p>}
    <small>目前支持解释和建议；应用修改仍需预览与确认，修改计划尚未接通。</small>
  </section>
}
