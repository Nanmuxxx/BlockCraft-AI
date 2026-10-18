import { useSyncExternalStore, type ReactNode } from 'react'
import type { BlockSpec } from '../../model/appSpec'
import type { CustomBlockInstance, CustomProject } from '../../custom-block'
import type { CustomBlockBCAdapter } from './adapter'
import { viewerState } from './viewer'
import './custom-block-bc.css'

/** Trusted placeholder only. No iframe/srcdoc, source URL, dynamic module or
 * generated React component slot exists until Agent B's interface is reviewed.
 */
export function CustomBlockViewer({ instance, name, observation }: {
  instance: CustomBlockInstance; name: string; observation?: unknown
}) {
  const state = viewerState(instance, observation)
  return <section className="custom-block-bc custom-block-bc__viewer" aria-label={name} data-instance-id={instance.id} data-definition-id={state.reference.definitionId} data-version-digest={state.reference.versionDigest} data-viewer-status={state.status}>
    <header><h2>{name}</h2><span className="custom-block-bc__badge">自定义积木</span></header>
    <div role="status"><strong>{state.label}</strong><p>{state.message}</p></div>
  </section>
}

/** renderBuiltin must render ONE trusted builtin using the same owner's v1
 * facade. Passing the current whole AppRenderer would duplicate all blocks.
 */
export function CustomBlockRunSurface({ adapter, renderBuiltin, observationFor }: {
  adapter: CustomBlockBCAdapter
  renderBuiltin: (block: BlockSpec, snapshot: CustomProject) => ReactNode
  observationFor?: (instance: CustomBlockInstance) => unknown
}) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot)
  return <div className="custom-block-bc custom-block-bc__run">{adapter.orderedBlocks(snapshot).map(item => <div key={`${item.kind}:${item.id}`} data-render-key={`${item.kind}:${item.id}`}>
    {item.kind === 'builtin' ? renderBuiltin(item.block, snapshot) : <CustomBlockViewer instance={item.instance} name={item.manifest?.name ?? '自定义积木'} observation={observationFor?.(item.instance)} />}
  </div>)}</div>
}
