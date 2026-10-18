import type { ContextSource, createMochiConversation } from './client.mjs'
export interface ConversationHost {
  getSnapshot(): { context: Omit<ContextSource, 'mode'>; mode: 'blocks' | 'run' }
  subscribe(listener: () => void): () => void
  setSelection(blockId: string | null): void
}
export function createWorkshopMochiConversation(host: ConversationHost, options?: {
  settleMs?: number; api?: Parameters<typeof createMochiConversation>[0]['api']; now?: () => number
}): { conversation: ReturnType<typeof createMochiConversation>; dispose(): void }
