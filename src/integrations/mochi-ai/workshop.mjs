import { createMochiConversation } from './client.mjs'
/** Optional host-owned bridge. No component/Canvas/Inspector or Runtime dependency.
 * Anchor measurements, record edits and mode switches never schedule AI analysis.
 */
export function createWorkshopMochiConversation(host, { settleMs = 750, ...options } = {}) {
  const readContext = () => { const view = host.getSnapshot(); return { ...view.context, mode: view.mode } }
  const conversation = createMochiConversation({ ...options, readContext, focusBlock: blockId => host.setSelection(blockId) })
  let previous = conversation.syncContext(), timer, stopped = false
  const structure = c => JSON.stringify([c.blocks, c.entities, c.relations])
  const unsubscribe = host.subscribe(() => {
    if (stopped) return
    let current
    try { current = conversation.syncContext() }
    catch { clearTimeout(timer); conversation.cancel(); return }
    const sameApp = previous.appId === current.appId && previous.instanceId === current.instanceId
    const event = !sameApp ? 'project-opened' : structure(previous) !== structure(current) ? 'structure-changed' : previous.selectedBlockId !== current.selectedBlockId ? 'selection-settled' : null
    const modeChanged = previous.mode !== current.mode
    previous = current
    if (modeChanged) { clearTimeout(timer); return }
    if (!event || !conversation.getSnapshot().proactiveEnabled) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (stopped || !conversation.getSnapshot().proactiveEnabled) return
      // UI observes errors through the state; no unhandled background rejection.
      conversation.onEvent({ type: event }).catch(() => {})
    }, settleMs)
  })
  return { conversation, dispose() { stopped = true; clearTimeout(timer); unsubscribe(); conversation.dispose() } }
}
