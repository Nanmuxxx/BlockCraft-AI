import { useState } from 'react'
import { createAppRuntime } from '../../model/appRuntime'
import { createClubRegistrationExample, createReadingLogExample } from '../../model/appSpecExamples'
import { AppRenderer } from './AppRenderer'

export function AppRendererDemo() {
  const [runtimes] = useState(() => ({ club: createAppRuntime(createClubRegistrationExample()), reading: createAppRuntime(createReadingLogExample()) }))
  const [example, setExample] = useState<'club' | 'reading'>('club')
  return <main className="renderer-demo">
    <header><p>BlockCraft AI · C 模式</p><h1>通用应用预览</h1><p>数据仅保留在当前页面，刷新后恢复示例。</p></header>
    <nav aria-label="示例切换"><button aria-pressed={example === 'club'} onClick={() => setExample('club')}>社团报名</button><button aria-pressed={example === 'reading'} onClick={() => setExample('reading')}>阅读记录</button><a href="/">返回学习 Workshop</a></nav>
    <h2>{runtimes[example].getSnapshot().spec.name}</h2>
    <AppRenderer key={example} runtime={runtimes[example]} />
  </main>
}
