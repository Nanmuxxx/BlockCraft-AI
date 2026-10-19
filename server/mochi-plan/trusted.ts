import { APP_SPEC_EDIT_INSTRUCTION } from '../../src/integrations/mochi/modelPlanProvider'
import { createAppChangePlanner } from '../../src/model/appChangePlan'
import type { AppRuntime } from '../../src/model/appRuntime'
import type { ProjectState } from '../../src/model/appSpec'
import { assertProjectState } from '../../src/model/appSpecValidation'

export { APP_SPEC_EDIT_INSTRUCTION, assertProjectState }
/** Validation only. This facade has no execute/dispatch/owner implementation.
 * The disposable planner is never confirmed; the browser Host independently
 * validates again and retains exclusive confirmation/Runtime authority.
 */
export function validatePlan(candidate: unknown, snapshot: ProjectState, blockId: string) {
  assertProjectState(snapshot)
  const relation = snapshot.spec.relations.find(item => item.blockId === blockId)
  if (!relation) throw new Error('INVALID_SELECTION')
  const planner = createAppChangePlanner({ getSnapshot: () => snapshot } as AppRuntime)
  const result = planner.preview(candidate, { selectedBlockId: blockId, allowedBlockIds: [blockId], allowedEntityIds: [relation.entityId] })
  if (!result.ok) throw new Error('INVALID_PLAN')
  return { request: result.plan.request, capabilityIds: result.plan.capabilityIds }
}
