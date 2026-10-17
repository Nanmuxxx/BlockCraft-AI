import type { LucideIcon } from 'lucide-react'
import type { BlockPosition, ModuleId } from '../../model/appConfig'

/** Feature kind describes behavior; instance IDs may be any stable string. */
export interface BlockModuleData<Id extends string = ModuleId> {
  id: Id
  kind?: ModuleId
  name: string
  description?: string
  detail?: string
  tone?: 'sage' | 'blue' | 'apricot'
  icon?: LucideIcon
  settings?: { showCompleted?: boolean }
}

export type RecipeId = 'course-tasks' | 'task-stats'
export interface BlockRelation<Id extends string = string> {
  id: string
  recipe: RecipeId
  sourceId: Id
  targetId: Id
}

/** Intent only. The host validates and persists each command atomically. */
export type BlockEdit<Id extends string = string> =
  | { type: 'add'; kind: ModuleId }
  | { type: 'remove'; moduleId: Id }
  | { type: 'configure'; moduleId: Id; name: string; settings?: { showCompleted: boolean } }
  | { type: 'combine'; recipe: RecipeId; sourceId: Id; targetId: Id }
  | { type: 'disconnect'; relationId: string }

export interface BlockBuilderBindings<Id extends string = string> {
  /** Advertise only behavior actually implemented by the connected preview. */
  availableFeatures: readonly ModuleId[]
  availableRecipes: readonly RecipeId[]
  relations: readonly BlockRelation<Id>[]
  unsupportedRequirements?: readonly string[]
  onEdit: (edit: BlockEdit<Id>) => void
  onUndo: () => void
  canUndo: boolean
  /** Supply after a command is persisted, or when it fails. */
  feedback?: string
}

export interface BlockCanvasProps<Id extends string = ModuleId> {
  modules: readonly BlockModuleData<Id>[]
  positions: Readonly<Partial<Record<Id, BlockPosition>>>
  selectedModuleId: Id | null
  onSelectModule: (moduleId: Id) => void
  onMoveModule: (moduleId: Id, position: BlockPosition) => void
  builder?: BlockBuilderBindings<Id>
  /** Layout-only examples; no functional IDs or AppConfig changes required. */
  examples?: readonly VisualExample[]
}

export interface VisualExample {
  id: string
  name: string
  description: string
  icon: LucideIcon
  tone: 'sage' | 'blue' | 'apricot'
}
