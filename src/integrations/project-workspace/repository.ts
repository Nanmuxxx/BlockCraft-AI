import { openProjectDatabase, WORKSPACE_STORE } from '../project-json/database'

export interface AdoptionReceipt { confirmationId: string; digest: string; assetId: string; revision: number }
export interface SavedWorkspace {
  id: 'current'; sequence: number; workspaceId: string; text: string; savedAt: number; receipts: AdoptionReceipt[]
}
export class WorkspaceError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'WorkspaceError' }
}
const conflict = () => new WorkspaceError('STORAGE_CONFLICT', '另一页面已保存新版本。请先下载当前项目，再恢复本机保存版本；不会覆盖另一页面的作品。')
function validate(value: unknown): SavedWorkspace | null {
  if (value === undefined) return null
  const r = value as SavedWorkspace
  if (!r || r.id !== 'current' || !Number.isSafeInteger(r.sequence) || r.sequence < 1 ||
      typeof r.workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.workspaceId) ||
      typeof r.text !== 'string' || new TextEncoder().encode(r.text).length > 4_000_000 ||
      !Number.isSafeInteger(r.savedAt) || !Array.isArray(r.receipts) || r.receipts.length > 128 ||
      r.receipts.some(x => !x || typeof x.confirmationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(x.confirmationId) ||
        !/^[a-f0-9]{64}$/.test(x.digest) || typeof x.assetId !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(x.assetId) || !Number.isSafeInteger(x.revision) || x.revision < 0) ||
      new Set(r.receipts.map(x => x.confirmationId)).size !== r.receipts.length) {
    throw new WorkspaceError('STORAGE_INVALID', '本机保存记录无效，请使用导出的项目文件恢复；不会自动覆盖该记录。')
  }
  return r
}
export interface WorkspaceRepository {
  read: () => Promise<SavedWorkspace | null>
  save: (input: { expectedSequence: number; workspaceId: string; text: string; receipt?: AdoptionReceipt },
    guard: () => boolean, signal: AbortSignal) => Promise<{ record: SavedWorkspace; duplicate: boolean }>
}

/** A single IDB transaction checks the saved generation and writes head + receipt.
 * This is local-browser persistence, not cloud ownership or provider accounting. */
export function createWorkspaceRepository(options: { beforeWrite?: () => void } = {}): WorkspaceRepository {
  return {
    async read() {
      const db = await openProjectDatabase()
      try {
        return await new Promise<SavedWorkspace | null>((resolve, reject) => {
          const tx = db.transaction(WORKSPACE_STORE, 'readonly')
          const request = tx.objectStore(WORKSPACE_STORE).get('current')
          let result: SavedWorkspace | null = null, failure: unknown
          request.onsuccess = () => { try { result = validate(request.result) } catch (e) { failure = e; tx.abort() } }
          tx.oncomplete = () => resolve(result)
          tx.onabort = tx.onerror = () => reject(failure ?? new WorkspaceError('STORAGE_UNAVAILABLE', '无法读取本机保存作品。'))
        })
      } finally { db.close() }
    },
    async save(input, guard, signal) {
      const db = await openProjectDatabase()
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(WORKSPACE_STORE, 'readwrite', { durability: 'strict' })
          let failure: unknown, result: { record: SavedWorkspace; duplicate: boolean } | undefined
          const abort = () => { try { tx.abort() } catch { /* Completion may already be durable; read its result. */ } }
          const timer = setTimeout(abort, 10_000)
          const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
          signal.addEventListener('abort', abort, { once: true })
          const store = tx.objectStore(WORKSPACE_STORE), request = store.get('current')
          request.onsuccess = () => {
            try {
              if (signal.aborted || !guard()) throw new WorkspaceError('CONTEXT_CHANGED', '项目、目标或权限已变化，请重新预览。')
              const current = validate(request.result)
              const receipts = current?.workspaceId === input.workspaceId ? current.receipts : []
              const prior = input.receipt && receipts.find(r => r.confirmationId === input.receipt!.confirmationId)
              if (prior) {
                if (JSON.stringify(prior) !== JSON.stringify(input.receipt)) throw new WorkspaceError('CONFIRMATION_CONFLICT', '确认标识与图片内容不一致。')
                result = { record: current!, duplicate: true }; return
              }
              if ((current?.sequence ?? 0) !== input.expectedSequence) throw conflict()
              if (input.expectedSequence >= Number.MAX_SAFE_INTEGER) throw conflict()
              if (input.receipt && receipts.length >= 128) throw new WorkspaceError('RECEIPTS_FULL', '本项目确认记录已达上限，请导出备份后导入为新项目。')
              const record: SavedWorkspace = { id: 'current', sequence: input.expectedSequence + 1, workspaceId: input.workspaceId,
                text: input.text, savedAt: Date.now(), receipts: input.receipt ? [...receipts, input.receipt] : receipts }
              validate(record)
              options.beforeWrite?.()
              if (signal.aborted || !guard()) throw new WorkspaceError('CONTEXT_CHANGED', '保存前项目或权限已变化。')
              store.put(record)
              result = { record, duplicate: false }
            } catch (e) { failure = e; abort() }
          }
          tx.oncomplete = () => { cleanup(); result ? resolve(result) : reject(new WorkspaceError('SAVE_UNKNOWN', '保存结果待核实，请恢复本机保存版本。')) }
          tx.onabort = tx.onerror = () => { cleanup(); reject(failure ?? new WorkspaceError('SAVE_FAILED', '本机保存失败或空间不足；原作品未被替换，请下载项目文件备份。')) }
          if (signal.aborted) abort()
        })
      } finally { db.close() }
    },
  }
}

export const workspaceRepository = createWorkspaceRepository()
