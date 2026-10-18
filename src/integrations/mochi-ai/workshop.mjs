import { createMochiContextProjection } from './context.mjs'
import { createMochiConversation } from './client.mjs'
/** Optional host-owned bridge. No component/Canvas/Inspector or Runtime dependency.
 * Anchor measurements, record edits and mode switches never schedule AI analysis.
 */
export function createWorkshopMochiConversation(host, { settleMs = 750, customContext, ...options } = {}) {
  const projection = customContext && createMochiContextProjection(host, customContext)
  const readContext = projection ? projection.read : () => { const view = host.getSnapshot(); return { ...view.context, mode: view.mode } }
  const conversation = createMochiConversation({ ...options, readContext, focusBlock: blockId => host.setSelection(blockId) })
  let previous, timer, stopped = false
  try { previous = conversation.syncContext() } catch { /* Metadata pending/unavailable: recover on the next trusted notification. */ }
  const structure = c => JSON.stringify([c.blocks, c.entities, c.relations])
  const unsubscribe = (projection || host).subscribe(() => {
    if (stopped) return
    let current
    try { current = conversation.syncContext() }
    catch { clearTimeout(timer); conversation.cancel(); return }
    if (!previous) { previous = current; return }
    const sameApp = previous.appId === current.appId && previous.instanceId === current.instanceId
    const event = !sameApp ? 'project-opened' : structure(previous) !== structure(current) ? 'structure-changed' : previous.selectedBlockId !== current.selectedBlockId ? 'selection-settled' : null
    const modeChanged = previous.mode !== current.mode
    previous = current
    if (modeChanged || current.mode !== 'blocks') { clearTimeout(timer); return }
    if (!event || !conversation.getSnapshot().proactiveEnabled) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (stopped || !conversation.getSnapshot().proactiveEnabled) return
      // UI observes errors through the state; no unhandled background rejection.
      conversation.onEvent({ type: event }).catch(() => {})
    }, settleMs)
  })
  return { conversation, dispose() { stopped = true; clearTimeout(timer); unsubscribe(); projection?.dispose(); conversation.dispose() } }
}
