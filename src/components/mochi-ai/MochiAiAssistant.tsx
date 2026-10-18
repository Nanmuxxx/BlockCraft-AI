import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, CircleHelp, LoaderCircle, Send, Sparkles, X } from 'lucide-react'
import { MochiCat } from '../MochiCat'
import { claimPlanConfirmation, shouldSubmitComposerKey, type MochiAiAssistantProps, type MochiMood } from './types'
import './mochi-ai.css'

const MOOD_LABELS: Record<MochiMood, string> = {
  idle: '准备好了',
  thinking: '正在整理想法',
  curious: '有个问题想看看',
  happy: '很高兴陪你搭建',
  celebrating: '这一步值得庆祝',
  error: '刚才没有完成',
}

export function MochiAiAssistant({ context, messages, suggestions, preview, mood, planningDisabledReason, operation, onCancelRequest, onRequestPlan, onConfirm, onCancel, onIgnore }: MochiAiAssistantProps) {
  const [draft, setDraft] = useState('')
  const [requestPending, setRequestPending] = useState(false)
  const [confirmPending, setConfirmPending] = useState(false)
  const [requestError, setRequestError] = useState('')
  const lifetime = useRef(0)
  useEffect(() => { lifetime.current++; return () => { lifetime.current++ } }, [])
  useEffect(() => {
    if (operation) { requestLockRef.current = operation.busy; setRequestError('') }
  }, [operation])
  const isComposingRef = useRef(false)
  const requestLockRef = useRef(false)
  const requestSequenceRef = useRef(0)
  const operationRef = useRef(operation)
  operationRef.current = operation
  const confirmedPlanIdsRef = useRef(new Set<string>())
  const historyRef = useRef<HTMLElement>(null)
  const followHistoryRef = useRef(true)
  const currentMood = mood ?? (requestPending ? 'thinking' : context.blocks.length ? 'curious' : 'idle')
  const isBusy = operation ? operation.busy : requestPending || confirmPending || currentMood === 'thinking'

  useLayoutEffect(() => {
    const history = historyRef.current
    if (history && followHistoryRef.current) history.scrollTop = history.scrollHeight
  }, [messages, isBusy])

  useEffect(() => {
    if (!preview) confirmedPlanIdsRef.current.clear()
    else {
      for (const planId of confirmedPlanIdsRef.current) {
        if (planId !== preview.planId) confirmedPlanIdsRef.current.delete(planId)
      }
    }
  }, [preview?.planId])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const prompt = draft.trim()
    if (!prompt || isBusy || planningDisabledReason || requestLockRef.current) return

    requestLockRef.current = true
    const requestSequence = ++requestSequenceRef.current
    const ownedLifetime = lifetime.current
    setRequestError('')
    if (operation) {
      // Host publishes normal request outcomes. A callback rejected before any
      // view change still needs feedback/unlock, but only its own invocation may
      // do so. Cancelled/obsolete promises cannot release a newer request's lock.
      try { await onRequestPlan(prompt, context) } catch {
        if (ownedLifetime === lifetime.current && requestSequence === requestSequenceRef.current && operationRef.current === operation) {
          setRequestError('这次请求未完成，请检查输入和当前计划状态。')
        }
      } finally {
        if (ownedLifetime === lifetime.current && requestSequence === requestSequenceRef.current && !operationRef.current?.busy) requestLockRef.current = false
      }
      return
    }
    setRequestPending(true)
    setRequestError('')
    try {
      await onRequestPlan(prompt, context)
      if (ownedLifetime === lifetime.current) setDraft('')
    } catch {
      if (ownedLifetime === lifetime.current) setRequestError('这次没有完成，请稍后重试。')
    } finally {
      if (ownedLifetime === lifetime.current) { requestLockRef.current = false; setRequestPending(false) }
    }
  }

  const runHostAction = (action: () => void) => {
    setRequestError('')
    try { action() } catch { setRequestError('操作未完成，请检查当前计划状态。') }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSubmitComposerKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing || isComposingRef.current })) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const confirmPlan = async () => {
    if (!preview || isBusy || !claimPlanConfirmation(confirmedPlanIdsRef.current, preview.planId)) return
    if (operation) {
      try { void Promise.resolve(onConfirm(preview.planId)).catch(() => {}) } catch { /* Host reports the outcome; never suggest retrying an uncertain commit. */ }
      return
    }
    const ownedLifetime = lifetime.current
    setConfirmPending(true)
    setRequestError('')
    try {
      await onConfirm(preview.planId)
    } catch {
      if (ownedLifetime === lifetime.current) {
        confirmedPlanIdsRef.current.delete(preview.planId)
        setRequestError('这次修改没有完成，请检查后重试。')
      }
    } finally {
      if (ownedLifetime === lifetime.current) setConfirmPending(false)
    }
  }

  return (
    <aside className="mochi-ai" aria-labelledby="mochi-ai-title" data-mood={currentMood} data-phase={operation?.phase}>
      <header className="mochi-ai__header">
        <span className="mochi-ai__avatar"><MochiCat className="mochi-ai__avatar-image" /></span>
        <div className="mochi-ai__heading">
          <h2 id="mochi-ai-title">Mochi</h2>
          <p role="status" aria-live="polite">{MOOD_LABELS[currentMood]}</p>
        </div>
        <span className="mochi-ai__mood-mark" aria-hidden="true"><Sparkles size={16} /></span>
      </header>

      <section className="mochi-ai__context" aria-label="当前积木上下文">
        <div className="mochi-ai__section-title"><CircleHelp size={14} aria-hidden="true" />当前积木</div>
        {context.summary && <p className="mochi-ai__context-summary">{context.summary}</p>}
        {context.blocks.length ? (
          <ul className="mochi-ai__blocks">
            {context.blocks.map((block) => (
              <li key={block.id}>
                <strong>{block.name}</strong><span>{block.kind}</span>
                {block.details && <small>{block.details}</small>}
              </li>
            ))}
          </ul>
        ) : <p className="mochi-ai__muted">暂未选中积木</p>}
      </section>

      {suggestions.length > 0 && (
        <section className="mochi-ai__suggestions" aria-label="主动建议">
          <div className="mochi-ai__section-title"><Sparkles size={14} aria-hidden="true" />可以接着试试</div>
          {suggestions.map((suggestion) => (
            <div className="mochi-ai__suggestion" key={suggestion.id}>
              <button type="button" className="mochi-ai__suggestion-prompt" disabled={isBusy || Boolean(planningDisabledReason)} onClick={() => { setDraft(suggestion.prompt) }}>
                <strong>{suggestion.label}</strong>
                {suggestion.source && <small>{suggestion.source === 'local_rule' ? '本地规则建议' : 'AI 建议'}</small>}
              </button>
              <button type="button" className="mochi-ai__icon-button" aria-label={`忽略建议：${suggestion.label}`} title="忽略建议" onClick={() => runHostAction(() => onIgnore(suggestion.id))}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="mochi-ai__history" aria-label="对话记录" aria-live="polite" ref={historyRef} onScroll={() => {
        const history = historyRef.current
        if (history) followHistoryRef.current = history.scrollHeight - history.clientHeight - history.scrollTop < 24
      }}>
        {messages.length === 0 ? <p className="mochi-ai__empty">{planningDisabledReason ? 'AI 修改尚未启用，暂不接收修改指令。' : '说说你想怎样调整这些积木。'}</p> : messages.map((message) => (
          <article className={`mochi-ai__message mochi-ai__message--${message.role}`} key={message.id}>
            <span>{message.role === 'user' ? '你' : message.role === 'system' ? '提示' : 'Mochi'}</span>
            <p>{message.content}</p>
          </article>
        ))}
        {isBusy && <p className="mochi-ai__thinking"><LoaderCircle size={14} className="mochi-ai__spinner" aria-hidden="true" />Mochi 正在思考</p>}
      </section>

      {operation && <section className="mochi-ai__context" aria-label="计划状态">
        <p role="status">{({ IDLE: '等待指令', REQUESTING: '正在请求计划', PREVIEW: '等待确认', CONFIRMING: '正在提交', APPLIED: '本次修改已应用', CANCELLED: '已取消，未撤销任何已提交操作', STALE: '上下文已变化，请重新预览', REQUEST_FAILED: '请求失败', PREVIEW_REJECTED: '预览被拒绝', COMMIT_FAILED: '提交失败，本次未写入', COMMIT_OUTCOME_UNKNOWN: '提交结果未确认，请核对应用，勿重试旧计划' } as Record<string, string>)[operation.phase]}</p>
        {operation.phase === 'REQUESTING' && operation.requestId && onCancelRequest && <button type="button" className="mochi-ai__button" onClick={() => onCancelRequest(operation.requestId!)}>取消请求</button>}
        {operation.phase === 'APPLIED' && operation.receipt?.ok && <p>本次提交回执版本：{operation.receipt.committedRevision}</p>}
        {operation.lastApplied && <p className="mochi-ai__muted">历史成功回执版本：{operation.lastApplied.receipt.committedRevision}（不代表当前版本）</p>}
      </section>}

      {preview && (
        <section className="mochi-ai__preview" aria-label="修改计划预览">
          <div className="mochi-ai__preview-heading"><div><span>修改预览</span><h3>{preview.title}</h3></div></div>
          {preview.summary && <p className="mochi-ai__preview-summary">{preview.summary}</p>}
          <ol className="mochi-ai__changes">
            {preview.changes.map((change, index) => (
              <li key={`${change.operation}-${change.target}-${index}`}>
                <div><span>{change.operation} · {change.target}</span><p>{change.description}</p></div>
                {(change.before !== undefined || change.after !== undefined) && (
                  <div className="mochi-ai__diff"><span>{change.before ?? '无'}</span><span aria-hidden="true">→</span><strong>{change.after ?? '无'}</strong></div>
                )}
              </li>
            ))}
          </ol>
          <div className="mochi-ai__plan-actions">
            <button type="button" className="mochi-ai__button mochi-ai__button--primary" disabled={isBusy} onClick={() => { void confirmPlan() }}>{confirmPending ? <LoaderCircle size={15} className="mochi-ai__spinner" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{confirmPending ? '处理中' : '确认'}</button>
            <button type="button" className="mochi-ai__button" disabled={isBusy} onClick={() => runHostAction(() => onCancel(preview.planId))}><X size={15} aria-hidden="true" />取消</button>
          </div>
        </section>
      )}

      {(operation?.error || requestError) && <p className="mochi-ai__error" role="alert">{operation?.error ? `${operation.error.code}：${operation.error.message}` : requestError}</p>}
      {planningDisabledReason && <p className="mochi-ai__context-summary" role="status">{planningDisabledReason}</p>}
      <form className="mochi-ai__composer" onSubmit={submit}>
        <label className="mochi-ai__sr-only" htmlFor="mochi-ai-input">给 Mochi 发消息</label>
        <textarea
          id="mochi-ai-input"
          value={draft}
          rows={2}
          placeholder={planningDisabledReason ? 'AI 修改尚未启用' : '描述你想做的调整…'}
          disabled={isBusy || Boolean(planningDisabledReason)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
        />
        <div className="mochi-ai__composer-footer">
          <span>{planningDisabledReason ? '等待计划服务接入' : 'Enter 发送 · Shift+Enter 换行'}</span>
          <button type="submit" className="mochi-ai__send" aria-label="发送" title="发送" disabled={!draft.trim() || isBusy || Boolean(planningDisabledReason)}>
            {isBusy ? <LoaderCircle size={16} className="mochi-ai__spinner" /> : <Send size={16} />}
          </button>
        </div>
      </form>
    </aside>
  )
}
