import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AppRuntime } from '../../model/appRuntime'
import { createCustomBlockBCAdapter, type CustomBlockBCAdapter } from './adapter'

/** Metadata admission is keyed by exact references, not by mount or mode.
 * Never show the previous adapter while a new definition/version is admitting.
 */
export function useWorkshopAdapter(runtime: AppRuntime) {
  const owner = runtime.customProject
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot)
  const signature = JSON.stringify([...new Set(snapshot.custom.instances.map(instance => `${instance.definitionId}/${instance.versionDigest}`))].sort())
  const [ready, setReady] = useState<{ owner: typeof owner; signature: string; adapter: CustomBlockBCAdapter } | null>(null)
  const [failure, setFailure] = useState<{ owner: typeof owner; signature: string; revision: number; message: string } | null>(null)
  const admitted = ready?.owner === owner && ready.signature === signature
  useEffect(() => {
    if (admitted) return
    let active = true
    void createCustomBlockBCAdapter(owner, owner.registry).then(adapter => {
      if (active) { setReady({ owner, signature, adapter }); setFailure(null) }
    }, error => {
      if (active) setFailure({ owner, signature, revision: snapshot.revision, message: error instanceof Error ? error.message : '元数据准入失败。' })
    })
    return () => { active = false }
  }, [owner, signature, snapshot.revision, admitted])
  return {
    adapter: admitted ? ready.adapter : null,
    error: !admitted && failure?.owner === owner && failure.signature === signature && failure.revision === snapshot.revision ? failure.message : '',
    snapshot,
  }
}
