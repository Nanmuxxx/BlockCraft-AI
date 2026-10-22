import type { BlockSpec } from './appSpec'

/** Business names are compositions, never new renderer types or executable code. */
export type PrimitiveCapabilityId = 'pomodoro' | 'form' | 'list' | 'gallery' | 'metric-count' | 'metric-sum' | 'metric-average'
export interface PrimitiveCapability {
  readonly id: PrimitiveCapabilityId
  readonly kind: 'primitive'
  readonly status: 'supported'
  readonly name: string
  readonly behavior: string
  readonly limitations: readonly string[]
}
export interface SemanticCapability {
  readonly id: string
  readonly kind: 'semantic'
  readonly status: 'supported'
  readonly name: string
  readonly primitives: readonly PrimitiveCapabilityId[]
  readonly prerequisites: readonly string[]
  readonly limitations: readonly string[]
}
export interface UnsupportedCapability {
  readonly id: string
  readonly kind: 'semantic'
  readonly status: 'unsupported'
  readonly name: string
  readonly reason: string
}
export type AppCapability = PrimitiveCapability | SemanticCapability | UnsupportedCapability

const definitions: AppCapability[] = [
  { id: 'pomodoro', kind: 'primitive', status: 'supported', name: '可信番茄钟', behavior: 'AppSpec v2：开始、暂停、重置倒计时。', limitations: ['仅当前页面会话；不发送通知；暂不支持 ZIP 导出。'] },
  { id: 'form', kind: 'primitive', status: 'supported', name: '记录表单', behavior: '按实体字段校验并创建记录。', limitations: ['没有自动填充、关联查询或工作流。'] },
  { id: 'list', kind: 'primitive', status: 'supported', name: '记录列表', behavior: '展示字段，编辑和删除实体记录。', limitations: ['没有分组、筛选、排序或行内打卡交互。'] },
  { id: 'gallery', kind: 'primitive', status: 'supported', name: '图片画廊', behavior: '以网格展示项目内已登记的图片，并提供预览交互。', limitations: ['Mochi 只能引用现有图片资源；不能上传、生成或下载媒体。'] },
  { id: 'metric-count', kind: 'primitive', status: 'supported', name: '记录数', behavior: '统计绑定实体的全部记录条数。', limitations: ['不是去重人数、打卡天数或连续天数。'] },
  { id: 'metric-sum', kind: 'primitive', status: 'supported', name: '数值合计', behavior: '合计全部记录中指定数值字段。', limitations: ['仅支持 number 字段，没有日期区间或条件聚合。'] },
  { id: 'metric-average', kind: 'primitive', status: 'supported', name: '数值均值', behavior: '计算全部记录中指定数值字段的平均值。', limitations: ['仅支持 number 字段，不计算完成率。'] },
  { id: 'registration-management', kind: 'semantic', status: 'supported', name: '报名名单管理', primitives: ['form', 'list', 'metric-count'], prerequisites: ['已有报名实体及姓名、部门等字段。'], limitations: ['人数为记录数；没有去重、名额限制、审核或通知。'] },
  { id: 'workout-record-management', kind: 'semantic', status: 'supported', name: '训练记录管理', primitives: ['form', 'list', 'metric-count', 'metric-sum', 'metric-average'], prerequisites: ['已有训练记录实体；时长合计或均值需要 number 字段。'], limitations: ['手动录入训练日期、动作、时长；没有自动训练编排、计时或连续打卡统计。'] },
  { id: 'exercise-library', kind: 'semantic', status: 'supported', name: '动作资料管理', primitives: ['form', 'list'], prerequisites: ['已有动作实体及名称、说明字段。'], limitations: ['独立资料记录；没有跨实体选择动作、视频播放或自动写入训练记录。'] },
  { id: 'workout-timer', kind: 'semantic', status: 'unsupported', name: '训练计时器', reason: 'AppSpec v1 和 Renderer 没有计时状态、开始暂停或倒计时行为。' },
  { id: 'calendar', kind: 'semantic', status: 'unsupported', name: '训练日历', reason: 'date 字段可记录日期，但没有日历视图或排程行为。' },
  { id: 'automatic-workout-planning', kind: 'semantic', status: 'unsupported', name: '自动训练编排', reason: '没有计划生成、跨实体编排或自动执行工作流。' },
  { id: 'completion-rate', kind: 'semantic', status: 'unsupported', name: '完成率', reason: '没有条件聚合、目标分母或比例运算，不能用 count 或 average 冒充。' },
  { id: 'checklist', kind: 'semantic', status: 'unsupported', name: '交互清单', reason: 'boolean 字段可由表单或记录编辑保存，但没有清单逐项勾选行为。' },
]

// Freeze nested arrays as well: consumers cannot advertise an unsupported feature as runnable.
for (const item of definitions) {
  for (const value of Object.values(item)) if (Array.isArray(value)) Object.freeze(value)
  Object.freeze(item)
}
export const APP_CAPABILITIES: readonly AppCapability[] = Object.freeze(definitions)
export function getAppCapability(id: string): AppCapability | undefined {
  return APP_CAPABILITIES.find(capability => capability.id === id)
}
export function getBlockCapabilityId(block: BlockSpec): PrimitiveCapabilityId {
  return block.type === 'metric' ? `metric-${block.aggregation}` : block.type
}
