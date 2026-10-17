import { useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Blocks, BookOpen, CalendarDays, ChartNoAxesColumnIncreasing, Check, Clock3, GraduationCap, ListChecks, Monitor, Plus, Sparkles } from 'lucide-react'
import { Logo } from './Logo'
import { MochiPanel, type MochiMessage } from './MochiPanel'
import { BlockCanvas, type BlockModuleData } from './BlockCanvas'
import { VISUAL_EXAMPLES } from './blocks/examples'
import {
  withTasks,
  type AppConfig,
  type AppConfigUpdater,
  type BlockPosition,
  type Course,
  type ModuleId,
  type MochiSuggestionId,
  type StudyStats,
  type StudyTask,
} from '../model/appConfig'
import './workshop.css'

interface WorkshopProps {
  config: AppConfig
  onConfigChange: (updater: AppConfigUpdater) => void
  onBack: () => void
}

type Mode = 'blocks' | 'preview'
const FEATURES: BlockModuleData[] = [
  { id: 'tasks', name: '任务管理', description: '把学习目标拆成小任务，让每一步都有方向。', detail: '待办任务 · 完成进度', icon: ListChecks, tone: 'sage' },
  { id: 'courses', name: '课程安排', description: '为课程留好时间，让每天的学习井井有条。', detail: '课程日历 · 时间安排', icon: CalendarDays, tone: 'blue' },
  { id: 'stats', name: '学习统计', description: '记录一点一滴的积累，看见自己的成长。', detail: '学习记录 · 成长趋势', icon: ChartNoAxesColumnIncreasing, tone: 'apricot' },
]

export function Workshop({ config, onConfigChange, onBack }: WorkshopProps) {
  const [mode, setMode] = useState<Mode>('blocks')
  const [taskDraft, setTaskDraft] = useState('')
  const [selectedModuleId, setSelectedModuleId] = useState<ModuleId | null>(null)
  const [messages, setMessages] = useState<MochiMessage[]>([])
  // 阶段 2 只在当前会话记录请求，不执行配置变更。
  const suggestionRequests = useRef<MochiSuggestionId[]>([])
  const { data, blockPositions } = config
  const { tasks, courses, stats: taskStats } = data

  const sendMessage = (message: string) => {
    const content = message.trim()
    if (!content) return
    const selectedFeature = FEATURES.find(({ id }) => id === selectedModuleId)
    setMessages((current) => [...current,
      { role: 'user', content },
      {
        role: 'mochi',
        content: selectedFeature
          ? `本地 Mock · ${selectedFeature.name}：${selectedFeature.description} 你可以切到应用预览查看效果。`
          : '本地 Mock：先选中任务、课程或统计积木，我会介绍它的作用。',
      },
    ])
  }

  const confirmSuggestion = (suggestionId: MochiSuggestionId) => {
    if (suggestionRequests.current.includes(suggestionId)) return
    suggestionRequests.current.push(suggestionId)
    setMessages((current) => [...current, {
      id: `request-${suggestionId}`,
      role: 'system',
      content: '已记录“启用任务优先级”的建议请求，尚未修改任务或应用配置。',
    }])
  }
  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = taskDraft.trim()
    if (!title) return
    onConfigChange((current) => {
      const tasks = [...current.data.tasks, { id: `task-${Date.now()}-${current.data.tasks.length}`, title, completed: false, priority: 'medium' as const }]
      return { ...current, data: withTasks(current.data, tasks) }
    })
    setTaskDraft('')
  }

  const toggleTask = (taskId: string) => {
    onConfigChange((current) => {
      const tasks = current.data.tasks.map((task) => (
        task.id === taskId ? { ...task, completed: !task.completed } : task
      ))
      return { ...current, data: withTasks(current.data, tasks) }
    })
  }

  const moveModule = (moduleId: ModuleId, position: BlockPosition) => {
    onConfigChange((current) => ({
      ...current,
      blockPositions: { ...current.blockPositions, [moduleId]: position },
    }))
  }

  return (
    <div className="workshop">
      <header className="workshop__topbar">
        <Logo />
        <div className="workshop__project">
          <span className="workshop__project-icon"><GraduationCap size={20} aria-hidden="true" /></span>
          <div><h1>我的学习助手</h1><span>Workshop · 创作工坊</span></div>
        </div>
        <div className="workshop__modes" role="group" aria-label="创作模式">
          <button type="button" aria-pressed={mode === 'blocks'} aria-controls="workshop-canvas" onClick={() => setMode('blocks')}>
            <span>B</span> 功能积木
          </button>
          <button type="button" aria-pressed={mode === 'preview'} aria-controls="workshop-canvas" onClick={() => setMode('preview')}>
            <span>C</span> 应用预览
          </button>
        </div>
      </header>

      <div className="workshop__body">
        <nav className="workshop__nav" aria-label="工坊导航">
          <button type="button" onClick={onBack}><ArrowLeft size={21} aria-hidden="true" /><span>首页</span></button>
          <div className="workshop__nav-divider" />
          <button type="button" aria-pressed={mode === 'blocks'} onClick={() => setMode('blocks')}><Blocks size={23} aria-hidden="true" /><span>积木</span></button>
          <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}><Monitor size={23} aria-hidden="true" /><span>预览</span></button>
          <span className="workshop__nav-foot" aria-hidden="true">✦</span>
        </nav>

        <main className="workshop__workspace" id="workshop-canvas" aria-labelledby="canvas-title">
          <div className="workshop__canvas-header">
            <div>
              <p className="workshop__eyebrow">{mode === 'blocks' ? 'BUILD WITH BLOCKS' : 'A GLIMPSE OF YOUR APP'}</p>
              <h2 id="canvas-title">{mode === 'blocks' ? '从一块积木开始' : '让想法有个模样'}</h2>
              <p>{mode === 'blocks' ? '每一块，都是软件的一种可能。' : '这里是「我的学习助手」的预览空间。'}</p>
            </div>
            <span className="workshop__badge">{mode === 'blocks' ? '3 块功能 · 2 块展示' : '本地 Mock 数据'}</span>
          </div>

          <div className="workshop__blocks-layer" hidden={mode !== 'blocks'}>
            <BlockCanvas
              modules={FEATURES}
              examples={VISUAL_EXAMPLES}
              positions={blockPositions}
              selectedModuleId={selectedModuleId}
              onSelectModule={setSelectedModuleId}
              onMoveModule={moveModule}
            />
          </div>

          {mode === 'preview' && (
            <StudyPreview
              tasks={tasks}
              courses={courses}
              draft={taskDraft}
              stats={taskStats}
              onDraftChange={setTaskDraft}
              onAddTask={addTask}
              onToggleTask={toggleTask}
            />
          )}
          <footer className="workshop__canvas-footer"><span className="pixel-dot" aria-hidden="true" />把想法，一块块搭成现实<span>{mode === 'blocks' ? 'B / 功能积木' : 'C / 应用预览'}</span></footer>
        </main>

        <MochiPanel
          selectedModuleId={selectedModuleId}
          messages={messages}
          onSendMessage={sendMessage}
          onConfirmSuggestion={confirmSuggestion}
        />
      </div>
    </div>
  )
}

interface StudyPreviewProps {
  tasks: StudyTask[]
  courses: Course[]
  draft: string
  stats: StudyStats
  onDraftChange: (value: string) => void
  onAddTask: (event: FormEvent<HTMLFormElement>) => void
  onToggleTask: (taskId: string) => void
}

function StudyPreview({ tasks, courses, draft, stats, onDraftChange, onAddTask, onToggleTask }: StudyPreviewProps) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')
  const draftRef = useRef<HTMLInputElement>(null)
  const remaining = stats.total - stats.completed
  const visibleTasks = tasks.filter((task) => filter === 'all' || (filter === 'completed' ? task.completed : !task.completed))
  const filters = [
    { id: 'all', label: '全部', count: stats.total },
    { id: 'pending', label: '待完成', count: remaining },
    { id: 'completed', label: '已完成', count: stats.completed },
  ] as const
  const todayLabel = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())

  return (
    <section className="workshop__preview-stage" aria-label="我的学习助手应用预览">
      <div className="study-app">
        <header className="study-app__topbar">
          <div className="study-app__brand"><span><GraduationCap size={18} aria-hidden="true" /></span><strong>学习拾光</strong><small>STUDY SPACE</small></div>
          <div className="study-app__topbar-right"><span><Clock3 size={14} aria-hidden="true" />{todayLabel}</span><span className="study-app__profile" aria-label="学习空间个人头像">木</span></div>
        </header>

        <div className="study-app__content">
          <div className="study-app__greeting"><div><p className="study-app__eyebrow">MY LEARNING SPACE</p><h3>今天，慢慢来就很好。</h3><p>把注意力放在一件小事上，也是在向前走。</p></div><span className="study-app__greeting-mark" aria-hidden="true">✦</span></div>

          <section className="study-app__stats" aria-label="学习统计">
            <article className="study-app__stat study-app__stat--total"><span>任务总数</span><strong>{stats.total}<small> 项</small></strong><span className="study-app__stat-icon"><ListChecks size={18} aria-hidden="true" /></span></article>
            <article className="study-app__stat study-app__stat--done"><span>已经完成</span><strong>{stats.completed}<small> 项</small></strong><span className="study-app__stat-icon"><Check size={18} aria-hidden="true" /></span></article>
            <article className="study-app__stat study-app__stat--rate"><span>任务完成率</span><strong>{stats.completionRate}<small>%</small></strong><span className="study-app__progress" role="progressbar" aria-label="任务完成率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stats.completionRate}><i style={{ width: `${stats.completionRate}%` }} /></span></article>
          </section>
          <p className="study-app__summary" role="status" aria-atomic="true">
            {stats.total === 0 ? '从第一件小事开始，安排你的学习计划。' : remaining === 0 ? `全部 ${stats.total} 项任务已完成，给今天的努力一个小小的奖励。` : `已完成 ${stats.completed} / ${stats.total} 项，还有 ${remaining} 项待完成。一步一步来。`}
          </p>

          <div className="study-app__columns">
            <section className="study-app__panel study-app__task-panel" aria-labelledby="study-task-title">
              <div className="study-app__panel-heading"><div><p className="study-app__eyebrow">YOUR PLAN</p><h4 id="study-task-title">学习任务</h4></div><span className="study-app__panel-count">{stats.completed}/{stats.total} 完成</span></div>
              <form className="study-app__add-form" onSubmit={(event) => {
                onAddTask(event)
                if (draft.trim()) {
                  setFilter('all')
                  draftRef.current?.focus()
                }
              }}>
                <label className="sr-only" htmlFor="study-task-draft">新增一项学习任务</label>
                <input ref={draftRef} id="study-task-draft" type="text" value={draft} maxLength={80} placeholder="添加一项小任务…" autoComplete="off" onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} />
                <button type="submit" aria-label="添加任务" disabled={!draft.trim()}><Plus size={17} aria-hidden="true" /></button>
              </form>
              <div className="study-app__filters" role="group" aria-label="任务筛选">
                {filters.map(({ id, label, count }) => (
                  <button key={id} type="button" aria-pressed={filter === id} aria-controls="study-task-list" onClick={() => setFilter(id)}>{label}<span>{count}</span></button>
                ))}
              </div>
              <div id="study-task-list">
              {visibleTasks.length > 0 ? (
                <ul className="study-app__task-list" aria-label="学习任务列表">
                  {visibleTasks.map((task) => (
                    <li className={`study-app__task${task.completed ? ' is-complete' : ''}`} key={task.id}>
                      <label className="study-app__task-label">
                        <input type="checkbox" className="study-app__task-check" checked={task.completed} onChange={() => onToggleTask(task.id)} />
                        <span>{task.title}</span>
                      </label>
                      {task.completed && <small>已完成</small>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="study-app__empty-tasks">{tasks.length === 0 ? '还没有任务，添加一件想完成的小事吧。' : filter === 'pending' ? '待办清空啦！所有小目标都已完成。' : '还没有已完成的任务，完成后在这里回顾。'}</p>
              )}
              </div>
              <div className="study-app__task-footer"><span><Sparkles size={14} aria-hidden="true" />完成一件，也值得记下来</span></div>
              <p className="study-app__session-note">切换 B/C 视图会保留任务；刷新页面将恢复示例。</p>
            </section>

            <section className="study-app__panel study-app__course-panel" aria-labelledby="study-course-title">
              <div className="study-app__panel-heading"><div><p className="study-app__eyebrow">UP NEXT</p><h4 id="study-course-title">课程安排</h4></div><span className="study-app__course-calendar"><CalendarDays size={17} aria-hidden="true" /></span></div>
              {courses.length > 0 ? <ul className="study-app__course-list" aria-label="课程列表">
                {courses.map((course) => (
                  <li className={`study-app__course study-app__course--${course.tone ?? 'sage'}`} key={course.id}>
                    <span className="study-app__course-mark"><BookOpen size={16} aria-hidden="true" /></span>
                    <div><strong>{course.name}</strong><small>{course.teacher} · {course.room}</small><small>{course.time}</small></div>
                  </li>
                ))}
              </ul> : <p className="study-app__empty-tasks">暂时没有课程安排，留一点时间自主学习吧。</p>}
              <p className="study-app__course-note"><Clock3 size={14} aria-hidden="true" />课程来自本地示例安排</p>
            </section>
          </div>
          <footer className="study-app__footer"><span><span className="pixel-dot" aria-hidden="true" />给每一天，留一点成长的空间</span><span>LOCAL STUDY SPACE</span></footer>
        </div>
      </div>
    </section>
  )
}
