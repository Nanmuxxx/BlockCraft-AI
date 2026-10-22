import { useEffect, useState, useSyncExternalStore } from 'react'
import { createWorkshopMochiConversation, type ConversationHost } from './workshop.mjs'
import type { CustomContextSource } from './context.mjs'
import type { createMochiConversation, Advice } from './client.mjs'
import './conversation.css'

type Conversation = ReturnType<typeof createMochiConversation>
const actionMessages: Record<string, string> = {
  SUGGESTION_EXPIRED: '这条建议已过期，请等待新的建议。', CONTEXT_CHANGED: '项目已变化，请重新分析后再预览。',
  READ_ONLY: '当前项目为只读，无法请求修改。', AI_MODIFICATION_DISABLED: '修改计划尚未接通，可以先聊聊这条建议。',
  SUGGESTION_NOT_EXECUTABLE: '这条建议暂时无法转为修改计划，可以先聊聊。', SUGGESTION_NOT_ACTIONABLE: '这条建议暂时无法转为修改计划，可以先聊聊。', UNSUPPORTED_SUGGESTION: '这个积木暂不支持修改计划。',
  PLAN_NOT_PENDING: '预览已失效，请重新请求。', PERMISSION_DENIED: '当前权限不允许这次修改。',
  CUSTOM_SCOPE_UNAVAILABLE: '自定义积木暂不支持修改计划。', TIMER_SCOPE_UNAVAILABLE: '番茄钟暂不支持修改计划。',
}
/** The trusted conversation bridge can request a preview; only the Host confirmation UI can commit. */
export function MochiConversationPanel({ host, customContext, planningDisabledReason }: {
  host: ConversationHost; customContext?: CustomContextSource; planningDisabledReason?: string
}) {
  const [owner, setOwner] = useState<{ host: ConversationHost; conversation: Conversation } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    try {
      const bridge = createWorkshopMochiConversation(host, { customContext, analyzeOnConsent: true })
      setOwner({ host, conversation: bridge.conversation })
      void bridge.conversation.refreshStatus().catch(() => {})
      return () => bridge.dispose()
    } catch { setError('当前结构暂不支持 AI 分析，请缩小分析范围。') }
  }, [host, customContext])
  if (!owner || owner.host !== host) return <p role="status">{error || '正在检查 Mochi AI 状态…'}</p>
  return <ConversationView key={host.getSnapshot().context.instanceId} host={host} conversation={owner.conversation} connectionError={error} planningDisabledReason={planningDisabledReason} />
}
function ConversationView({ host, conversation, connectionError, planningDisabledReason }: {
  host: ConversationHost; conversation: Conversation; connectionError: string; planningDisabledReason?: string
}) {
  const state = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot, conversation.getSnapshot)
  const view = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot)
  const canChat = state.enabled && state.contextAvailable && view.mode === 'blocks'
  const [prompt, setPrompt] = useState('')
  const [actionError, setActionError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  useEffect(() => {
    const refresh = () => { try { conversation.refreshSuggestions() } catch { /* A disposed bridge has no visible suggestions. */ } }
    const timer = window.setInterval(refresh, 15_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [conversation])
  function act(action: () => unknown, success = '') {
    setActionError(''); setFeedback('')
    void Promise.resolve().then(action).then(() => setFeedback(success)).catch((error: unknown) => {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      setActionError(actionMessages[code] || '这次没有完成，可以稍后再试。')
    })
  }
  function preview(id: string) {
    setPendingId(id)
    act(async () => { try { await conversation.requestModification(id) } finally { setPendingId(null) } }, '修改计划已请求，请在上方核对预览后确认。')
  }
  const actionsBusy = state.busy || pendingId !== null
  function suggestion(item: Readonly<Advice>, deferred = false) {
    const target = view.context.blocks.find(block => block.id === item.blockId)
    const actionable = item.kind === 'design-change' && item.requiresUserAction && !!target && ['form', 'list'].includes(target.type)
    return <li key={item.id} data-suggestion-id={item.id}>
      <strong>{item.text}</strong><p>{item.reason}</p>
      <small>优先级：{{ low: '低', medium: '中', high: '高' }[item.priority]} · {item.requiresUserAction ? '需要你操作' : '供你参考'}</small>
      <div className="mochi-conversation__actions" role="group" aria-label={`${item.text}的操作`}>
        {deferred ? <button type="button" disabled={actionsBusy || !canChat} onClick={() => act(() => conversation.resume(item.id), '建议已恢复。')}>恢复建议</button> : <>
          {actionable && <button type="button" className="mochi-conversation__accept" disabled={!canChat || actionsBusy || !state.planningEnabled || !!planningDisabledReason}
            title={planningDisabledReason || (!state.planningEnabled ? '修改计划尚未接通' : undefined)}
            onClick={() => preview(item.id)}>{pendingId === item.id ? '正在准备预览…' : '接受并预览'}</button>}
          {item.blockId && <button type="button" disabled={actionsBusy || !canChat} onClick={() => act(() => conversation.focusSuggestion(item.id))}>定位积木</button>}
          <button type="button" disabled={!canChat || actionsBusy} onClick={() => act(() => conversation.continueSuggestion(item.id))}>聊聊这个</button>
          <button type="button" disabled={actionsBusy} onClick={() => act(() => conversation.snooze(item.id), '已稍后处理，约一分钟后恢复；项目变化会使建议过期。')}>稍后处理</button>
        </>}
        <button type="button" disabled={actionsBusy} onClick={() => act(() => conversation.reject(item.id), '已拒绝这条建议。')}>拒绝</button>
        <button type="button" disabled={actionsBusy} onClick={() => act(() => conversation.ignore(item.id), '已忽略这条建议。')}>忽略</button>
      </div>
    </li>
  }
  return <section className="mochi-conversation" aria-label="和 Mochi 聊聊" aria-busy={actionsBusy}>
    <header><strong>和 Mochi 聊聊</strong><span>{state.busy ? '想一想…' : state.enabled ? '一起完善你的应用' : 'AI 尚未启用'}</span></header>
    <p className="mochi-conversation__privacy">只分析项目结构和你输入的内容。请勿输入业务记录或密钥。</p>
    {state.disabledReason && <p role="status">{state.disabledReason}</p>}
    {planningDisabledReason && <p className="mochi-conversation__planning-status" role="status">{planningDisabledReason}</p>}
    <label><input type="checkbox" checked={state.proactiveEnabled} disabled={!canChat && !state.proactiveEnabled}
      onChange={event => { const enabled = event.target.checked; act(() => conversation.setProactive(enabled)) }} />主动建议</label>
    <div role="log" aria-label="聊天记录" aria-live="polite">{state.messages.map((message, index) =>
      <p key={index}><strong>{message.role === 'user' ? '你' : 'Mochi'}：</strong>{message.content}</p>)}</div>
    <ul aria-label="Mochi 的建议">{state.suggestions.map(item => suggestion(item))}</ul>
    {!state.suggestions.length && state.enabled && <p className="mochi-conversation__empty">{state.proactiveEnabled ? '暂时没有新建议。项目结构变化后，Mochi 会适时提出想法。' : '开启主动建议后，Mochi 会根据项目结构提出想法。'}</p>}
    {!!state.deferredSuggestions.length && <details className="mochi-conversation__deferred" open>
      <summary>稍后处理（{state.deferredSuggestions.length}）</summary>
      <ul aria-label="稍后处理的建议">{state.deferredSuggestions.map(item => suggestion(item, true))}</ul>
    </details>}
    <form onSubmit={event => { event.preventDefault(); const value = prompt.trim(); if (!value) return; setPrompt(''); act(() => conversation.chat(value)) }}>
      <label htmlFor="mochi-ai-prompt">向 Mochi 提问</label>
      <textarea id="mochi-ai-prompt" value={prompt} maxLength={1200} disabled={!canChat}
        placeholder="这个应用下一步可以怎么完善？" onChange={event => setPrompt(event.target.value)} />
      <button disabled={!canChat || actionsBusy || !prompt.trim()}>发送</button>
      {state.busy && <button type="button" onClick={conversation.cancel}>取消</button>}
      <button type="button" disabled={actionsBusy} onClick={() => act(() => conversation.refreshStatus())}>检查连接</button>
    </form>
    {(state.error || actionError || connectionError) && <p role="alert">{actionError || state.error?.message || connectionError}</p>}
    {feedback && <p className="mochi-conversation__feedback" role="status">{feedback}</p>}
    <small>接受建议只会请求修改预览。核对上方真实变更并点击确认后，才会修改项目。</small>
  </section>
}
