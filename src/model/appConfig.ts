/**
 * BlockCraft 的跨组件公共协议。
 *
 * 约定：AppConfig 由主程序持有。功能数据（data）与画布位置
 * （blockPositions）分开保存，画布拖动不能改变功能配置。
 */

export const MODULE_IDS = ['tasks', 'courses', 'stats'] as const
export type ModuleId = (typeof MODULE_IDS)[number]

export type TaskPriority = 'high' | 'medium' | 'low'

export interface BlockPosition {
  x: number
  y: number
}

export interface StudyTask {
  id: string
  title: string
  completed: boolean
  /** 为 Mochi 后续开启任务优先级时保留的字段。 */
  priority: TaskPriority
}

export interface Course {
  id: string
  name: string
  teacher: string
  time: string
  room: string
  /** 仅供当前视觉层使用，业务层不依赖该字段。 */
  tone?: 'sage' | 'blue' | 'apricot'
}

export interface StudyStats {
  total: number
  completed: number
  completionRate: number
}

export interface AppData {
  tasks: StudyTask[]
  courses: Course[]
  stats: StudyStats
}

export interface AppConfig {
  idea: string
  /** 功能配置与状态数据，由主程序统一管理。 */
  data: AppData
  /** 画布布局数据，独立于 data。 */
  blockPositions: Record<ModuleId, BlockPosition>
}

export const DEFAULT_BLOCK_POSITIONS: Record<ModuleId, BlockPosition> = {
  tasks: { x: 0.26, y: 0.27 },
  courses: { x: 0.74, y: 0.27 },
  stats: { x: 0.5, y: 0.76 },
}

/** 主程序创建项目时使用的本地 Mock 初始配置。 */
export function createInitialAppConfig(idea: string): AppConfig {
  const tasks: StudyTask[] = [
    { id: 'task-linear-algebra', title: '完成线性代数第三章习题', completed: false, priority: 'high' },
    { id: 'task-english', title: '整理英语听力错题', completed: true, priority: 'medium' },
    { id: 'task-python', title: '复习 Python 函数与列表', completed: false, priority: 'medium' },
  ]

  return {
    idea,
    data: {
      tasks,
      courses: [
        { id: 'course-linear-algebra', name: '线性代数', teacher: '周老师', time: '今天 14:00 – 15:40', room: '东 1-203', tone: 'sage' },
        { id: 'course-english', name: '大学英语 · 口语', teacher: '林老师', time: '明天 09:00 – 10:40', room: '外语楼 204', tone: 'blue' },
        { id: 'course-python', name: '程序设计基础', teacher: '陈老师', time: '周五 16:00 – 17:40', room: '机房 B-12', tone: 'apricot' },
      ],
      stats: getStudyStats(tasks),
    },
    blockPositions: { ...DEFAULT_BLOCK_POSITIONS },
  }
}

export function getStudyStats(tasks: StudyTask[]): StudyStats {
  const total = tasks.length
  const completed = tasks.filter((task) => task.completed).length
  return {
    total,
    completed,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
  }
}

export function withTasks(data: AppData, tasks: StudyTask[]): AppData {
  return { ...data, tasks, stats: getStudyStats(tasks) }
}

export type AppConfigUpdater = (current: AppConfig) => AppConfig

export interface BlockCanvasProps {
  positions: Record<ModuleId, BlockPosition>
  selectedModule: ModuleId | null
  onSelectModule: (moduleId: ModuleId) => void
  onMoveModule: (moduleId: ModuleId, position: BlockPosition) => void
}

export type MochiSuggestionId = 'enable-task-priority'

export interface MochiSuggestion {
  id: MochiSuggestionId
  message: string
}

export interface MochiPanelProps {
  suggestions?: MochiSuggestion[]
  onSendMessage: (message: string) => void
  onConfirmSuggestion: (suggestionId: MochiSuggestionId) => void
}

export type ClarificationChoice = 'tasks' | 'courses' | 'both'

export interface ClarificationStepProps {
  onComplete: (choice: ClarificationChoice) => void
}

