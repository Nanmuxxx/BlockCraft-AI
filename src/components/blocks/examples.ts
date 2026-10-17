import { BellRing, Goal } from 'lucide-react'
import type { VisualExample } from './contract'

/** Layout-only examples; never enter AppConfig or the runnable feature catalog. */
export const VISUAL_EXAMPLES: readonly VisualExample[] = [
  { id: 'reminders', name: '提醒通知', description: '为重要的学习安排留一个温柔提醒。', icon: BellRing, tone: 'apricot' },
  { id: 'goals', name: '学习目标', description: '写下想完成的目标，积累每一步进展。', icon: Goal, tone: 'sage' },
]
