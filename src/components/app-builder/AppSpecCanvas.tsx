import { useState, useSyncExternalStore } from 'react'
import { BlockCanvas, toAppCanvasModules } from '../BlockCanvas'
import type { AppRuntime } from '../../model/appRuntime'
import { AppSpecInspector } from './AppSpecInspector'
import './app-spec-canvas.css'

interface AppSpecCanvasProps {
  runtime: AppRuntime
  selectedBlockId?: string | null
  onSelectBlock?: (id: string) => void
  externalInspector?: boolean
}

/** Layout and business data always come from the shared runtime snapshot. */
export function AppSpecCanvas({ runtime, selectedBlockId, onSelectBlock, externalInspector = false }: AppSpecCanvasProps) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [moveError, setMoveError] = useState('')
  const selection = selectedBlockId === undefined ? selectedId : selectedBlockId
  const selectedModuleId = snapshot.spec.blocks.some(block => block.id === selection) ? selection : null

  return <div className={`app-spec-canvas${externalInspector ? ' app-spec-canvas--embedded' : ''}${moveError ? ' has-move-error' : ''}`} onPointerDownCapture={() => setMoveError('')}>
    <BlockCanvas<string>
      modules={toAppCanvasModules(snapshot)}
      positions={snapshot.blockPositions}
      selectedModuleId={selectedModuleId}
      onSelectModule={onSelectBlock ?? setSelectedId}
      onMoveModule={(blockId, position) => {
        const result = runtime.moveBlock(blockId, position)
        setMoveError(result.ok ? '' : result.error.message)
      }}
    />
    {moveError && <p className="app-spec-canvas__error" role="alert">{moveError}</p>}
    {!externalInspector && <AppSpecInspector key={selectedModuleId ?? 'empty'} runtime={runtime} snapshot={snapshot} blockId={selectedModuleId} />}
  </div>
}
