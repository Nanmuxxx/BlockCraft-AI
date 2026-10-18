import type { ProjectState } from '../model/appSpec'

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
export interface JsonObject { [key: string]: JsonValue }
type Annotation = { title?: string }
export type RestrictedSchema = Annotation & (
  | { type: 'object'; properties: Record<string, RestrictedSchema>; required: string[]; additionalProperties: false }
  | { type: 'string'; maxLength: number; minLength?: number; enum?: string[] }
  | { type: 'number' | 'integer'; minimum?: number; maximum?: number; enum?: number[] }
  | { type: 'boolean'; enum?: boolean[] }
)
export type ObjectSchema = RestrictedSchema & { type: 'object' }
export type VersionDigest = `sha256:${string}`
export interface ArtifactReference { definitionId: string; versionDigest: VersionDigest }
export interface CustomBlockInstance extends ArtifactReference { id: string; props: JsonObject }
export interface CustomBlockManifest {
  protocolVersion: 1
  definitionId: string
  name: string
  sdkVersion: '1.0.0'
  entry: string
  propsSchema: ObjectSchema
  stateSchema: ObjectSchema
  events: Record<string, ObjectSchema>
  /** Requests only. No execution or data permissions are granted by this field. */
  requestedCapabilities: Array<{ kind: 'state.write' } | { kind: 'records.create'; entityId: string }>
}
/** Inert build inputs; never imported, evaluated or embedded into project instances. */
export interface SourceArtifact {
  artifactVersion: 1
  manifest: CustomBlockManifest
  sources: Record<string, string>
  dependencies: Record<string, { version: string; integrity: string }>
  build: {
    profile: 'react-isolated-v1'
    toolchain: { name: 'esbuild'; version: string; integrity: string }
    target: 'es2020'
    format: 'esm'
    maxBundleBytes: number
  }
}
export interface RegisteredArtifact { versionDigest: VersionDigest; artifact: SourceArtifact }
/** Storage boundary, not an execution-authority registry. Reads must use exact refs. */
export interface ArtifactRegistry { resolve(reference: Readonly<ArtifactReference>): Promise<unknown> }
export interface CustomProject {
  formatVersion: 2
  /** The only authoritative project revision. base deliberately has no revision. */
  revision: number
  base: Omit<ProjectState, 'revision'>
  custom: {
    instances: CustomBlockInstance[]
    positions: Record<string, { x: number; y: number }>
    states: Record<string, { versionDigest: VersionDigest; stateRevision: number; value: JsonObject }>
  }
  renderOrder: Array<{ kind: 'builtin' | 'custom'; id: string }>
}
export interface MessageIdentity {
  protocol: 'custom-block/1'
  channelId: string
  sessionId: string
  instanceId: string
  versionDigest: VersionDigest
  seq: number
  requestId: string
}
export type SandboxMessage = MessageIdentity & (
  | { type: 'ready'; payload: { sdkVersion: '1.0.0' } }
  | { type: 'state.compareAndSet'; payload: { baseRevision: number; stateRevision: number; value: JsonObject } }
  | { type: 'event.emit'; payload: { eventId: string; value: JsonObject } }
  | { type: 'command.request'; payload: { command: 'records.create'; baseRevision: number; entityId: string; record: { id: string; values: Record<string, string | number | boolean> } } }
  | { type: 'result'; payload: { ok: true; committedRevision: number } | { ok: false; code: string } }
  | { type: 'error'; payload: { code: string; message: string } }
)
