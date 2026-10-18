import type { ArtifactReference, CustomBlockInstance } from '../../custom-block'
import { assertArtifactReference } from '../../custom-block'
import { assertJson, keys, object } from '../../custom-block/json'
import { referenceOf, sameReference } from './adapter'

/** Display observations only, never execution permits. No runnable variant yet. */
export type ViewerState = {
  status: 'pending-build' | 'unavailable'
  reference: ArtifactReference
  label: string
  message: string
}
export function viewerState(instance: CustomBlockInstance, observation?: unknown): ViewerState {
  const reference = Object.freeze(referenceOf(instance))
  try {
    assertJson(observation); object(observation); keys(observation, ['reference', 'status'])
    assertArtifactReference(observation.reference)
    if (sameReference(instance, observation.reference) && observation.status === 'pending-build') {
      return { reference, status: 'pending-build', label: '等待构建', message: '源码制品已登记，正在等待经过验证的隔离构建与运行服务。' }
    }
  } catch { /* Missing/invalid/mismatched observations all fail closed. */ }
  return { reference, status: 'unavailable', label: '运行暂不可用', message: '当前没有经过验证并接线的隔离 Viewer，暂时无法运行或交互。' }
}
