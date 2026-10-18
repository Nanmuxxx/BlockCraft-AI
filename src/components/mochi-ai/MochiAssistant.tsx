import { MochiChat } from './MochiChat'
import { MochiOverlay } from './MochiOverlay'
import type { MochiAssistantProps } from './MochiTypes'
import './mochi-ai.css'

export function MochiAssistant({ anchor, showOverlay = true, emotion = 'idle', ...chatProps }: MochiAssistantProps) {
  return (
    <>
      <MochiChat {...chatProps} emotion={emotion} />
      {showOverlay && <MochiOverlay anchor={anchor} emotion={emotion} />}
    </>
  )
}
