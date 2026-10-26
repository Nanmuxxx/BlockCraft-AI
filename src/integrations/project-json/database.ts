/** Shared with the existing replacement backups; v2 adds only the current head. */
export const PROJECT_DATABASE = 'blockcraft-project-backups'
export const WORKSPACE_STORE = 'current-workspace'

export function openProjectDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let stopped = false
    const request = indexedDB.open(PROJECT_DATABASE, 2)
    const timer = setTimeout(() => { stopped = true; reject(new Error('本机保存暂不可用，请关闭其它旧版页面后重试。')) }, 5000)
    request.onupgradeneeded = () => {
      if (stopped) { request.transaction?.abort(); return }
      const db = request.result
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' })
      if (!db.objectStoreNames.contains(WORKSPACE_STORE)) db.createObjectStore(WORKSPACE_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      if (stopped) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onblocked = () => { stopped = true; clearTimeout(timer); reject(new Error('本机保存被旧版页面占用，请关闭其它页面后重试。')) }
    request.onerror = () => { clearTimeout(timer); reject(new Error('无法打开本机项目存储。')) }
  })
}
