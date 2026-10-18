export interface ContextSource {
  appId: string; instanceId: string; revision: number; selectedBlockId: string | null; mode: 'blocks' | 'run'
  blocks: Array<{ id: string; name: string; type: string; fieldIds?: readonly string[] }>
  entities: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string }> }>
  relations: Array<{ blockId: string; entityId: string }>
}
export interface Advice {
  id: string; text: string; reason: string; blockId: string | null; priority: 'low' | 'medium' | 'high'
  requiresUserAction: boolean; kind: 'explain' | 'design-change'
}
export interface ConversationState {
  enabled: boolean; proactiveEnabled: boolean; busy: boolean; modificationsEnabled: false
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>
  suggestions: ReadonlyArray<Readonly<Advice>>; error: { code: string; message: string } | null
}
export function createMochiApi(options?: { fetchImpl?: typeof fetch; timeoutMs?: number }): {
  status(options?: { signal?: AbortSignal }): Promise<unknown>
  analyze(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
  consent(enabled: boolean): Promise<unknown>
  ignore(id: string): Promise<unknown>
}
export function createMochiConversation(options: {
  api?: ReturnType<typeof createMochiApi>; readContext(): ContextSource; focusBlock(blockId: string): void; now?: () => number
}): {
  getSnapshot(): Readonly<ConversationState>; subscribe(fn: () => void): () => void
  syncContext(): unknown; refreshStatus(): Promise<Readonly<ConversationState>>; setProactive(enabled: boolean): Promise<void>; cancel(): void
  chat(prompt: string): Promise<unknown>; onEvent(event: { type: 'project-opened' | 'structure-changed' | 'selection-settled' }): Promise<unknown>
  focusSuggestion(id: string): Readonly<Advice>; continueSuggestion(id: string, question?: string): Promise<unknown>
  ignore(id: string): Promise<void>; requestModification(id: string): never; dispose(): void
}
