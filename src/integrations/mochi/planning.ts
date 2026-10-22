import { AppSpecError } from '../../model/appSpecValidation'
import type { PlanProvider, PlanRequest } from './host'

export const AI_MODIFICATION_DISABLED = 'AI 修改能力尚未启用：当前计划服务未配置。可继续手动编辑积木与运行应用。'

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
  if (!block) throw new AppSpecError('SELECTION_REQUIRED', '请先选择有效积木。')
  if (block.type === 'gallery') {
    return {
      requestId: request.requestId, baseRevision: context.revision,
      prompt: request.prompt,
      block: { id: block.id, name: block.name, type: block.type, imageIds: [...(block.imageIds ?? [])], layout: block.layout, interaction: block.interaction },
      assets: context.assets.map(({ id, name, altText, mimeType }) => ({ id, name, ...(altText === undefined ? {} : { altText }), mimeType })),
    }
  }
  const sourceBlock = request.snapshot.spec.blocks.find(item => item.id === block?.id)
  if (!block || !entity || !sourceBlock) throw new AppSpecError('SELECTION_REQUIRED', '请先选择有效积木。')
  const spec = request.snapshot.spec
  return {
    requestId: request.requestId, baseRevision: context.revision,
    prompt: request.prompt,
    block: { id: block.id, name: block.name, type: block.type, fieldIds: [...(block.fieldIds ?? [])],
      ...(sourceBlock.presentation ? { presentation: { ...sourceBlock.presentation } } : {}) },
    entity: { id: entity.id, name: entity.name, fields: entity.fields.map(({ id, name, type }) => ({ id, name, type,
      required: request.snapshot.spec.entities.find(item => item.id === entity.id)!.fields.find(field => field.id === id)!.required })) },
    // IDs alone prevent cross-entity structural collisions without exposing unrelated metadata or records.
    reservedIds: [spec.id, ...spec.entities.flatMap(item => [item.id, ...item.fields.map(field => field.id)]),
      ...spec.blocks.map(item => item.id), ...spec.relations.map(item => item.id)],
  }
}
