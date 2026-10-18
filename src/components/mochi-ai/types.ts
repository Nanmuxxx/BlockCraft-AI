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

/** Display data only. Passing this back cannot grant block/entity permissions. */
export type MochiUiContext = MochiContext

/** All four actions are implemented by the host, never by this UI. */
export interface MochiCallbacks {
  onRequestPlan: (prompt: string, uiContext: MochiUiContext) => void | Promise<void>
  onConfirm: (planId: string) => void | Promise<void>
  onCancel: (planId: string) => void
  onIgnore: (suggestionId: string) => void
}

/** Controlled host projection. It carries no planner handles or authority. */
export interface MochiOperation {
  phase: string
  requestId: string | null
  busy: boolean
  error: { code: string; message: string } | null
  receipt: { ok: boolean; committedRevision?: number } | null
  lastApplied: { requestId: string; receipt: { committedRevision: number } } | null
}

export interface MochiAiAssistantProps extends MochiCallbacks {
  operation?: MochiOperation
  onCancelRequest?: (requestId: string) => void
  context: MochiContext
  messages: MochiChatMessage[]
  suggestions: MochiSuggestion[]
  preview?: MochiPlanPreview | null
  mood?: MochiMood
  /** A missing real planning service must be explicit and cannot accept prompts. */
  planningDisabledReason?: string
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
