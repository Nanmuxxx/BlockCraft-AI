import type { CustomContextSource } from './context.mjs'
import type { ContextSource, SuggestionPlanGuard, createMochiConversation } from './client.mjs'
export interface ConversationHost {
  getSnapshot(): { context: Omit<ContextSource, 'mode'>; mode: 'blocks' | 'run' }
  subscribe(listener: () => void): () => void
  setSelection(blockId: string | null): void
  callbacks?: { onRequestPlan(prompt: string, uiContext?: unknown, guard?: SuggestionPlanGuard): Promise<unknown> | unknown }
}
export function createWorkshopMochiConversation(host: ConversationHost, options?: {
  customContext?: CustomContextSource; settleMs?: number; api?: Parameters<typeof createMochiConversation>[0]['api']; now?: () => number
  analyzeOnConsent?: boolean; planningEnabled?: boolean; suggestionTtlMs?: number
}): { conversation: ReturnType<typeof createMochiConversation>; dispose(): void }
