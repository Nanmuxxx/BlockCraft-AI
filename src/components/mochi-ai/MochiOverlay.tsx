import type { CSSProperties } from 'react'
import { MochiEmotion } from './MochiEmotion'
import type { MochiAnchor, MochiEmotion as MochiEmotionName } from './MochiTypes'
import './mochi-ai.css'

export interface MochiOverlayProps {
  anchor?: MochiAnchor | null
  emotion?: MochiEmotionName
  label?: string
}

export function MochiOverlay({ anchor, emotion = 'idle', label }: MochiOverlayProps) {
  if (!anchor || anchor.visible === false) return null
  const style: CSSProperties = {
    left: `${Math.max(0, anchor.x)}px`,
    top: `${Math.max(0, anchor.y)}px`,
    '--mochi-anchor-width': `${Math.max(0, anchor.width ?? 0)}px`,
    '--mochi-anchor-height': `${Math.max(0, anchor.height ?? 0)}px`,
  } as CSSProperties

  return (
    <div className="mochi-overlay" data-placement={anchor.placement ?? 'right'} style={style} aria-hidden="true">
      <MochiEmotion emotion={emotion} label={label} />
    </div>
  )
}
