import { MODULE_IDS, type ModuleId } from '../../model/appConfig'
import type { BlockModuleData, BlockRelation, RecipeId } from './contract'

export const FEATURE_CATALOG = {
  tasks: { name: '任务管理', description: '添加待办、勾选完成，一件件推进目标。', detail: '添加任务 · 完成任务', tone: 'sage' },
  courses: { name: '课程安排', description: '把课程与时间放在一起，随时查看安排。', detail: '课程名称 · 时间地点', tone: 'blue' },
  stats: { name: '学习统计', description: '连接任务管理后，看见完成数量与进度。', detail: '完成数量 · 完成比例', tone: 'apricot' },
} as const

export const RECIPES = {
  'course-tasks': {
    source: 'courses', target: 'tasks', name: '从课程创建学习任务',
    effect: '课程旁会出现“创建学习任务”。点击后，一项带课程名称的任务会加入待办。',
    undo: '取消组合会关闭创建入口，已经创建的学习任务会保留。',
  },
  'task-stats': {
    source: 'tasks', target: 'stats', name: '统计任务完成情况',
    effect: '完成或取消完成任务时，学习统计会同步更新完成数量和完成比例。',
    undo: '取消组合后，学习统计不再展示这组任务的完成情况；任务内容会保留。',
  },
} as const

export function featureKind(module: BlockModuleData<string>): ModuleId | null {
  if (module.kind !== undefined) return MODULE_IDS.includes(module.kind) ? module.kind : null
  return MODULE_IDS.find((id) => id === module.id) ?? null
}

export function combination<Id extends string>(first: BlockModuleData<Id>, second: BlockModuleData<Id>, allowed: readonly RecipeId[]) {
  if (first.id === second.id) return null
  for (const recipe of allowed) {
    const rule = RECIPES[recipe]
    if (featureKind(first) === rule.source && featureKind(second) === rule.target) return { recipe, sourceId: first.id, targetId: second.id }
    if (featureKind(second) === rule.source && featureKind(first) === rule.target) return { recipe, sourceId: second.id, targetId: first.id }
  }
  return null
}

export function hasRelation<Id extends string>(relations: readonly BlockRelation<Id>[], candidate: { recipe: RecipeId; sourceId: Id; targetId: Id }) {
  return relations.some((relation) => relation.recipe === candidate.recipe && relation.sourceId === candidate.sourceId && relation.targetId === candidate.targetId)
}

/** Used for missing positions and explicit arrange, never for creating relations. */
export function autoLayout<Id extends string>(ids: readonly Id[], width: number) {
  const columns = width >= 860 ? 3 : width >= 560 ? 2 : 1
  const rows = Math.max(1, Math.ceil(ids.length / columns))
  const height = Math.max(360, rows * 280 + 24)
  const positions = Object.fromEntries(ids.map((id, index) => {
    const row = Math.floor(index / columns)
    const itemsInRow = Math.min(columns, ids.length - row * columns)
    return [id, { x: (index % columns + 0.5) / itemsInRow, y: (row * 280 + 152) / height }]
  })) as Record<Id, { x: number; y: number }>
  return { height, positions }
}

export function clampPosition(position: { x: number; y: number }, width: number, height: number, cardWidth: number) {
  const insetX = Math.min(0.5, (cardWidth / 2 + 18) / Math.max(1, width))
  const insetY = Math.min(0.5, 136 / Math.max(1, height))
  return {
    x: Math.min(1 - insetX, Math.max(insetX, Number.isFinite(position.x) ? position.x : 0.5)),
    y: Math.min(1 - insetY, Math.max(insetY, Number.isFinite(position.y) ? position.y : 0.5)),
  }
}
