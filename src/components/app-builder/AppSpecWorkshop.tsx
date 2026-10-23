import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowLeft, Blocks, Monitor, Undo2 } from 'lucide-react'
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
import { ProjectJsonControls } from '../../integrations/project-json/ProjectJsonControls'
import type { RestoredProject } from '../../integrations/project-json/format'
import { createMochiHost, type HostView } from '../../integrations/mochi/host'
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

function RunFormSelector({ blocks, selectedBlockId, onSelect }: {
  blocks: HostView['context']['blocks']
  selectedBlockId: string | null
  onSelect: (id: string) => void
}) {
  const forms = blocks.filter(block => block.type === 'form')
  if (!forms.length) return null
  const selectedFormId = forms.some(block => block.id === selectedBlockId) ? selectedBlockId! : ''
  return <div className="app-spec-workshop__run-target" aria-label="Mochi 修改目标">
    <label htmlFor="mochi-run-form">Mochi 修改目标</label>
    <select id="mochi-run-form" value={selectedFormId} onChange={event => onSelect(event.currentTarget.value)}>
      <option value="" disabled>选择要修改的表单</option>
      {forms.map(form => <option key={form.id} value={form.id}>{form.name}</option>)}
    </select>
  </div>
}

export function AppSpecWorkshop({ runtime, renderMochi, installation, onImportProject }: { runtime: AppRuntime; onImportProject?: (restored: RestoredProject) => void | Promise<void> } & WorkshopPanelMount) {
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
  return <MochiWorkshop runtime={runtime} host={owner.host} installation={installation} renderMochi={renderMochi} planningDisabledReason={planningDisabledReason} onImportProject={onImportProject} />
}

/** Internal composition seam for offline integration tests; production uses the wrapper above. */
export function MochiWorkshop({ runtime, host, planningDisabledReason, renderMochi, installation: suppliedInstallation, onImportProject }: {
  runtime: AppRuntime; host: MochiHost; planningDisabledReason?: string; onImportProject?: (restored: RestoredProject) => void | Promise<void>
} & WorkshopPanelMount) {
  const root = useRef<HTMLElement>(null)
  const installation = useMemo(() => suppliedInstallation ?? createGeneratedArtifactUI(runtime.customProject), [runtime, suppliedInstallation])
  useInstallLifecycle(installation)
  const [installGateError, setInstallGateError] = useState('')
  const [undoError, setUndoError] = useState('')
  const undo = () => {
    try {
      installation.beforeContextChange()
      const result = runtime.executeCommand({
        requestId: `workshop-undo-${crypto.randomUUID()}`,
        baseRevision: runtime.getSnapshot().revision,
        commands: [{ type: 'undo' }],
      })
      setUndoError(result.ok ? '' : result.error.message)
    } catch (error) { setUndoError(error instanceof Error ? error.message : '暂不可撤销，请稍后重试。') }
  }
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
    try {
      if (next !== mode) installation.beforeContextChange()
      if (next === 'run' && !view.context.blocks.some(block => block.id === selectedId && block.type === 'form')) {
        const firstForm = view.context.blocks.find(block => block.type === 'form')
        host.setSelection(firstForm?.id ?? null)
      }
      host.setMode(next)
      setInstallGateError('')
    }
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
      <div className="workshop__project-actions">{onImportProject && <ProjectJsonControls owner={runtime.customProject} onImportProject={onImportProject} />}<ExportProjectButton owner={runtime.customProject} /></div>
    </header>
    <div className="workshop__body">
      <nav className="workshop__nav" aria-label="工坊导航">
        <a href="/"><ArrowLeft size={21} aria-hidden="true" /><span>首页</span></a><div className="workshop__nav-divider" />
        <button type="button" aria-pressed={mode === 'blocks'} onClick={() => setMode('blocks')}><Blocks size={23} aria-hidden="true" /><span>积木</span></button>
        <button type="button" aria-pressed={mode === 'run'} onClick={() => setMode('run')}><Monitor size={23} aria-hidden="true" /><span>预览</span></button>
      </nav>
      <div className="workshop__workspace">
        <div className="workshop__canvas-header"><div><p className="workshop__eyebrow">{mode === 'blocks' ? 'BUILD WITH BLOCKS' : 'A GLIMPSE OF YOUR APP'}</p><h2>{mode === 'blocks' ? '从一块积木开始' : '让想法有个模样'}</h2><p>{mode === 'blocks' ? '每一块，都是软件的一种可能。' : `这里是「${snapshot.spec.name}」的预览空间。`}</p></div><span className="workshop__badge">{project.renderOrder.length} 块功能积木</span></div>
        <div className="workshop__blocks-layer" id="generated-blocks" hidden={mode !== 'blocks'}>{installGateError && <p role="alert">{installGateError}</p>}<div className="block-canvas-toolbar"><button type="button" disabled={!runtime.canUndo() || runtime.customProject.getAuthorization().readOnly} onClick={undo}><Undo2 size={14} aria-hidden="true" />撤销结构修改</button></div>{undoError && <p role="alert">{undoError}</p>}<CustomBlockImport owner={runtime.customProject} generated={installation} />{adapter ? <CustomBlockCanvas adapter={adapter} selectedId={selected} onSelect={setSelectedId} /> : admission}</div>
        <div className="workshop__preview-stage" id="generated-preview" hidden={mode !== 'run'}><div className="study-app"><header className="study-app__topbar"><div className="study-app__brand"><span><Blocks size={18} aria-hidden="true" /></span><strong>{snapshot.spec.name}</strong><small>YOUR APP</small></div></header><div className="app-spec-preview-content">{adapter ? <CustomBlockRunSurface adapter={adapter} renderBuiltin={block => <BuiltinBlockRenderer runtime={runtime} blockId={block.id} />} /> : admission}</div></div></div>
        <footer className="workshop__canvas-footer"><span className="pixel-dot" aria-hidden="true" />把想法，一块块搭成现实<span>{mode === 'blocks' ? 'B / 功能积木' : 'C / 应用预览'}</span></footer>
      </div>
      <aside className="app-spec-workshop__sidebar" aria-label="创作助手与积木属性">{mode === 'run' && <RunFormSelector blocks={view.context.blocks} selectedBlockId={selectedId} onSelect={host.setSelection} />}<div data-workshop-panel="mochi">{renderMochi ? renderMochi(mochiProps) : <WorkshopMochi key={view.context.instanceId} {...mochiProps} />}</div><div hidden={mode !== 'blocks'}><MochiConversationPanel host={host} customContext={customContext} planningDisabledReason={planningDisabledReason} />{customSelected ? adapter ? <CustomBlockInspector adapter={adapter} instanceId={selected} /> : admission : <AppSpecInspector key={selected ?? 'empty'} runtime={runtime} snapshot={snapshot} blockId={selected} />}</div></aside>
    </div>
  </section>
}
