import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowLeft, Blocks, Monitor } from 'lucide-react'
import type { AppRuntime } from '../../model/appRuntime'
import { Logo } from '../Logo'
import { BuiltinBlockRenderer } from '../app-renderer/AppRenderer'
import { CustomBlockCanvas } from '../../integrations/custom-block-bc/CustomBlockCanvas'
import { CustomBlockInspector } from '../../integrations/custom-block-bc/CustomBlockInspector'
import { CustomBlockRunSurface } from '../../integrations/custom-block-bc/CustomBlockViewer'
import { CustomBlockImport } from '../../integrations/custom-block-bc/CustomBlockImport'
import { createGeneratedArtifactUI, type GeneratedArtifactUI } from '../../integrations/generated-artifact/ui'
import { useInstallLifecycle } from '../../integrations/generated-artifact/useInstallLifecycle'
import { useWorkshopAdapter } from '../../integrations/custom-block-bc/useWorkshopAdapter'
import { AppSpecInspector } from './AppSpecInspector'
import { ExportProjectButton } from '../../integrations/project-export/ExportProjectButton'
import { createMochiHost } from '../../integrations/mochi/host'
import { createHttpPlanProvider, fieldPlanningStatus } from '../../integrations/mochi/httpPlanProvider'
import { WorkshopMochi, type MochiHost, type WorkshopMochiProps } from '../../integrations/mochi/WorkshopMochi'
import { MochiConversationPanel } from '../../integrations/mochi-ai/MochiConversationPanel'
import '../workshop.css'
import './app-spec-workshop.css'

/** The caller owns one runtime per generated application, never per mode. */
export interface WorkshopPanelMount {
  /** One panel in the existing sidebar; host lifetime and owner stay in Workshop. */
  renderMochi?: (props: WorkshopMochiProps) => ReactNode
  /** Parent must synchronously gate runtime replacement using this same binding. */
  installation?: GeneratedArtifactUI
}

export function AppSpecWorkshop({ runtime, renderMochi, installation }: { runtime: AppRuntime } & WorkshopPanelMount) {
  const [owner, setOwner] = useState<{ runtime: AppRuntime; host: MochiHost } | null>(null)
  const [planningDisabledReason, setPlanningDisabledReason] = useState<string | undefined>('正在检查字段计划服务…')
  useEffect(() => {
    // Acquire only after commit. StrictMode cleanup disposes this instance; replay
    // acquires a new live one. B/C never acquires another host or Runtime.
    const host = createMochiHost(runtime, createHttpPlanProvider())
    const controller = new AbortController()
    setPlanningDisabledReason('正在检查字段计划服务…')
    void fieldPlanningStatus(controller.signal).then(enabled => {
      if (!controller.signal.aborted) setPlanningDisabledReason(enabled ? undefined : '字段计划服务尚未启用，请启动已授权的本地 DeepSeek 服务。')
    }).catch(() => { if (!controller.signal.aborted) setPlanningDisabledReason('字段计划服务不可用，请检查本地服务后重新打开项目。') })
    setOwner({ runtime, host })
    return () => { controller.abort(); host.dispose() }
  }, [runtime])
  if (!owner || owner.runtime !== runtime) return null
  return <MochiWorkshop runtime={runtime} host={owner.host} installation={installation} renderMochi={renderMochi} planningDisabledReason={planningDisabledReason} />
}

/** Internal composition seam for offline integration tests; production uses the wrapper above. */
export function MochiWorkshop({ runtime, host, planningDisabledReason, renderMochi, installation: suppliedInstallation }: {
  runtime: AppRuntime; host: MochiHost; planningDisabledReason?: string
} & WorkshopPanelMount) {
  const root = useRef<HTMLElement>(null)
  const installation = useMemo(() => suppliedInstallation ?? createGeneratedArtifactUI(runtime.customProject), [runtime, suppliedInstallation])
  useInstallLifecycle(installation)
  const [installGateError, setInstallGateError] = useState('')
  // Only exact admitted references and the existing owner's immutable registry.
  // No new Host, Runtime, owner or plan authority is created for advice.
  const customContext = useMemo(() => ({
    readReferences: () => runtime.customProject.getSnapshot().custom.instances.map(({ id, definitionId, versionDigest }) => ({ id, definitionId, versionDigest })),
    registry: runtime.customProject.registry,
  }), [runtime])
  const view = useSyncExternalStore(host.subscribe, host.getSnapshot, host.getSnapshot)
  const mode = view.mode
  const selectedId = view.context.selectedBlockId
  const setMode = (next: typeof mode) => {
    try { if (next !== mode) installation.beforeContextChange(); host.setMode(next); setInstallGateError('') }
    catch (error) { setInstallGateError(error instanceof Error ? error.message : '暂不可切换模式。') }
  }
  const setSelectedId = host.setSelection
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const { adapter, error, snapshot: project } = useWorkshopAdapter(runtime)
  const selected = project.renderOrder.some(item => item.id === selectedId) ? selectedId : null
  const customSelected = project.custom.instances.some(instance => instance.id === selected)
  const admission = <p role={error ? 'alert' : 'status'}>{error || '正在校验积木版本元数据…'}</p>
  const mochiProps: WorkshopMochiProps = { host, view, root, canvasReady: !!adapter, planningDisabledReason }
  return <section ref={root} className="workshop app-spec-workshop" aria-label="生成的应用">
    <header className="workshop__topbar"><Logo />
      <div className="workshop__project"><span className="workshop__project-icon"><Blocks size={20} aria-hidden="true" /></span><div><h1>{snapshot.spec.name}</h1><span>Workshop · 创作工坊</span></div></div>
      <div className="workshop__modes" role="group" aria-label="工作模式">
        <button type="button" aria-label="B 模式 · 编辑积木" aria-pressed={mode === 'blocks'} aria-controls="generated-blocks" onClick={() => setMode('blocks')}><span>B</span> 功能积木</button>
        <button type="button" aria-label="C 模式 · 运行应用" aria-pressed={mode === 'run'} aria-controls="generated-preview" onClick={() => setMode('run')}><span>C</span> 应用预览</button>
      </div>
      <ExportProjectButton owner={runtime.customProject} />
    </header>
    <div className="workshop__body">
      <nav className="workshop__nav" aria-label="工坊导航">
        <a href="/"><ArrowLeft size={21} aria-hidden="true" /><span>首页</span></a><div className="workshop__nav-divider" />
        <button type="button" aria-pressed={mode === 'blocks'} onClick={() => setMode('blocks')}><Blocks size={23} aria-hidden="true" /><span>积木</span></button>
        <button type="button" aria-pressed={mode === 'run'} onClick={() => setMode('run')}><Monitor size={23} aria-hidden="true" /><span>预览</span></button>
      </nav>
      <div className="workshop__workspace">
        <div className="workshop__canvas-header"><div><p className="workshop__eyebrow">{mode === 'blocks' ? 'BUILD WITH BLOCKS' : 'A GLIMPSE OF YOUR APP'}</p><h2>{mode === 'blocks' ? '从一块积木开始' : '让想法有个模样'}</h2><p>{mode === 'blocks' ? '每一块，都是软件的一种可能。' : `这里是「${snapshot.spec.name}」的预览空间。`}</p></div><span className="workshop__badge">{project.renderOrder.length} 块功能积木</span></div>
        <div className="workshop__blocks-layer" id="generated-blocks" hidden={mode !== 'blocks'}>{installGateError && <p role="alert">{installGateError}</p>}<CustomBlockImport owner={runtime.customProject} generated={installation} />{adapter ? <CustomBlockCanvas adapter={adapter} selectedId={selected} onSelect={setSelectedId} /> : admission}</div>
        <div className="workshop__preview-stage" id="generated-preview" hidden={mode !== 'run'}><div className="study-app"><header className="study-app__topbar"><div className="study-app__brand"><span><Blocks size={18} aria-hidden="true" /></span><strong>{snapshot.spec.name}</strong><small>YOUR APP</small></div></header><div className="app-spec-preview-content">{adapter ? <CustomBlockRunSurface adapter={adapter} renderBuiltin={block => <BuiltinBlockRenderer runtime={runtime} blockId={block.id} />} /> : admission}</div></div></div>
        <footer className="workshop__canvas-footer"><span className="pixel-dot" aria-hidden="true" />把想法，一块块搭成现实<span>{mode === 'blocks' ? 'B / 功能积木' : 'C / 应用预览'}</span></footer>
      </div>
      <aside className="app-spec-workshop__sidebar" aria-label="创作助手与积木属性"><div data-workshop-panel="mochi">{renderMochi ? renderMochi(mochiProps) : <WorkshopMochi key={view.context.instanceId} {...mochiProps} />}</div><div hidden={mode !== 'blocks'}><MochiConversationPanel host={host} customContext={customContext} />{customSelected ? adapter ? <CustomBlockInspector adapter={adapter} instanceId={selected} /> : admission : <AppSpecInspector key={selected ?? 'empty'} runtime={runtime} snapshot={snapshot} blockId={selected} />}</div></aside>
    </div>
  </section>
}
