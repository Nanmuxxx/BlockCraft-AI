import { ArrowRight, CalendarDays, ChevronLeft, ListChecks, Sparkles } from 'lucide-react'
import type { ClarificationChoice } from '../model/appConfig'
import { MochiCat } from './MochiCat'
import './clarification-step.css'

export interface ClarificationStepProps {
  idea: string
  onComplete: (preference: ClarificationChoice) => void
  onBack: () => void
}

const choices: {
  id: ClarificationChoice
  title: string
  description: string
  icon: typeof ListChecks
}[] = [
  {
    id: 'tasks',
    title: '任务管理优先',
    description: '先把待办、进度和优先级安排清楚',
    icon: ListChecks,
  },
  {
    id: 'courses',
    title: '课程安排优先',
    description: '先整理课程表、上课时间和地点',
    icon: CalendarDays,
  },
  {
    id: 'both',
    title: '两个都需要',
    description: '任务清单和课程安排一起规划',
    icon: Sparkles,
  },
]

export function ClarificationStep({ idea, onComplete, onBack }: ClarificationStepProps) {
  return (
    <section className="clarification-step" aria-labelledby="clarification-step-title">
      <div className="clarification-step__layout">
        <div className="clarification-step__main">
          <p className="clarification-step__eyebrow">
            <span className="clarification-step__pixel-mark" aria-hidden="true" />
            需求澄清 · 01
          </p>
          <h1 className="clarification-step__title" id="clarification-step-title">
            先确定最重要的功能
          </h1>

          <div className="clarification-step__idea">
            <span className="clarification-step__idea-label">你的创意</span>
            <p>{idea}</p>
          </div>

          <div className="clarification-step__choices" role="group" aria-label="选择优先关注的功能">
            {choices.map(({ id, title, description, icon: Icon }) => (
              <button
                className="clarification-step__choice"
                key={id}
                type="button"
                onClick={() => onComplete(id)}
              >
                <span className="clarification-step__choice-icon" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.8} />
                </span>
                <span className="clarification-step__choice-copy">
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                <ArrowRight className="clarification-step__choice-arrow" size={18} aria-hidden="true" />
              </button>
            ))}
          </div>

          <button className="clarification-step__back" type="button" onClick={onBack}>
            <ChevronLeft size={17} aria-hidden="true" />
            返回修改创意
          </button>
        </div>

        <aside className="clarification-step__mochi" aria-label="Mochi 的提问">
          <div className="clarification-step__speech">
            <span className="clarification-step__mochi-name">Mochi</span>
            <p>你更关注任务管理，还是课程安排？</p>
          </div>
          <div className="clarification-step__cat-stage">
            <span className="clarification-step__float-brick clarification-step__float-brick--one" aria-hidden="true" />
            <span className="clarification-step__float-brick clarification-step__float-brick--two" aria-hidden="true" />
            <MochiCat className="clarification-step__cat" />
            <span className="clarification-step__cat-plate" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
          <p className="clarification-step__aside-note">选一个方向，我们就开始搭积木。</p>
        </aside>
      </div>
    </section>
  )
}
