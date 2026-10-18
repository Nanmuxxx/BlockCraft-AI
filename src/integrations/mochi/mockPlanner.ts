import type { AppChangeCandidate } from '../../model/appChangePlan'
import type { PlanProvider } from './host'

/** Fixed fixture only: ignores natural language, adds an OPTIONAL text field to
 * the selected form/list, then displays it there. No network or model inference.
 * Explicit injection is required; never enabled in the production workshop.
 */
export const mockAddOptionalField: PlanProvider = ({ context, snapshot, requestId }) => {
  const block = snapshot.spec.blocks.find(item => item.id === context.selectedBlockId)
  if (!block || block.type === 'metric') throw new Error('Mock fixture requires a form or list')
  const entityId = snapshot.spec.relations.find(item => item.blockId === block.id)!.entityId
  const fieldId = `${requestId}-field`
  const candidate: AppChangeCandidate = {
    request: { requestId, baseRevision: context.revision, commands: [
      { type: 'addField', entityId, field: { id: fieldId, name: 'Mock 备注', type: 'text', required: false } },
      { type: 'configureBlockFields', blockId: block.id, fieldIds: [...block.fieldIds, fieldId] },
    ] },
    capabilityIds: [],
  }
  return candidate
}
