import type { ReactNode } from 'react'
import type { MochiAiAssistantProps, MochiChatMessage, MochiContext, MochiMood, MochiPlanPreview, MochiSuggestion } from './types'

export type MochiEmotion = MochiMood

export interface MochiAnchor {
  x: number
  y: number
  width?: number
  height?: number
  placement?: 'top' | 'right' | 'bottom' | 'left' | 'corner'
  visible?: boolean
}

export interface MochiHostContext {
  selectedBlockId?: string | null
  blocks: Array<{
    id: string
    name: string
    type: 'form' | 'list' | 'metric' | string
    fieldIds?: string[]
  }>
  relations: Array<{ blockId: string; entityId: string }>
  entities: Array<{
    id: string
    name: string
    fields?: Array<{ id: string; name: string; type?: string }>
  }>
  revision?: number
}

export type MochiAssistantContext = MochiContext | MochiHostContext

export interface MochiAssistantProps extends Omit<MochiAiAssistantProps, 'mood' | 'context'> {
  context: MochiAssistantContext
  emotion?: MochiEmotion
  anchor?: MochiAnchor | null
  showOverlay?: boolean
}

export type { MochiCallbacks, MochiUiContext } from './types'
export type { MochiChatMessage, MochiContext, MochiMood, MochiPlanPreview, MochiSuggestion, ReactNode }
