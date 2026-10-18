import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { MochiAssistant } from '../../components/mochi-ai/MochiAssistant'
import { evaluateMochiSuggestions } from '../../components/mochi-ai/MochiSuggestions'
import type { MochiChatMessage, MochiCallbacks } from '../../components/mochi-ai/types'
import type { createMochiHost, HostView } from './host'

export type MochiHost = ReturnType<typeof createMochiHost>

/** Measure against the actual positioned Workshop, including nested scroll/drag.
 * Each measurement is bound to the current host epoch and revision.
 */
function useBlockAnchor(host: MochiHost, view: HostView, root: RefObject<HTMLElement | null>) {
  const { instanceId, revision, selectedBlockId } = view.context
  const epoch = view.epoch
  useLayoutEffect(() => {
    const surface = root.current
    if (!surface || !selectedBlockId || view.mode !== 'blocks') return
    const block = [...surface.querySelectorAll<HTMLElement>('[data-block-key]')]
      .find(element => element.dataset.blockKey === `module:${selectedBlockId}`)
    if (!block) return
    let frame = 0
    let last = ''
    let stopped = false
    const measure = () => {
      frame = 0
      if (stopped) return
      const state = host.getSnapshot()
      if (state.epoch !== epoch || state.context.revision !== revision) return
      const box = block.getBoundingClientRect()
      const container = surface.getBoundingClientRect()
      const rect = { x: box.left - container.left + surface.scrollLeft, y: box.top - container.top + surface.scrollTop,
        width: box.width, height: box.height, placement: box.right + 68 > window.innerWidth ? 'left' as const : 'right' as const,
        visible: box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth }
      const signature = JSON.stringify(rect)
      if (signature === last) return
      last = signature
      host.setAnchor({ instanceId, revision, selectedBlockId, epoch, rect })
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule)
    resize.observe(surface); resize.observe(block)
    const mutation = new MutationObserver(schedule)
    mutation.observe(block, { attributes: true, attributeFilter: ['style', 'class'] })
    document.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    measure()
    return () => {
      stopped = true; cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect()
      document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule)
    }
  }, [host, root, instanceId, revision, selectedBlockId, epoch, view.mode])
}

export function WorkshopMochi({ host, view, root, planningDisabledReason }: {
  host: MochiHost; view: HostView; root: RefObject<HTMLElement | null>; planningDisabledReason?: string
}) {
  useBlockAnchor(host, view, root)
  const [messages, setMessages] = useState<MochiChatMessage[]>([])
  const lastEvent = useRef({ receipt: '', error: '' })
  const receipt = view.receipt
  useEffect(() => {
    const next: MochiChatMessage[] = []
    const receiptKey = receipt ? String(receipt.committedRevision) : ''
    const errorKey = JSON.stringify(view.error)
    if (receipt && receiptKey !== lastEvent.current.receipt) next.push({ id: `receipt-${receiptKey}`, role: 'system', content: `Runtime 已确认应用修改，当前回执版本：${receipt.committedRevision}。` })
    if (view.error && errorKey !== lastEvent.current.error) next.push({ id: crypto.randomUUID(), role: 'system', content: `${view.error.code}：${view.error.message}` })
    lastEvent.current = { receipt: receiptKey, error: errorKey }
    if (next.length) setMessages(previous => [...previous, ...next].slice(-100))
  }, [receipt, view.error])
  const callbacks: MochiCallbacks = useMemo(() => ({ ...host.callbacks,
    async onRequestPlan(prompt, uiContext) {
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'user' as const, content: prompt }].slice(-100))
      await host.callbacks.onRequestPlan(prompt, uiContext)
    },
  }), [host])
  const suggestions = view.context.selectedBlockId ? evaluateMochiSuggestions(view.context)
    .filter(item => !view.ignoredSuggestionIds.includes(item.id)) : []
  return <div className="app-spec-workshop__mochi" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <MochiAssistant {...callbacks} context={view.context} messages={messages}
      suggestions={suggestions} preview={view.preview} planningDisabledReason={planningDisabledReason}
      emotion={view.error ? 'error' : view.busy ? 'thinking' : receipt ? 'happy' : 'idle'}
      anchor={view.anchor} showOverlay={view.mode === 'blocks'} />
  </div>
}
