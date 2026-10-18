import { Blocks } from 'lucide-react'
import type { ProjectState } from '../../model/appSpec'
import { MochiCat } from '../MochiCat'
import '../mochi-panel.css'

/** Read-only local context: never dispatches commands or calls a chat service. */
export function AppSpecMochiPanel({ snapshot, blockId }: { snapshot: ProjectState; blockId: string | null }) {
  const block = snapshot.spec.blocks.find(item => item.id === blockId)
  const binding = snapshot.spec.relations.find(item => item.blockId === block?.id)
  const entity = snapshot.spec.entities.find(item => item.id === binding?.entityId)
  const kind = block ? { form: '表单', list: '列表', metric: '统计' }[block.type] : ''
  return <section className="mochi-panel app-spec-mochi" aria-label="Mochi 的小窝">
    <header className="mochi-panel__header">
      <div className="mochi-panel__title-wrap"><span className="mochi-panel__avatar" aria-hidden="true"><MochiCat className="mochi-panel__avatar-image" /></span><div><h2>Mochi 的小窝</h2><p>陪你一起搭建</p></div></div>
      <span className="mochi-panel__mode">本地提示</span>
    </header>
    <div className="mochi-panel__companion">
      <div className="mochi-panel__cat-scene" aria-hidden="true"><MochiCat className="mochi-panel__cat" /><span className="mochi-panel__cat-ground" /></div>
      <section className="mochi-panel__speech" aria-live="polite"><span className="mochi-panel__speech-name">Mochi</span>
        <p>{block ? `「${block.name}」是一块${kind}积木。${entity ? `它使用「${entity.name}」的数据。` : ''}` : '选一块积木吧，我们一起看看它能做什么。'}</p>
        <small><Blocks size={12} aria-hidden="true" />{block ? `正在看：${block.name}` : '从一块积木开始'}</small>
      </section>
    </div>
    <p className="mochi-panel__context-note">{block?.type === 'metric' ? '统计随记录变化更新。' : block ? '在下方选择展示字段，再到应用预览看看效果。' : 'B 模式搭积木，C 模式使用你的应用。'}这里的提示来自当前应用配置，不会替你执行操作。</p>
  </section>
}
