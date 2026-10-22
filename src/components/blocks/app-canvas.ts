import { readBlockPresentation } from './presentation'
import type { ProjectState } from '../../model/appSpec'
import type { AppBlockType, BlockModuleData } from './contract'

export const APP_BLOCK_CATALOG = {
  gallery: { name: '图片画廊', description: '展示项目图片，点击图片查看大图。', detail: '网格画廊 · 点击预览', tone: 'blue' },
  pomodoro: { name: '番茄钟', description: '可信倒计时：开始、暂停、重置。', detail: 'AppSpec v2 · 可信交互 / 1', tone: 'apricot' },
  list: { name: '列表', description: '查看和编辑绑定实体的记录。', detail: '记录列表', tone: 'sage' },
  form: { name: '表单', description: '向绑定实体提交新记录。', detail: '记录录入', tone: 'blue' },
  metric: { name: '指标', description: '从绑定实体的记录计算统计。', detail: '实时统计', tone: 'apricot' },
} as const

export function appBlockKind(module: BlockModuleData<string>): AppBlockType | null {
  return module.kind === 'list' || module.kind === 'form' || module.kind === 'metric' || module.kind === 'pomodoro' || module.kind === 'gallery' ? module.kind : null
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
