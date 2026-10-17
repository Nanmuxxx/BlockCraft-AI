import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { CalendarDays, ChartNoAxesColumnIncreasing, Info, ListChecks, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { MochiCat } from './MochiCat'
import './mochi-panel.css'

export type MochiMessageRole = 'user' | 'mochi' | 'assistant' | 'system'

export interface MochiMessage {
  id?: string
  role: MochiMessageRole
  content: string
}

export type MochiSuggestionId = 'enable-task-priority'

export interface MochiPanelProps {
  selectedModuleId: string | null
  messages: MochiMessage[]
  onSendMessage: (message: string) => void
  onConfirmSuggestion: (suggestionId: MochiSuggestionId) => void
}

const MAX_MESSAGE_LENGTH = 240

const MODULE_GUIDANCE: Record<string, {
  label: string
  description: string
  prompt: string
  icon: typeof ListChecks
  quickPrompts: string[]
}> = {
  tasks: {
    label: '任务管理',
    description: '把目标拆成可以一步步完成的小任务。',
    prompt: '我可以解释任务积木，也可以帮你梳理今天的任务。',
    icon: ListChecks,
    quickPrompts: ['解释任务积木', '我想先安排今天的任务'],
  },
  courses: {
    label: '课程安排',
    description: '为课程留出时间，让学习节奏更清晰。',
    prompt: '我可以解释课程积木，看看课程安排适合放在哪里。',
    icon: CalendarDays,
    quickPrompts: ['解释课程积木', '怎么安排课程时间？'],
  },
  stats: {
    label: '学习统计',
    description: '记录完成情况，慢慢看见自己的积累。',
    prompt: '我可以解释统计积木，以及它会展示哪些学习记录。',
    icon: ChartNoAxesColumnIncreasing,
    quickPrompts: ['解释学习统计', '我想看看任务完成情况'],
  },
}

const SUPPORTED_INPUT = /(任务|课程|统计|积木|优先级|学习|添加|功能|帮我|解释|建议)/

function getGuidance(selectedModuleId: string | null) {
  if (!selectedModuleId) {
    return {
      label: '还没有选中积木',
      description: '先在画布上选一块积木，我会跟着你的创作节奏给提示。',
      prompt: '选中积木后，我会解释它的作用，并在需要时提出一个小建议。',
      icon: Sparkles,
      quickPrompts: [],
    }
  }

  return MODULE_GUIDANCE[selectedModuleId] ?? {
    label: `未接入的积木 · ${selectedModuleId}`,
    description: '这个积木还没有接入 Mochi 的 Mock 引导。',
    prompt: '你可以继续浏览已接入的任务、课程和统计积木。',
    icon: Info,
    quickPrompts: [],
  }
}

export function MochiPanel({ selectedModuleId, messages, onSendMessage, onConfirmSuggestion }: MochiPanelProps) {
  const [draft, setDraft] = useState('')
  const [inputNotice, setInputNotice] = useState('')
  const [suggestionVisible, setSuggestionVisible] = useState(false)
  const [suggestionState, setSuggestionState] = useState<'visible' | 'dismissed' | 'confirmed' | null>(null)
  const [confirmationNotice, setConfirmationNotice] = useState('')
  const [usedQuickPrompts, setUsedQuickPrompts] = useState<Set<string>>(new Set())
  const suggestedIdsRef = useRef<Set<MochiSuggestionId>>(new Set())
  const suggestionSubmittingRef = useRef(false)
  const isComposingRef = useRef(false)
  const historyRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const guidance = getGuidance(selectedModuleId)
  const GuidanceIcon = guidance.icon

  useEffect(() => {
    const history = historyRef.current
    if (!history || !shouldStickToBottomRef.current) return
    history.scrollTo({ top: history.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    if (selectedModuleId !== 'tasks') {
      setSuggestionVisible(false)
      setSuggestionState(null)
      return
    }

    if (suggestedIdsRef.current.has('enable-task-priority')) {
      setSuggestionVisible(false)
      return
    }

    suggestedIdsRef.current.add('enable-task-priority')
    setSuggestionVisible(true)
    setSuggestionState('visible')
  }, [selectedModuleId])

  const dispatchMessage = (message: string) => {
    onSendMessage(message)
    setInputNotice(
      SUPPORTED_INPUT.test(message)
        ? '消息已交给主程序保存。当前是 Mock 交互，不会调用真实 AI。'
        : '这条消息已交给主程序，但当前 Mock 只支持围绕功能积木的引导，不会假装调用真实 AI。',
    )
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = draft.trim()

    if (!message) {
      setInputNotice('先写下一句话，Mochi 才能把它交给主程序。')
      return
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      setInputNotice(`消息太长了，请控制在 ${MAX_MESSAGE_LENGTH} 字以内。`)
      return
    }

    dispatchMessage(message)
    setDraft('')
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || isComposingRef.current) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const handleQuickPrompt = (prompt: string) => {
    if (usedQuickPrompts.has(prompt)) return
    setUsedQuickPrompts((current) => new Set(current).add(prompt))
    dispatchMessage(prompt)
  }

  const confirmTaskPriority = () => {
    if (suggestionState !== 'visible' || suggestionSubmittingRef.current) return
    suggestionSubmittingRef.current = true
    onConfirmSuggestion('enable-task-priority')
    setSuggestionVisible(false)
    setSuggestionState('confirmed')
    setConfirmationNotice('已向主程序上报“启用任务优先级”的修改请求；Mock 不会直接修改配置。')
  }

  const dismissTaskPriority = () => {
    if (suggestionSubmittingRef.current) return
    setSuggestionVisible(false)
    setSuggestionState('dismissed')
    setConfirmationNotice('好的，我先不打扰你。之后仍可以从任务积木继续开始。')
  }

  const handleHistoryScroll = () => {
    const history = historyRef.current
    if (!history) return
    shouldStickToBottomRef.current = history.scrollHeight - history.scrollTop - history.clientHeight < 28
  }

  const statusLabel = suggestionVisible
    ? '有个小建议'
    : confirmationNotice
      ? '按你的节奏来'
      : messages.length > 0
        ? '陪你一起搭建'
        : '准备好了'

  return (
    <aside className="mochi-panel" aria-labelledby="mochi-panel-title">
      <header className="mochi-panel__header">
        <div className="mochi-panel__title-wrap">
          <span className="mochi-panel__avatar" aria-hidden="true"><MochiCat className="mochi-panel__avatar-image" /></span>
          <div>
            <h2 id="mochi-panel-title">Mochi 的小窝</h2>
            <p>{statusLabel}</p>
          </div>
        </div>
        <span className="mochi-panel__mode"><span className="pixel-dot" aria-hidden="true" />Mock</span>
      </header>

      <div className="mochi-panel__companion">
        <div className="mochi-panel__cat-scene" aria-hidden="true">
          <MochiCat className="mochi-panel__cat" />
          <span className="mochi-panel__cat-ground" />
        </div>
        <section className="mochi-panel__speech" aria-live="polite">
          <span className="mochi-panel__speech-name">Mochi</span>
          <p>{guidance.prompt}</p>
          <small><GuidanceIcon size={12} aria-hidden="true" />正在看：{guidance.label}</small>
        </section>
      </div>
      <p className="mochi-panel__context-note">{guidance.description}</p>

      {guidance.quickPrompts.length > 0 && (
        <section className="mochi-panel__quick" aria-label="快捷建议">
          <div className="mochi-panel__quick-heading"><Sparkles size={13} aria-hidden="true" />可以从这里开始</div>
          <div className="mochi-panel__quick-list">
            {guidance.quickPrompts.map((prompt) => (
              <button
                type="button"
                className="mochi-panel__quick-button"
                key={prompt}
                disabled={usedQuickPrompts.has(prompt)}
                onClick={() => handleQuickPrompt(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>
      )}

      <section ref={historyRef} className="mochi-panel__history" aria-label="Mochi 聊天记录" aria-live="polite" onScroll={handleHistoryScroll}>
        {messages.length === 0 ? (
          <div className="mochi-panel__empty-history">
            <span className="mochi-panel__empty-icon" aria-hidden="true"><ShieldCheck size={16} /></span>
            <p>嗨，我是 Mochi！</p>
            <small>和你一起，把想法一步步搭成软件。先选一块积木，我们从这里开始。</small>
          </div>
        ) : (
          messages.map((message, index) => {
            const isUser = message.role === 'user'
            return (
              <article className={`mochi-panel__message${isUser ? ' mochi-panel__message--user' : ''}`} key={message.id ?? `${message.role}-${index}`}>
                <span className="mochi-panel__message-name">{isUser ? '你' : message.role === 'system' ? '提示' : 'Mochi'}</span>
                <p>{message.content}</p>
              </article>
            )
          })
        )}
      </section>

      {suggestionVisible && (
        <section className="mochi-panel__suggestion" aria-label="Mochi 建议">
          <div className="mochi-panel__suggestion-copy">
            <span className="mochi-panel__suggestion-icon" aria-hidden="true"><ListChecks size={16} /></span>
            <div>
              <strong>要给任务加上优先级吗？</strong>
              <p>这样可以更快看出今天先做什么。修改前我会先征得你的同意。</p>
            </div>
          </div>
          <div className="mochi-panel__suggestion-actions">
            <button type="button" className="mochi-panel__action mochi-panel__action--confirm" onClick={confirmTaskPriority}>帮我添加</button>
            <button type="button" className="mochi-panel__action" onClick={dismissTaskPriority}>暂时不用</button>
          </div>
        </section>
      )}

      {confirmationNotice && <p className="mochi-panel__notice" role="status">{confirmationNotice}</p>}

      <form className="mochi-panel__composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="mochi-message-input">给 Mochi 发消息</label>
        <textarea
          id="mochi-message-input"
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={2}
          placeholder="和 Mochi 说说你的想法…"
          onChange={(event) => { setDraft(event.target.value); setInputNotice('') }}
          onKeyDown={handleComposerKeyDown}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
        />
        <div className="mochi-panel__composer-bar">
          <span>{draft.length}/{MAX_MESSAGE_LENGTH}</span>
          <button type="submit" aria-label="发送消息" disabled={!draft.trim()}><Send size={15} aria-hidden="true" /><span>发送</span></button>
        </div>
      </form>
      {inputNotice && <p className="mochi-panel__notice mochi-panel__notice--input" role="status">{inputNotice}</p>}
    </aside>
  )
}
