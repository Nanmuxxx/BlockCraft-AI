import type { ReactNode } from 'react'

export type MochiMood = 'idle' | 'thinking' | 'curious' | 'happy' | 'celebrating' | 'error'

export interface MochiContextBlock {
  id: string
  name: string
  kind: string
  details?: string
}

export interface MochiContext {
  blocks: MochiContextBlock[]
  summary?: string
}

export interface MochiChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface MochiSuggestion {
  id: string
  label: string
  prompt: string
  source?: 'local_rule' | 'deepseek'
}

export interface MochiPlanChange {
  operation: string
  target: string
  description: string
  before?: ReactNode
  after?: ReactNode
}

export interface MochiPlanPreview {
  planId: string
  title: string
  summary?: string
  changes: MochiPlanChange[]
}

export interface MochiAiAssistantProps {
  context: MochiContext
  messages: MochiChatMessage[]
  suggestions: MochiSuggestion[]
  preview?: MochiPlanPreview | null
  mood?: MochiMood
  onRequestPlan: (prompt: string, context: MochiContext) => void | Promise<void>
  onConfirm: (planId: string) => void | Promise<void>
  onCancel: (planId: string) => void
  onIgnore: (suggestionId: string) => void
}

export type ComposerKeyIntent = {
  key: string
  shiftKey: boolean
  isComposing: boolean
}

export function shouldSubmitComposerKey({ key, shiftKey, isComposing }: ComposerKeyIntent) {
  return key === 'Enter' && !shiftKey && !isComposing
}

export function claimPlanConfirmation(confirmedPlanIds: Set<string>, planId: string) {
  if (confirmedPlanIds.has(planId)) return false
  confirmedPlanIds.add(planId)
  return true
}
