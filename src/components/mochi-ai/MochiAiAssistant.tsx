import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
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

export function MochiAiAssistant({ context, messages, suggestions, preview, mood, onRequestPlan, onConfirm, onCancel, onIgnore }: MochiAiAssistantProps) {
  const [draft, setDraft] = useState('')
  const [requestPending, setRequestPending] = useState(false)
  const [confirmPending, setConfirmPending] = useState(false)
  const [requestError, setRequestError] = useState('')
  const isComposingRef = useRef(false)
  const requestLockRef = useRef(false)
  const confirmedPlanIdsRef = useRef(new Set<string>())
  const currentMood = mood ?? (requestPending ? 'thinking' : context.blocks.length ? 'curious' : 'idle')
  const isBusy = requestPending || confirmPending || currentMood === 'thinking'

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
    if (!prompt || isBusy || requestLockRef.current) return

    requestLockRef.current = true
    setRequestPending(true)
    setRequestError('')
    setDraft('')
    try {
      await onRequestPlan(prompt, context)
    } catch {
      setRequestError('这次没有完成，请稍后重试。')
    } finally {
      requestLockRef.current = false
      setRequestPending(false)
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSubmitComposerKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing || isComposingRef.current })) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const confirmPlan = async () => {
    if (!preview || isBusy || !claimPlanConfirmation(confirmedPlanIdsRef.current, preview.planId)) return
    setConfirmPending(true)
    setRequestError('')
    try {
      await onConfirm(preview.planId)
    } catch {
      confirmedPlanIdsRef.current.delete(preview.planId)
      setRequestError('这次修改没有完成，请检查后重试。')
    } finally {
      setConfirmPending(false)
    }
  }

  return (
    <aside className="mochi-ai" aria-labelledby="mochi-ai-title" data-mood={currentMood}>
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
              <button type="button" className="mochi-ai__suggestion-prompt" disabled={isBusy} onClick={() => { setDraft(suggestion.prompt) }}>
                <strong>{suggestion.label}</strong>
                {suggestion.source && <small>{suggestion.source === 'local_rule' ? '本地规则建议' : 'AI 建议'}</small>}
              </button>
              <button type="button" className="mochi-ai__icon-button" aria-label={`忽略建议：${suggestion.label}`} title="忽略建议" onClick={() => onIgnore(suggestion.id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="mochi-ai__history" aria-label="对话记录" aria-live="polite">
        {messages.length === 0 ? <p className="mochi-ai__empty">说说你想怎样调整这些积木。</p> : messages.map((message) => (
          <article className={`mochi-ai__message mochi-ai__message--${message.role}`} key={message.id}>
            <span>{message.role === 'user' ? '你' : message.role === 'system' ? '提示' : 'Mochi'}</span>
            <p>{message.content}</p>
          </article>
        ))}
        {isBusy && <p className="mochi-ai__thinking"><LoaderCircle size={14} className="mochi-ai__spinner" aria-hidden="true" />Mochi 正在思考</p>}
      </section>

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
            <button type="button" className="mochi-ai__button" disabled={isBusy} onClick={() => onCancel(preview.planId)}><X size={15} aria-hidden="true" />取消</button>
          </div>
        </section>
      )}

      {requestError && <p className="mochi-ai__error" role="alert">{requestError}</p>}
      <form className="mochi-ai__composer" onSubmit={submit}>
        <label className="mochi-ai__sr-only" htmlFor="mochi-ai-input">给 Mochi 发消息</label>
        <textarea
          id="mochi-ai-input"
          value={draft}
          rows={2}
          placeholder="描述你想做的调整…"
          disabled={isBusy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
        />
        <div className="mochi-ai__composer-footer">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <button type="submit" className="mochi-ai__send" aria-label="发送" title="发送" disabled={!draft.trim() || isBusy}>
            {isBusy ? <LoaderCircle size={16} className="mochi-ai__spinner" /> : <Send size={16} />}
          </button>
        </div>
      </form>
    </aside>
  )
}
