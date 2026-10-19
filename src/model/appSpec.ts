/** JSON-only protocol, independent of the legacy learning demo. IDs are caller supplied. */
export type FieldSpec = {
  id: string
  name: string
  required: boolean
} & ({ type: 'text' | 'number' | 'boolean' | 'date' } | { type: 'select'; options: string[] })

export interface EntitySpec { id: string; name: string; fields: FieldSpec[] }
export interface BlockPresentation {
  buttonText?: string
  backgroundColor?: string
  textColor?: string
  borderRadius?: number
}
export type BlockSpec = { id: string; name: string; presentation?: BlockPresentation } & (
  | { type: 'list' | 'form'; fieldIds: string[] }
  | { type: 'pomodoro'; protocolVersion: 1; durationSeconds: number }
  | { type: 'metric'; aggregation: 'count' }
  | { type: 'metric'; aggregation: 'sum' | 'average'; fieldId: string }
)
/** Exactly one data binding per block. Several blocks may bind the same entity. */
export interface RelationSpec { id: string; type: 'dataBinding'; blockId: string; entityId: string }
export interface AppSpec { version: 1 | 2; id: string; name: string; entities: EntitySpec[]; blocks: BlockSpec[]; relations: RelationSpec[] }
export type FieldValue = string | number | boolean
export interface EntityRecord { id: string; values: Record<string, FieldValue> }
export interface TimerState { remainingMs: number; startedAt: number | null }
export interface ProjectState {
  /** v2 only; authoritative interaction state, not React local state. */
  timers?: Record<string, TimerState>
  revision: number
  spec: AppSpec
  records: Record<string, EntityRecord[]>
  blockPositions: Record<string, { x: number; y: number }>
}
export type AppCommand =
  | { type: 'configureBlockPresentation'; blockId: string; presentation: BlockPresentation }
  | { type: 'addBlock'; block: BlockSpec; binding: RelationSpec; position?: { x: number; y: number } }
  | { type: 'removeBlock'; blockId: string }
  | { type: 'addField'; entityId: string; field: FieldSpec }
  | { type: 'updateField'; entityId: string; fieldId: string; field: FieldSpec }
  | { type: 'removeField'; entityId: string; fieldId: string }
  | { type: 'configureBlockFields'; blockId: string; fieldIds: string[] }
  | { type: 'undo' }
export interface CommandRequest { requestId: string; baseRevision: number; commands: AppCommand[] }
