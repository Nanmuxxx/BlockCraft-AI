import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WorkspaceSession } from '../project-workspace/session'
import { createGalleryImageController } from './controller'
import { offlineImageProvider } from './offline'
import { mockImageProvider } from './mock'
import './gallery-generation.css'

export function GalleryImagePanel({ workspace }: { workspace: WorkspaceSession }) {
  const [source, setSource] = useState<'OFFLINE_CANVAS' | 'MOCK'>('OFFLINE_CANVAS')
  const [prompt, setPrompt] = useState('清晨的山与太阳')
  const [target, setTarget] = useState('')
  const [binding, setBinding] = useState<{ workspace: WorkspaceSession; source: typeof source; controller: ReturnType<typeof createGalleryImageController> } | null>(null)
  useEffect(() => {
    const controller = createGalleryImageController(workspace, source === 'MOCK' ? mockImageProvider : offlineImageProvider, 10_000, source)
    setBinding({ workspace, source, controller })
    return () => controller.dispose()
  }, [workspace, source])
  return binding?.workspace === workspace && binding.source === source ? <ImagePanel workspace={workspace} controller={binding.controller} source={source} setSource={setSource} prompt={prompt} setPrompt={setPrompt} target={target} setTarget={setTarget} /> : null
}
function ImagePanel({ workspace, controller, source, setSource, prompt, setPrompt, target, setTarget }: { workspace: WorkspaceSession; controller: ReturnType<typeof createGalleryImageController>; source: 'OFFLINE_CANVAS' | 'MOCK'; setSource: (source: 'OFFLINE_CANVAS' | 'MOCK') => void; prompt: string; setPrompt: (prompt: string) => void; target: string; setTarget: (target: string) => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const saved = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
  const snapshot = useSyncExternalStore(workspace.runtime.subscribe, workspace.runtime.getSnapshot)
  const galleries = snapshot.spec.blocks.filter(b => b.type === 'gallery')
  const selected = galleries.some(b => b.id === target) ? target : galleries[0]?.id ?? ''
  const unavailable = saved.busy || saved.recovery || workspace.runtime.customProject.getAuthorization().readOnly
  const busy = state.phase === 'generating' || state.phase === 'saving'
  const [error, setError] = useState('')
  function addGallery() {
    const result = workspace.runtime.executeCommand({ requestId: `gallery-${crypto.randomUUID()}`, baseRevision: snapshot.revision,
      commands: [{ type: 'addBlock', block: { id: `gallery-${crypto.randomUUID()}`, type: 'gallery', name: '我的图片', protocolVersion: 1, imageIds: [], layout: 'grid', interaction: 'preview' } }] })
    setError(result.ok ? '' : result.error.message)
  }
  return <section className="gallery-generation" aria-label="图库单张生成">
    <div><h3>为图库创作一张图片</h3><p>{source === 'MOCK' ? 'MOCK 测试：每次返回同一张固定图片，与描述无关；不调用模型、不产生费用。' : '离线练习：按描述生成配色风景示例，不调用 AI 模型，不产生费用。'}</p></div>
    <label>图片生成方式<select aria-label="图片生成方式" value={source} disabled={busy || unavailable} onChange={event => { controller.cancel(); setSource(event.target.value as typeof source) }}>
      <option value="OFFLINE_CANVAS">离线配色风景示例</option><option value="MOCK">固定 Mock 图片（非 AI）</option>
    </select></label>
    {!galleries.length ? <button type="button" onClick={addGallery} disabled={unavailable}>添加图库</button> : <>
      <label>目标图库<select aria-label="图片目标图库" value={selected} disabled={busy || unavailable} onChange={event => { controller.cancel(); setTarget(event.target.value) }}>
        {galleries.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select></label>
      <label>图片描述<textarea aria-label="图片描述" maxLength={500} value={prompt} disabled={busy || unavailable} onChange={event => setPrompt(event.target.value)} /></label>
      <div className="gallery-generation__actions">
        <button type="button" disabled={busy || unavailable || !prompt.trim()} onClick={() => void controller.generate(prompt, selected)}>{source === 'MOCK' ? '生成一张 Mock 测试图片' : '生成一张离线示例'}</button>
        {state.phase === 'generating' && <button type="button" onClick={controller.cancel}>取消生成图片</button>}
      </div>
      {state.candidate && <figure>
        <img src={state.candidate.asset.dataUrl} alt={source === 'MOCK' ? '待采用的 Mock 图片预览' : '待采用的离线图片预览'} width={state.candidate.width} height={state.candidate.height} />
        <figcaption>{state.candidate.width} × {state.candidate.height} · {(state.candidate.bytes / 1024).toFixed(1)} KiB · {state.phase === 'adopted' ? '已采用' : '预览尚未加入作品'}</figcaption>
        {state.phase !== 'adopted' && <div className="gallery-generation__actions">
          <button type="button" disabled={unavailable || busy} onClick={() => void controller.confirm()}>确认采用并保存</button>
          <button type="button" disabled={busy} onClick={controller.cancel}>放弃预览</button>
        </div>}
      </figure>}
    </>}
    <p role={state.phase === 'failed' || error ? 'alert' : 'status'} aria-live="polite">{error || state.message}</p>
  </section>
}
