import { useState, useSyncExternalStore } from 'react'
import { BlockCanvas, toAppCanvasModules } from '../BlockCanvas'
import type { AppRuntime } from '../../model/appRuntime'
import './app-spec-canvas.css'

interface AppSpecCanvasProps {
  runtime: AppRuntime
}

/** Layout and business data always come from the shared runtime snapshot. */
export function AppSpecCanvas({ runtime }: AppSpecCanvasProps) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [moveError, setMoveError] = useState('')
  const selectedModuleId = snapshot.spec.blocks.some(block => block.id === selectedId) ? selectedId : null

  return <div className={`app-spec-canvas${moveError ? ' has-move-error' : ''}`} onPointerDownCapture={() => setMoveError('')}>
    <BlockCanvas<string>
      modules={toAppCanvasModules(snapshot)}
      positions={snapshot.blockPositions}
      selectedModuleId={selectedModuleId}
      onSelectModule={setSelectedId}
      onMoveModule={(blockId, position) => {
        const result = runtime.moveBlock(blockId, position)
        setMoveError(result.ok ? '' : result.error.message)
      }}
    />
    {moveError && <p className="app-spec-canvas__error" role="alert">{moveError}</p>}
  </div>
}
