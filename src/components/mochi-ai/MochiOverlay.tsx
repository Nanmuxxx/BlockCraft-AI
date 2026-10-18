import { useLayoutEffect, useRef, useState } from 'react'
import { MochiEmotion } from './MochiEmotion'
import { createMochiMotion } from './motion/controller'
import type { MochiAnchor, MochiEmotion as MochiEmotionName } from './MochiTypes'
import './mochi-motion.css'

export interface MochiOverlayProps {
  anchor?: MochiAnchor | null
  emotion?: MochiEmotionName
  label?: string
  /** Optional integration seam; visual feedback never grants Runtime authority. */
  onActivate?: () => void
}

export function MochiOverlay({ anchor, emotion = 'idle', label, onActivate }: MochiOverlayProps) {
  const element = useRef<HTMLDivElement>(null)
  const latestAnchor = useRef(anchor)
  latestAnchor.current = anchor
  const controller = useRef<ReturnType<typeof createMochiMotion> | null>(null)
  const [reaction, setReaction] = useState<MochiEmotionName | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useLayoutEffect(() => {
    const motion = createMochiMotion(element.current!, () => latestAnchor.current, (next, duration) => {
      clearTimeout(timer.current)
      setReaction(next)
      timer.current = setTimeout(() => setReaction(null), duration)
    })
    controller.current = motion
    return () => { clearTimeout(timer.current); motion.dispose(); controller.current = null }
  }, [])
  useLayoutEffect(() => { controller.current?.schedule() }, [anchor])
  const mood = emotion === 'thinking' || emotion === 'error' ? emotion : reaction ?? emotion
  const activate = () => {
    if (onActivate) { onActivate(); return }
    // Existing Workshop already exposes its chat. Reveal and focus that same UI.
    const chat = element.current?.parentElement?.querySelector<HTMLElement>('.mochi-ai')
    chat?.scrollIntoView({ behavior: 'auto', block: 'center' })
    const composer = chat?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')
    if (composer) composer.focus({ preventScroll: true })
    else {
      const heading = chat?.querySelector<HTMLElement>('h2')
      heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true })
    }
  }
  return <div ref={element} className="mochi-overlay" data-placement={anchor?.placement ?? 'right'}>
    <button type="button" className="mochi-overlay__activate" aria-label="打开 Mochi 聊天与建议" title="和 Mochi 聊聊"
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); activate() }}>
      <MochiEmotion emotion={mood} label={label} />
    </button>
  </div>
}
