import { AppSpecError } from '../../model/appSpecValidation'
import type { PlanProvider, PlanRequest } from './host'

export const AI_MODIFICATION_DISABLED = 'AI 修改能力尚未启用：DeepSeek 修改计划 API 尚未接入。可继续手动编辑积木与运行应用。'

/** Production fails closed. No Mock import, transport, or fabricated reply. */
export const unavailablePlanProvider: PlanProvider = () => {
  throw new AppSpecError('AI_MODIFICATION_DISABLED', AI_MODIFICATION_DISABLED)
}

/** Explicit future egress allowlist. Never serialize PlanRequest or its snapshot.
 * Metadata/names and prompt are user data too; send only after an explicit request.
 * This projection conveys no authority: Phase A still validates host-owned scope.
 */
export function toMinimalPlanInput(request: PlanRequest) {
  const { context } = request
  const block = context.blocks.find(item => item.id === context.selectedBlockId)
  const relation = context.relations.find(item => item.blockId === block?.id)
  const entity = context.entities.find(item => item.id === relation?.entityId)
  if (!block || !entity) throw new AppSpecError('SELECTION_REQUIRED', '请先选择有效积木。')
  return {
    requestId: request.requestId, baseRevision: context.revision,
    prompt: request.prompt,
    block: { id: block.id, name: block.name, type: block.type, fieldIds: [...(block.fieldIds ?? [])] },
    entity: { id: entity.id, name: entity.name, fields: entity.fields.map(({ id, name, type }) => ({ id, name, type })) },
  }
}
