import { useEffect, useId, useState } from 'react'
import { Download } from 'lucide-react'
import type { RestoredProject } from './format'
import { listProjectBackups, readProjectBackup, formatBackupTime, PROJECT_BACKUPS_CHANGED, type ProjectBackupEntry } from './backups'
import { parseProjectJsonText } from './format'
import { downloadProjectJson } from './download'

export function ProjectJsonBackups({ onRestore }: { onRestore?: (restored: RestoredProject) => void | Promise<void> }) {
  const [entries, setEntries] = useState<Omit<ProjectBackupEntry, 'text'>[]>([])
  const [selected, setSelected] = useState('')
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')
  const id = useId()
  useEffect(() => {
    let active = true
    const refresh = () => { void listProjectBackups().then(items => { if (active) setEntries(items) }).catch(() => { if (active) setFeedback('本地备份暂不可读取。') }) }
    refresh(); window.addEventListener(PROJECT_BACKUPS_CHANGED, refresh)
    return () => { active = false; window.removeEventListener(PROJECT_BACKUPS_CHANGED, refresh) }
  }, [])
  if (!entries.length) return null
  async function restore(download: boolean) {
    if (pending) return
    setPending(true); setFeedback('')
    try {
      const text = await readProjectBackup(selected || entries[0].id)
      if (download) { downloadProjectJson(text, 'blockcraft-project-backup.json'); setFeedback('已发起备份下载，请确认浏览器已保存文件。') }
      else if (onRestore) { await onRestore(await parseProjectJsonText(text)); setFeedback('备份项目已恢复。') }
    } catch (error) { setFeedback(error instanceof Error ? error.message : '备份项目无效，当前项目未更改。') }
    finally { setPending(false) }
  }
  return <div className="project-json-backups" aria-label="本地项目备份">
    <label htmlFor={id}>替换前的本地备份</label>
    <select id={id} value={selected || entries[0].id} disabled={pending} onChange={event => setSelected(event.target.value)}>{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {formatBackupTime(entry.createdAt)}</option>)}</select>
    <button type="button" disabled={pending} onClick={() => void restore(true)}><Download size={15} aria-hidden="true" />下载备份 JSON</button>
    {onRestore && <button type="button" disabled={pending} onClick={() => void restore(false)}>恢复所选备份</button>}
    {feedback && <p role="status">{feedback}</p>}
  </div>
}
