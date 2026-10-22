const DB_NAME = 'blockcraft-project-backups'
const STORE_NAME = 'projects'
export const PROJECT_BACKUPS_CHANGED = 'blockcraft-project-backups-changed'

export interface ProjectBackupEntry {
  id: string
  name: string
  createdAt: number
  text: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onblocked = () => { blocked = true; reject(new Error('本地备份暂时被其他页面占用，请关闭其他 BlockCraft 页面后重试。')) }
    request.onerror = () => reject(request.error ?? new Error('无法打开本地项目备份。'))
  })
}

export async function saveProjectBackup(text: string, name: string): Promise<void> {
  let db: IDBDatabase | undefined
  try {
    const entry: ProjectBackupEntry = { id: crypto.randomUUID(), name, createdAt: Date.now(), text }
    db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readwrite', { durability: 'strict' })
      tx.objectStore(STORE_NAME).add(entry)
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('无法保存本地项目备份。'))
    })
    window.dispatchEvent(new Event(PROJECT_BACKUPS_CHANGED))
  } catch { throw new Error('无法保存本地备份（浏览器存储不可用或空间不足），当前项目未更改。请先下载项目 JSON 并检查浏览器存储。') }
  finally { db?.close() }
}

export async function listProjectBackups(): Promise<Omit<ProjectBackupEntry, 'text'>[]> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const entries: Omit<ProjectBackupEntry, 'text'>[] = []
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          const { id, name, createdAt } = cursor.value as ProjectBackupEntry
          entries.push({ id, name, createdAt }); cursor.continue()
        }
      }
      tx.oncomplete = () => resolve(entries.sort((a, b) => b.createdAt - a.createdAt))
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}

export async function readProjectBackup(id: string): Promise<string> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
      request.onsuccess = () => typeof request.result?.text === 'string' ? resolve(request.result.text) : reject(new Error('找不到此项目备份。'))
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

export function formatBackupTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}
