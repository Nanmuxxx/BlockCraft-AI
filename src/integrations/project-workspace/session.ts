import type { AppRuntime } from '../../model/appRuntime'
import type { CustomProject } from '../../custom-block'
import type { PersistenceLease, WriteAuthorization } from '../custom-block-bc/owner'
import { createProjectJson, serializeProjectJson } from '../project-json/format'
import { createProjectPackage } from '../project-package/format'
import { assertNoPackageSecrets } from '../project-package/security'
import { assertProjectImagesDecodable } from '../project-package/image'
import { parseProjectFile } from '../project-package/file'
import { workspaceRepository, WorkspaceError, type AdoptionReceipt, type SavedWorkspace, type WorkspaceRepository } from './repository'

export interface WorkspaceView { busy: boolean; dirty: boolean; recovery: boolean; error: string; savedAt: number | null }
export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>

export async function restoreWorkspace(record: SavedWorkspace) {
  return parseProjectFile(new Blob([record.text], { type: 'application/json' }))
}

export function createWorkspaceSession(runtime: AppRuntime, options: {
  sequence: number; workspaceId?: string; saved?: SavedWorkspace; repository?: WorkspaceRepository; beforePublish?: () => void
}) {
  const repository = options.repository ?? workspaceRepository
  const workspaceId = options.workspaceId ?? `workspace-${crypto.randomUUID()}`
  const owner = runtime.customProject
  let sequence = options.sequence, disposed = false, savedSnapshot = options.saved ? owner.getSnapshot() : null
  let view: WorkspaceView = Object.freeze({ busy: false, dirty: !options.saved, recovery: false, error: '', savedAt: options.saved?.savedAt ?? null })
  let recoveryLease: PersistenceLease | undefined, active: AbortController | undefined
  const listeners = new Set<() => void>()
  const update = (changes: Partial<WorkspaceView>) => {
    view = Object.freeze({ ...view, dirty: owner.getSnapshot() !== savedSnapshot, ...changes })
    listeners.forEach(listener => listener())
  }
  const unsubscribe = owner.subscribe(() => update({}))
  function current(expected: CustomProject, authorization: WriteAuthorization) {
    return !disposed && !view.recovery && owner.getSnapshot() === expected && owner.getAuthorization() === authorization && !authorization.readOnly
  }
  async function persist(next: CustomProject, expected: CustomProject, authorization: WriteAuthorization, receipt?: AdoptionReceipt) {
    if (disposed || view.busy || view.recovery) throw new WorkspaceError('WORKSPACE_BUSY', '请先完成保存或恢复已保存作品。')
    if (!current(expected, authorization)) throw new WorkspaceError('CONTEXT_CHANGED', '作品或权限已变化，请重新预览。')
    update({ busy: true, error: '' })
    const controller = new AbortController(); active = controller
    let lease: PersistenceLease | undefined, stop = () => {}, durable = false, attempted = false, unknown = false
    let text = ''
    try {
      // Existing file protocols remain the only serializers and ingress validators.
      const document = await createProjectJson(next, owner.registry)
      assertNoPackageSecrets(document)
      text = serializeProjectJson(document)
      await assertProjectImagesDecodable(next.base.assets)
      await createProjectPackage(next, owner.registry)
      if (!current(expected, authorization)) throw new WorkspaceError('CONTEXT_CHANGED', '准备保存期间作品已变化，请重新预览。')
      lease = owner.acquirePersistence(expected, authorization)
      const valid = () => !disposed && lease!.current()
      stop = owner.subscribe(() => { if (!valid()) controller.abort() })
      attempted = true
      const result = await repository.save({ expectedSequence: sequence, workspaceId, text, receipt }, valid, controller.signal)
      durable = true; sequence = result.record.sequence
      if (result.duplicate) {
        // Never replay an old candidate over a newer saved head.
        update({ savedAt: result.record.savedAt })
        return { duplicate: true, record: result.record }
      }
      options.beforePublish?.()
      if (!valid()) throw new WorkspaceError('ACTIVATION_FAILED', '作品已保存，请恢复本机保存版本。')
      if (next !== expected) {
        stop(); stop = () => {}
        const published = lease.publish(next)
        if (!published.ok) throw new WorkspaceError('ACTIVATION_FAILED', '作品已保存，界面未完成更新；请恢复本机保存版本。')
      }
      savedSnapshot = owner.getSnapshot()
      update({ savedAt: result.record.savedAt, dirty: false })
      return result
    } catch (error) {
      if (attempted && !durable) {
        // A lost completion response is not proof that the transaction rolled back.
        // Reconcile against durable data before allowing another confirmation/write.
        try {
          const saved = await repository.read()
          const adopted = receipt && saved?.workspaceId === workspaceId && saved.receipts.some(r =>
            r.confirmationId === receipt.confirmationId && r.digest === receipt.digest && r.assetId === receipt.assetId && r.revision === receipt.revision)
          durable = Boolean(adopted || (saved?.workspaceId === workspaceId && saved.sequence === sequence + 1 && saved.text === text))
          unknown = !durable && (saved?.sequence ?? 0) !== sequence
          if (durable && saved) sequence = saved.sequence
        } catch { unknown = true }
      }
      if (durable || unknown) {
        recoveryLease = lease
        update({ recovery: true, error: durable
          ? '作品已保存，但界面尚未更新。请点击“恢复本机保存版本”；不要再次采用。'
          : '保存结果暂无法确认。请点击“恢复本机保存版本”核对；不要再次采用。' })
      } else update({ error: error instanceof Error ? error.message : '本机保存失败，旧作品已保留。' })
      throw error
    } finally {
      stop()
      if (!view.recovery) lease?.release()
      active = undefined
      update({ busy: false })
    }
  }
  return {
    workspaceId, runtime,
    getSnapshot: () => view,
    getSequence: () => sequence,
    isCurrent: current,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    beforeContextChange() { if (view.busy || view.recovery) throw new WorkspaceError('WORKSPACE_BUSY', '请先完成保存或恢复本机保存版本。') },
    save: () => persist(owner.getSnapshot(), owner.getSnapshot(), owner.getAuthorization()),
    adopt: (next: CustomProject, expected: CustomProject, authorization: WriteAuthorization, receipt: AdoptionReceipt) => persist(next, expected, authorization, receipt),
    async receipt(confirmationId: string, digest: string) {
      if (disposed) throw new WorkspaceError('CONTEXT_CHANGED', '该项目已关闭。')
      const record = await repository.read()
      if (record?.workspaceId !== workspaceId) return null
      const found = record.receipts.find(r => r.confirmationId === confirmationId)
      if (found && found.digest !== digest) throw new WorkspaceError('CONFIRMATION_CONFLICT', '确认标识与图片不一致。')
      return found ?? null
    },
    dispose() { disposed = true; active?.abort(); recoveryLease?.release(); unsubscribe(); listeners.clear() },
  }
}
