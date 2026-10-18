import type { ContextSource } from './client.mjs'
import type { ConversationHost } from './workshop.mjs'
export interface CustomContextSource {
  readReferences(): ReadonlyArray<{ id: string; definitionId: string; versionDigest: string }>
  registry: { resolve(reference: { definitionId: string; versionDigest: `sha256:${string}` }): Promise<unknown> }
}
export function createMochiContextProjection(host: ConversationHost, source: CustomContextSource): {
  read(): ContextSource; subscribe(listener: () => void): () => void; dispose(): void
}
