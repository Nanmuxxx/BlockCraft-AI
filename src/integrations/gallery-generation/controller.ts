import type { CustomProject } from '../../custom-block'
import type { ProjectAsset } from '../../model/appSpec'
import { createCommandSession, processCommand } from '../../model/appCommands'
import { projectBuiltinChange } from '../../model/appProjectCommands'
import type { WriteAuthorization } from '../custom-block-bc/owner'
import type { WorkspaceSession } from '../project-workspace/session'
import { WorkspaceError } from '../project-workspace/repository'
import { offlineImageProvider, type ImageProvider } from './offline'

export interface ImageCandidate {
  confirmationId: string; digest: string; asset: Readonly<ProjectAsset>; targetId: string
  expected: CustomProject; authorization: WriteAuthorization; prepared: CustomProject
  width: number; height: number; bytes: number
}
export interface GalleryGenerationView {
  phase: 'idle' | 'generating' | 'ready' | 'saving' | 'adopted' | 'failed'
  candidate: Readonly<ImageCandidate> | null; message: string
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('生成已取消或超时；没有自动重试，原作品未更改。'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
async function decodePng(dataUrl: string, signal: AbortSignal) {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), x => x.charCodeAt(0))
  if (bytes.length < 33) throw new Error('候选图片不完整。')
  const view = new DataView(bytes.buffer)
  const width = view.getUint32(16), height = view.getUint32(20)
  if (!width || !height || width * height > 16_777_216) throw new Error('候选图片的像素尺寸超过限制。')
  // Reject animated PNG before decoding; do not rely on a provider's dimensions.
  for (let p = 8; p + 12 <= bytes.length;) {
    const size = view.getUint32(p)
    if (size > bytes.length - p - 12) throw new Error('候选图片结构损坏。')
    const type = String.fromCharCode(...bytes.slice(p + 4, p + 8))
    if (type === 'acTL') throw new Error('离线图库仅接收静态 PNG。')
    p += size + 12
  }
  if (typeof createImageBitmap === 'function') {
    await bounded(createImageBitmap(new Blob([bytes], { type: 'image/png' })).then(bitmap => {
      try { if (bitmap.width !== width || bitmap.height !== height) throw new Error('图片尺寸与解码结果不一致。') }
      finally { bitmap.close() }
    }), signal)
  } else if (typeof Image === 'function') {
    await new Promise<void>((resolve, reject) => {
      const image = new Image()
      const clean = () => { signal.removeEventListener('abort', abort); image.onload = null; image.onerror = null; image.src = '' }
      const abort = () => { clean(); reject(new Error('图片解码已取消。')) }
      image.onload = () => { const valid = image.naturalWidth === width && image.naturalHeight === height; clean(); valid ? resolve() : reject(new Error('候选图片尺寸无效。')) }
      image.onerror = () => { clean(); reject(new Error('候选图片无法解码。')) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort(); else image.src = dataUrl
    })
  } else throw new Error('当前环境没有图片解码能力，不能采用候选。')
  return { width, height, bytes: bytes.length }
}

/** One candidate and one confirmation per controller; the project remains untouched
 * until the workspace transaction commits. The provider never owns project state. */
export function createGalleryImageController(workspace: WorkspaceSession, provider: ImageProvider = offlineImageProvider, timeoutMs = 10_000) {
  const runtime = workspace.runtime, owner = runtime.customProject
  let state: GalleryGenerationView = Object.freeze({ phase: 'idle', candidate: null, message: '' })
  let active: AbortController | null = null, disposed = false, confirming: Promise<void> | null = null
  const listeners = new Set<() => void>()
  const update = (changes: Partial<GalleryGenerationView>) => {
    if (disposed) return
    state = Object.freeze({ ...state, ...changes }); listeners.forEach(listener => listener())
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async generate(prompt: string, targetId: string) {
      if (disposed || active || confirming) return
      if (!prompt.trim() || prompt.length > 500) { update({ phase: 'failed', message: '请输入 1–500 字的图片描述。' }); return }
      const expected = owner.getSnapshot(), authorization = owner.getAuthorization()
      const gallery = expected.base.spec.blocks.find(b => b.id === targetId && b.type === 'gallery')
      if (!gallery || !workspace.isCurrent(expected, authorization)) { update({ phase: 'failed', message: '请先选择可编辑图库。' }); return }
      const controller = new AbortController(); active = controller
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      update({ phase: 'generating', candidate: null, message: '正在生成离线示例，不调用 AI 模型…' })
      try {
        const dataUrl = await bounded(provider.generate(prompt.trim(), controller.signal), controller.signal)
        controller.signal.throwIfAborted()
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 699100) throw new Error('候选必须是限额内的静态 PNG。')
        const asset: ProjectAsset = { id: `image-${crypto.randomUUID()}`, name: '离线插图.png', altText: '离线练习风景图', mimeType: 'image/png', dataUrl }
        const commands = [{ type: 'addProjectAsset' as const, asset }, { type: 'configureGallery' as const, blockId: targetId,
          imageIds: [...(gallery as Extract<typeof gallery, { type: 'gallery' }>).imageIds, asset.id] }]
        const requestId = `confirm-${crypto.randomUUID()}`
        const result = processCommand(createCommandSession({ revision: expected.revision, ...expected.base }), { requestId, baseRevision: expected.revision, commands })
        if (!result.ok) throw new Error(`候选未通过项目容量或引用校验：${result.error.message}`)
        const prepared = projectBuiltinChange(expected, result.session.state, commands)
        const dimensions = await decodePng(dataUrl, controller.signal)
        const input = JSON.stringify({ workspaceId: workspace.workspaceId, targetId, prepared })
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))].map(x => x.toString(16).padStart(2, '0')).join('')
        controller.signal.throwIfAborted()
        if (!workspace.isCurrent(expected, authorization)) throw new Error('生成期间作品或权限已变化，请重新预览。')
        const candidate = freeze({ confirmationId: requestId, digest, asset, targetId, expected, authorization, prepared, ...dimensions })
        update({ phase: 'ready', candidate, message: '预览尚未加入作品。确认后采用这一张图片并保存到本机。' })
      } catch (error) {
        if (active === controller) update({ phase: 'failed', candidate: null, message: error instanceof Error ? error.message : '离线生成失败，原作品未更改。' })
      } finally { clearTimeout(timer); if (active === controller) active = null }
    },
    confirm(): Promise<void> {
      if (confirming) return confirming
      const candidate = state.candidate
      if (disposed || !candidate) return Promise.resolve()
      if (workspace.getSnapshot().recovery) {
        update({ phase: 'failed', message: workspace.getSnapshot().error })
        return Promise.resolve()
      }
      confirming = (async () => {
        update({ phase: 'saving', message: '正在校验、采用并保存…' })
        try {
          const prior = await workspace.receipt(candidate.confirmationId, candidate.digest)
          if (prior) { update({ phase: 'adopted', message: '这张图片已采用并保存，不会重复添加。' }); return }
          if (disposed || !workspace.isCurrent(candidate.expected, candidate.authorization)) throw new WorkspaceError('CONTEXT_CHANGED', '作品、图库或权限已变化，请重新生成预览。')
          await workspace.adopt(candidate.prepared, candidate.expected, candidate.authorization, {
            confirmationId: candidate.confirmationId, digest: candidate.digest, assetId: candidate.asset.id, revision: candidate.prepared.revision,
          })
          update({ phase: 'adopted', message: '已采用并保存到本机。可切换到 C 模式查看，或下载项目 ZIP 后恢复。' })
        } catch (error) { update({ phase: 'failed', message: workspace.getSnapshot().recovery ? workspace.getSnapshot().error
          : error instanceof Error ? error.message : '采用失败，请检查本机保存状态。' }) }
        finally { confirming = null }
      })()
      return confirming
    },
    cancel() {
      if (confirming) return
      active?.abort(); active = null
      update({ phase: 'idle', candidate: null, message: '已取消；原作品未更改，没有模型调用或费用。' })
    },
    dispose() { disposed = true; active?.abort(); active = null; listeners.clear() },
  }
}
