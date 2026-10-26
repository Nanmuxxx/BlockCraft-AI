import { useState, useSyncExternalStore } from 'react'
import type { WorkspaceSession } from './session'

export function WorkspaceControls({ workspace, onRecover }: { workspace: WorkspaceSession; onRecover: () => Promise<void> }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
  const [error, setError] = useState('')
  async function run(action: () => Promise<unknown>) {
    setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '操作未完成。') }
  }
  return <div className="workspace-save" aria-label="本机作品保存">
    <button type="button" disabled={state.busy || state.recovery || !state.dirty || workspace.runtime.customProject.getAuthorization().readOnly} onClick={() => void run(workspace.save)}>{state.busy ? '正在保存…' : '保存到本机'}</button>
    <button type="button" disabled={state.busy} onClick={() => void run(onRecover)}>恢复本机保存版本</button>
    <p role={error || state.error ? 'alert' : 'status'} aria-live="polite">{state.error || error || (state.dirty ? '当前修改尚未保存。确认采用图片会同时保存；其它修改请点击保存。' : '已保存到本机；刷新可恢复。更换浏览器请先下载项目 ZIP。')}</p>
  </div>
}
