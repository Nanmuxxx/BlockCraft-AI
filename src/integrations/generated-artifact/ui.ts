import type { CustomProjectSession } from '../../model/customProjectSession'
import { assertJson, check, cloneJson, keys, object } from '../../custom-block/json'
import { createGeneratedArtifactInstaller, type GeneratedInstallPreview } from './install'

type Candidate = { name: string; definitionId: string; versionDigest: string; props: unknown; source: string }
export type InstallUIState = Readonly<{
  phase: 'idle' | 'reading' | 'loaded' | 'preparing' | 'preview' | 'confirming' | 'installed' | 'error'
  candidate?: Candidate; preview?: GeneratedInstallPreview; message: string
}>

/** UI drafts only. Every project write remains in #34 installer.confirm/session.install.
 * The parent MUST call beforeContextChange/dispose before its setter or unmount.
 * Construction is side-effect free, including React StrictMode render replay.
 */
export function createGeneratedArtifactUI(session: CustomProjectSession) {
  let installer: ReturnType<typeof createGeneratedArtifactInstaller> | undefined
  let unsubscribe: (() => void) | undefined
  let epoch = 0, closed = false
  let pendingRead: { cancel(): void } | undefined
  const retireRead = () => { const pending = pendingRead; pendingRead = undefined; pending?.cancel() }
  let captured: { snapshot: ReturnType<typeof session.getSnapshot>; authorization: ReturnType<typeof session.getAuthorization>; input: unknown } | undefined
  let state: InstallUIState = { phase: 'idle', message: '' }
  const listeners = new Set<() => void>()
  const publish = (next: InstallUIState) => { state = Object.freeze(next); listeners.forEach(fn => fn()) }
  const fail = (error: unknown) => publish({ phase: 'error', message: error instanceof Error ? error.message : '制品处理失败。' })
  const unlocked = () => check(state.phase !== 'confirming', 'CONFIRM_BUSY：正在确认添加，请稍后再切换或离开。', 'CONFIRM_BUSY')
  const alive = () => check(!closed, '安装界面已关闭，请重新载入。', 'INSTALLER_DISPOSED')
  function invalidate(message = '') {
    unlocked(); installer?.invalidate(); epoch++; captured = undefined; retireRead()
    const generation = epoch
    publish({ phase: 'idle', message })
    return generation
  }
  function ensureInstaller() {
    if (!installer) {
      installer = createGeneratedArtifactInstaller(session)
      unsubscribe = session.subscribe(() => {
        if (state.phase === 'confirming') return // install's own CAS notification; confirm decides its result.
        epoch++; captured = undefined; retireRead()
        if (state.phase !== 'idle' && state.phase !== 'installed') publish({ phase: 'error', message: '项目或授权已变化，请重新选择制品并预览。' })
      })
    }
    return installer
  }
  function current(generation: number) {
    alive()
    check(generation === epoch && captured, '项目或请求已变化，请重新选择制品。', 'CONTEXT_CHANGED')
    check(captured.snapshot === session.getSnapshot(), '项目版本已变化，请重新预览。', 'REVISION_CONFLICT')
    check(captured.authorization === session.getAuthorization() && !session.getAuthorization().readOnly, '写入授权已变化。', 'AUTHORIZATION_CHANGED')
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    /** No source, filename or provenance is an authorization credential. */
    async readFile(file: { size: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer> }) {
      alive(); const generation = invalidate(); ensureInstaller()
      if (generation !== epoch || closed) return
      captured = { snapshot: session.getSnapshot(), authorization: session.getAuthorization(), input: null }
      const cancelled = Symbol('cancelled file read')
      let release!: () => void
      const cancellation = new Promise<typeof cancelled>(resolve => { release = () => resolve(cancelled) })
      const pending = { cancel: release }
      pendingRead = pending
      try {
        publish({ phase: 'reading', message: '正在读取制品文件…' })
        current(generation) // A subscriber may cancel or replace the draft during publication.
        check(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 4_000_000, '制品文件大小无效或过大。', 'LIMIT')
        // Native File.text replaces malformed UTF-8, potentially altering unsigned props/names.
        // Read bytes when supported; retain the text seam for existing injected file adapters.
        const contents = await Promise.race([file.arrayBuffer ? file.arrayBuffer() : file.text(), cancellation])
        current(generation)
        check(typeof contents !== 'symbol', '文件读取已取消。', 'CONTEXT_CHANGED')
        let text: string
        if (typeof contents === 'string') text = contents
        else {
          check(contents.byteLength <= 4_000_000, '制品文件过大。', 'LIMIT')
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(contents) }
          catch { throw new Error('制品文件不是有效的 UTF-8 文本。') }
        }
        check(new TextEncoder().encode(text).byteLength <= 4_000_000, '制品文件过大。', 'LIMIT')
        current(generation)
        const raw: unknown = JSON.parse(text)
        assertJson(raw); object(raw)
        let input = raw, source = '来源未提供（手动文件）'
        if ('importFile' in raw) {
          keys(raw, ['importFile', 'provenance', 'status', 'validation', 'build', 'execution'])
          check(raw.status === 'pending-build' && raw.validation === 'source-admitted' && raw.build === 'not-attempted' && raw.execution === 'denied', '不接受已构建或可执行制品。')
          object(raw.provenance)
          check(typeof raw.provenance.kind === 'string' && raw.provenance.kind.length <= 80, '来源信息无效。')
          source = `文件声明来源：${raw.provenance.kind}（未在线核验；离线导入）`
          object(raw.importFile); input = raw.importFile
        }
        keys(input, ['instance', 'artifact']); object(input.instance); object(input.artifact)
        object(input.artifact.artifact); object(input.artifact.artifact.manifest)
        const manifest = input.artifact.artifact.manifest
        check(typeof manifest.name === 'string' && typeof input.instance.definitionId === 'string' && typeof input.instance.versionDigest === 'string', '名称或版本信息无效。')
        captured!.input = cloneJson(input)
        publish({ phase: 'loaded', candidate: { name: manifest.name, definitionId: input.instance.definitionId, versionDigest: input.instance.versionDigest, props: cloneJson(input.instance.props), source }, message: '文件已读取，点击预览添加以校验完整制品。' })
      } catch (error) { if (generation === epoch && !closed) { captured = undefined; fail(error) } }
      finally { if (pendingRead === pending) pendingRead = undefined }
    },
    async prepare() {
      alive(); unlocked()
      check(state.phase === 'loaded', '请先选择新的制品文件。')
      const generation = epoch, candidate = state.candidate
      try {
        current(generation)
        publish({ phase: 'preparing', candidate, message: '正在校验精确版本…' })
        const preview = await ensureInstaller().prepare(captured!.input)
        current(generation)
        publish({ phase: 'preview', candidate, preview, message: '尚未构建，暂不可运行。确认后仅添加积木。' })
      } catch (error) { if (generation === epoch && !closed) fail(error) }
    },
    async confirm() {
      alive()
      // Synchronous state transition closes the double-click window before React renders.
      if (state.phase === 'confirming' || state.phase === 'installed') return
      check(state.phase === 'preview' && state.preview, '请先预览添加。')
      const generation = epoch, preview = state.preview, candidate = state.candidate
      try {
        current(generation)
        publish({ phase: 'confirming', candidate, preview, message: '正在确认添加，请勿切换项目或离开。' })
        const result = await installer!.confirm(preview.ticketId)
        if (!result.ok) { publish({ phase: 'error', message: `${result.error.code}: ${result.error.message}` }); return }
        publish({ phase: 'installed', candidate, message: '已添加积木；尚未构建，暂不可运行。' })
      } catch (error) { fail(error) }
    },
    cancel() { alive(); invalidate('已取消，未添加积木。') },
    beforeContextChange() { alive(); invalidate() },
    dispose() {
      if (closed) return
      unlocked(); installer?.dispose(); unsubscribe?.(); installer = undefined; unsubscribe = undefined
      epoch++; captured = undefined; closed = true; retireRead()
      publish({ phase: 'idle', message: '' })
    },
    /** StrictMode effect replay can reactivate an empty, unsubscribed controller. */
    activate() { closed = false },
    isConfirming: () => state.phase === 'confirming',
  }
}
export type GeneratedArtifactUI = ReturnType<typeof createGeneratedArtifactUI>
