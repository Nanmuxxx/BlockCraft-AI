import { useEffect, useState, useSyncExternalStore } from 'react'
import { createWorkshopMochiConversation, type ConversationHost } from './workshop.mjs'
import type { CustomContextSource } from './context.mjs'
import type { createMochiConversation } from './client.mjs'
import './conversation.css'

type Conversation = ReturnType<typeof createMochiConversation>
/** Advice only, sharing the Workshop host; never receives Runtime or plan callbacks. */
export function MochiConversationPanel({ host, customContext }: { host: ConversationHost; customContext?: CustomContextSource }) {
  const [owner, setOwner] = useState<{ host: ConversationHost; conversation: Conversation } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    try {
      const bridge = createWorkshopMochiConversation(host, { customContext })
      setOwner({ host, conversation: bridge.conversation })
      // Status owns a persistent, recoverable disabled reason.
      void bridge.conversation.refreshStatus().catch(() => {})
      return () => bridge.dispose()
    } catch { setError('当前结构暂不支持 AI 分析，请缩小分析范围。') }
  }, [host, customContext])
  if (!owner || owner.host !== host) return <p role="status">{error || '正在检查 Mochi AI 状态…'}</p>
  return <ConversationView host={host} conversation={owner.conversation} connectionError={error} />
}
function ConversationView({ host, conversation, connectionError }: { host: ConversationHost; conversation: Conversation; connectionError: string }) {
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot, conversation.getSnapshot)
  const view = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot)
  const canChat = state.enabled && state.contextAvailable && view.mode === 'blocks'
  const [prompt, setPrompt] = useState('')
  const [actionError, setActionError] = useState('')
  function act(action: () => unknown) {
    setActionError('')
    void Promise.resolve().then(action).catch(() => setActionError('这次没有完成，可以稍后再试。'))
  }
  return <section className="mochi-conversation" aria-label="和 Mochi 聊聊">
    <header><strong>和 Mochi 聊聊</strong><span>{state.busy ? '想一想…' : state.enabled ? '一起完善你的应用' : 'AI 尚未启用'}</span></header>
    <p className="mochi-conversation__privacy">只分析项目结构和你输入的内容。请勿输入业务记录或密钥。</p>
    {state.disabledReason && <p role="status">{state.disabledReason}</p>}
    <label><input type="checkbox" checked={state.proactiveEnabled} disabled={!canChat && !state.proactiveEnabled}
      onChange={event => { const enabled = event.target.checked; act(() => conversation.setProactive(enabled)) }} />主动建议</label>
    <div role="log" aria-label="聊天记录" aria-live="polite">{state.messages.map((message, index) =>
      <p key={index}><strong>{message.role === 'user' ? '你' : 'Mochi'}：</strong>{message.content}</p>)}</div>
    <ul aria-label="Mochi 的建议">{state.suggestions.map(item => <li key={item.id}>
      <strong>{item.text}</strong><p>{item.reason}</p>
      <small>优先级：{{ low: '低', medium: '中', high: '高' }[item.priority]} · {item.requiresUserAction ? '需要你操作' : '供你参考'}</small>
      <div>{item.blockId && <button type="button" onClick={() => act(() => conversation.focusSuggestion(item.id))}>定位积木</button>}
        <button type="button" disabled={!canChat || state.busy} onClick={() => act(() => conversation.continueSuggestion(item.id))}>聊聊这个</button>
        <button type="button" onClick={() => act(() => conversation.ignore(item.id))}>忽略</button></div>
    </li>)}</ul>
    <form onSubmit={event => { event.preventDefault(); const value = prompt.trim(); if (!value) return; setPrompt(''); act(() => conversation.chat(value)) }}>
      <label htmlFor="mochi-ai-prompt">向 Mochi 提问</label>
      <textarea id="mochi-ai-prompt" value={prompt} maxLength={1200} disabled={!canChat}
        placeholder="这个应用下一步可以怎么完善？" onChange={event => setPrompt(event.target.value)} />
      <button disabled={!canChat || state.busy || !prompt.trim()}>发送</button>
      {state.busy && <button type="button" onClick={conversation.cancel}>取消</button>}
      <button type="button" disabled={state.busy} onClick={() => act(() => conversation.refreshStatus())}>检查连接</button>
    </form>
    {(state.error || actionError || connectionError) && <p role="status">{state.error?.message || actionError || connectionError}</p>}
    <small>这里只提供解释、建议和定位，不会修改应用。应用修改计划尚未接通。</small>
  </section>
}
