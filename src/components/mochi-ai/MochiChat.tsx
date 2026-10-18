import { MochiAiAssistant } from './MochiAiAssistant'
import type { MochiAssistantContext, MochiAssistantProps, MochiContext } from './MochiTypes'

function toChatContext(context: MochiAssistantContext): MochiContext {
  if (!('entities' in context)) return context
  return {
    summary: context.selectedBlockId ? `已选中积木：${context.blocks.find((block) => block.id === context.selectedBlockId)?.name ?? context.selectedBlockId}` : undefined,
    blocks: context.blocks.map((block) => {
      const relation = context.relations.find((item) => item.blockId === block.id)
      const entity = relation ? context.entities.find((item) => item.id === relation.entityId) : undefined
      return { id: block.id, name: block.name, kind: block.type, details: entity ? `关联实体：${entity.name}` : undefined }
    }),
  }
}

/** Chat surface kept separate so the host can swap the panel without changing its callbacks. */
export function MochiChat({ emotion = 'idle', ...props }: MochiAssistantProps) {
  return <MochiAiAssistant {...props} context={toChatContext(props.context)} mood={emotion} />
}
