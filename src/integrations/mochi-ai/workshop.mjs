import { createMochiContextProjection } from './context.mjs'
import { createMochiConversation } from './client.mjs'
import { check } from './protocol.mjs'
/** Optional host-owned bridge. No component/Canvas/Inspector or Runtime dependency.
 * Anchor measurements, record edits and mode switches never schedule AI analysis.
 */
export function createWorkshopMochiConversation(host, { settleMs = 750, customContext, analyzeOnConsent = false, ...options } = {}) {
  const projection = customContext && createMochiContextProjection(host, customContext)
  const readContext = projection ? projection.read : () => { const view = host.getSnapshot(); return { ...view.context, mode: view.mode } }
  const requestPlan = typeof host.callbacks?.onRequestPlan === 'function' ? (item, guard) => {
    const context = readContext(), block = context.blocks.find(b => b.id === item.blockId)
    check(block && ['form', 'list'].includes(block.type), 'SUGGESTION_NOT_EXECUTABLE', '当前积木暂不支持修改计划。', 409)
    guard.validate()
    return host.callbacks.onRequestPlan(item.text, undefined, guard)
  } : undefined
  const conversation = createMochiConversation({ ...options, requestPlan, readContext, focusBlock: blockId => host.setSelection(blockId) })
  let previous, timer, stopped = false, initialGrantScheduled = false
  function schedule(event) {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const state = conversation.getSnapshot()
      if (stopped || !state.enabled || !state.proactiveEnabled) return
      conversation.onEvent({ type: event }).catch(() => {})
    }, settleMs)
  }
  // A later grant must not authorize work scheduled before revocation. Host
  // notifications alone cannot observe consent/capability state transitions.
  const unsubscribeConsent = conversation.subscribe(() => {
    const state = conversation.getSnapshot()
    if (!state.enabled || !state.proactiveEnabled) clearTimeout(timer)
    else if (analyzeOnConsent && !initialGrantScheduled) {
      // Only the first grant can schedule initial analysis. Revocation retires
      // this event permanently; a later grant cannot revive old queued work.
      initialGrantScheduled = true
      if (previous?.mode === 'blocks') schedule('project-opened')
    }
  })
  try { previous = conversation.syncContext() } catch { /* Metadata pending/unavailable: recover on the next trusted notification. */ }
  const structure = c => JSON.stringify([c.blocks, c.entities, c.relations])
  const unsubscribe = (projection || host).subscribe(() => {
    if (stopped) return
    let current
    try { current = conversation.syncContext() }
    catch { clearTimeout(timer); conversation.cancel(); return }
    if (!previous) { previous = current; if (analyzeOnConsent && conversation.getSnapshot().proactiveEnabled) schedule('project-opened'); return }
    const sameApp = previous.appId === current.appId && previous.instanceId === current.instanceId
    const event = !sameApp ? 'project-opened' : structure(previous) !== structure(current) ? 'structure-changed' : previous.selectedBlockId !== current.selectedBlockId ? 'selection-settled' : null
    const modeChanged = previous.mode !== current.mode
    previous = current
    if (modeChanged || current.mode !== 'blocks') { clearTimeout(timer); return }
    if (!event || !conversation.getSnapshot().proactiveEnabled) return
    schedule(event)
  })
  return { conversation, dispose() { stopped = true; clearTimeout(timer); unsubscribe(); unsubscribeConsent(); projection?.dispose(); conversation.dispose() } }
}
