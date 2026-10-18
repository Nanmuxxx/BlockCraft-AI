import { useState, useSyncExternalStore } from 'react'
import type { AppRuntime } from '../../model/appRuntime'
import { AppRenderer } from '../app-renderer/AppRenderer'
import { AppSpecCanvas } from './AppSpecCanvas'
import './app-spec-workshop.css'

/** The caller owns one runtime per generated application, never per mode. */
export function AppSpecWorkshop({ runtime }: { runtime: AppRuntime }) {
  const [mode, setMode] = useState<'blocks' | 'run'>('blocks')
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  return <section className="app-spec-workshop" aria-label="生成的应用">
    <header><h2>{snapshot.spec.name}</h2><p>编辑积木和字段，再切到运行模式使用应用。修改与记录在两种模式间共享。</p></header>
    <div className="app-spec-workshop__modes" role="group" aria-label="工作模式">
      <button type="button" aria-pressed={mode === 'blocks'} onClick={() => setMode('blocks')}>B 模式 · 编辑积木</button>
      <button type="button" aria-pressed={mode === 'run'} onClick={() => setMode('run')}>C 模式 · 运行应用</button>
    </div>
    {/* Keep selection and unfinished editor drafts mounted while changing modes. */}
    <div hidden={mode !== 'blocks'}><AppSpecCanvas runtime={runtime} /></div>
    <div hidden={mode !== 'run'}><AppRenderer runtime={runtime} /></div>
  </section>
}
