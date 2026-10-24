import { readBlockPresentation } from './presentation'
import type { ProjectState } from '../../model/appSpec'
import type { AppBlockType, BlockModuleData } from './contract'

export const APP_BLOCK_CATALOG = {
  filter: { name: '搜索筛选', description: '搜索与字段筛选，联动指定积木。', detail: '搜索 · 精确筛选', tone: 'sage' },
  chart: { name: '分组图表', description: '分组统计，点击分组筛选指定积木。', detail: '柱状图 / 折线图', tone: 'apricot' },
  details: { name: '记录详情', description: '点击列表记录，查看指定字段详情。', detail: '列表选择联动', tone: 'blue' },
  gallery: { name: '图片画廊', description: '展示项目图片，点击图片查看大图。', detail: '网格画廊 · 点击预览', tone: 'blue' },
  pomodoro: { name: '番茄钟', description: '可信倒计时：开始、暂停、重置。', detail: 'AppSpec v2 · 可信交互 / 1', tone: 'apricot' },
  list: { name: '列表', description: '查看和编辑绑定实体的记录。', detail: '记录列表', tone: 'sage' },
  form: { name: '表单', description: '向绑定实体提交新记录。', detail: '记录录入', tone: 'blue' },
  metric: { name: '指标', description: '从绑定实体的记录计算统计。', detail: '实时统计', tone: 'apricot' },
} as const

export function appBlockKind(module: BlockModuleData<string>): AppBlockType | null {
  return module.kind === 'filter' || module.kind === 'chart' || module.kind === 'details' || module.kind === 'list' || module.kind === 'form' || module.kind === 'metric' || module.kind === 'pomodoro' || module.kind === 'gallery' ? module.kind : null
}

/** A projection, never a second project store. Identity always comes from block.id. */
export function toAppCanvasModules(state: ProjectState): BlockModuleData<string>[] {
  return state.spec.blocks.map(block => ({
    id: block.id, kind: block.type, name: block.name,
    presentation: readBlockPresentation(block),
    description: APP_BLOCK_CATALOG[block.type].description,
    detail: block.type === 'gallery' ? `${block.imageIds.length} 张项目图片` : state.spec.entities.find(entity => entity.id === state.spec.relations.find(binding => binding.blockId === block.id)?.entityId)?.name,
  }))
}
