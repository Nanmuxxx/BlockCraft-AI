import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowRight, CircleAlert, LoaderCircle, Sparkles } from 'lucide-react'
import { MochiCat } from './MochiCat'
import { IDEA_EXAMPLES, MAX_IDEA_LENGTH } from './ideas'

interface HomeProps {
  initialIdea: string
  onStart: (idea: string) => void
}

export function Home({ initialIdea, onStart }: HomeProps) {
  const [value, setValue] = useState(initialIdea)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const pickExample = (id: string, prompt: string) => {
    setValue(prompt)
    setActiveId(id)
    setError('')
    inputRef.current?.focus()
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (loading) return
    const idea = value.trim()
    if (!idea) {
      setError('先告诉 Mochi 一个想法吧，哪怕只有一句话。')
      inputRef.current?.focus()
      return
    }
    setError('')
    setLoading(true)
    // 模拟 Mochi “正在整理积木”的短暂反馈
    window.setTimeout(() => onStart(idea), 900)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="home">
      <section className="hero">
        <p className="eyebrow">
          <Sparkles size={14} aria-hidden="true" />
          像搭乐高一样创造软件
        </p>
        <h1 className="hero__title">
          把想法，
          <br />
          <span className="hero__accent">搭成现实。</span>
        </h1>
        <p className="hero__sub">和 Mochi 一起，把每个奇思妙想搭成属于自己的软件。</p>

        <form className={`composer${error ? ' composer--error' : ''}`} onSubmit={submit} noValidate>
          <label htmlFor="idea" className="sr-only">
            描述你想创造的软件
          </label>
          <textarea
            id="idea"
            ref={inputRef}
            className="composer__input"
            placeholder="告诉 Mochi，你今天想创造什么……"
            value={value}
            maxLength={MAX_IDEA_LENGTH}
            rows={3}
            disabled={loading}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'idea-error' : undefined}
            onChange={(e) => {
              setValue(e.target.value)
              if (error) setError('')
              if (activeId) setActiveId(null)
            }}
            onKeyDown={onKeyDown}
          />
          <div className="composer__bar">
            <span className="composer__count" aria-live="off">
              {value.length}/{MAX_IDEA_LENGTH}
            </span>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <LoaderCircle size={18} className="spin" aria-hidden="true" />
                  Mochi 正在摆积木…
                </>
              ) : (
                <>
                  开始创造
                  <ArrowRight size={18} aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </form>

        <p id="idea-error" className={`hint${error ? ' hint--error' : ''}`} role="alert" aria-live="polite">
          {error && (
            <>
              <CircleAlert size={15} aria-hidden="true" />
              {error}
            </>
          )}
        </p>

        <div className="examples">
          <p className="examples__label">或者，从一块积木开始：</p>
          <ul className="examples__list">
            {IDEA_EXAMPLES.map((ex) => {
              const Icon = ex.icon
              const active = activeId === ex.id
              return (
                <li key={ex.id}>
                  <button
                    type="button"
                    className={`brick brick--${ex.tone}${active ? ' brick--active' : ''}`}
                    aria-pressed={active}
                    disabled={loading}
                    onClick={() => pickExample(ex.id, ex.prompt)}
                  >
                    <span className="brick__studs" aria-hidden="true">
                      <i />
                      <i />
                    </span>
                    <span className="brick__icon">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="brick__text">
                      <strong>{ex.label}</strong>
                      <small>{ex.hint}</small>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <aside className="stage" aria-label="Mochi 展示区">
        <div className="speech" role="note">
          <span className="speech__name">Mochi</span>
          嗨！我是 Mochi，你负责天马行空，我负责把想法一块块搭起来。
        </div>
        <div className="stage__scene">
          <span className="float-brick float-brick--a" aria-hidden="true" />
          <span className="float-brick float-brick--b" aria-hidden="true" />
          <span className="float-brick float-brick--c" aria-hidden="true" />
          <MochiCat className="mochi" />
          <div className="stage__shadow" aria-hidden="true" />
          <div className="stage__plate" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </aside>
    </div>
  )
}
