// TEST HARNESS ONLY: explicit static metadata, no generated/interactive component.
// This owner exists only for browser tests. Never import it from production src/.
import { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/latin-500.css'
import '@fontsource/pixelify-sans/latin-700.css'
import '../../../src/styles.css'
import { Logo } from '../../../src/components/Logo'
import mochi from '../../../src/assets/mochi.png'
import { createReadingLogExample } from '../../../src/model/appSpecExamples'
import { computeVersionDigest, migrateProjectState, parseCustomProject, type SourceArtifact, type CustomProject, type ObjectSchema } from '../../../src/custom-block'
import { createCustomBlockBCAdapter, referenceOf, CustomBlockCanvas, CustomBlockInspector, CustomBlockRunSurface } from '../../../src/integrations/custom-block-bc'
const objectSchema = (properties: ObjectSchema['properties'], required = Object.keys(properties)): ObjectSchema => ({ type: 'object', properties, required, additionalProperties: false })
const integrity = `sha512-${'A'.repeat(86)}==`
const artifact: SourceArtifact = {
  artifactVersion: 1,
  manifest: {
    protocolVersion: 1, definitionId: 'static-metadata-only', name: '静态元数据（非 AI 生成）', sdkVersion: '1.0.0', entry: 'src/Inert.tsx',
    propsSchema: objectSchema({ durationSeconds: { type: 'integer', minimum: 1, maximum: 86400, title: '时长（秒）' }, title: { type: 'string', maxLength: 40, minLength: 1 }, enabled: { type: 'boolean' }, mode: { type: 'string', maxLength: 12, enum: ['compact', 'full'] }, speed: { type: 'number', enum: [.5, 1, 2] }, approved: { type: 'boolean', enum: [false, true] }, tuning: objectSchema({ ratio: { type: 'number', minimum: 0, maximum: 1 }, caption: { type: 'string', maxLength: 20 } }) }, ['durationSeconds', 'title', 'enabled', 'mode', 'speed', 'approved']),
    stateSchema: objectSchema({}), events: {}, requestedCapabilities: [],
  },
  sources: { 'src/Inert.tsx': 'throw new Error("STATIC METADATA TEST SOURCE MUST NEVER EXECUTE")' },
  dependencies: { react: { version: '19.3.1', integrity } },
  build: { profile: 'react-isolated-v1', toolchain: { name: 'esbuild', version: '0.25.12', integrity }, target: 'es2020', format: 'esm', maxBundleBytes: 524288 },
}
const versionDigest = await computeVersionDigest(artifact)
const reference = { definitionId: artifact.manifest.definitionId, versionDigest }
const registry = { async resolve(ref: typeof reference) { return ref.definitionId === reference.definitionId && ref.versionDigest === reference.versionDigest ? { versionDigest, artifact } : undefined } }
const initial = migrateProjectState(createReadingLogExample())
for (const id of ['custom-1', 'custom-2']) {
  initial.custom.instances.push({ id, ...reference, props: { durationSeconds: 600, title: id, enabled: true, mode: 'compact', speed: 1, approved: false } })
  initial.custom.positions[id] = { x: id === 'custom-1' ? .5 : .8, y: id === 'custom-1' ? .3 : .7 }
}
initial.renderOrder.splice(1, 0, { kind: 'custom', id: 'custom-1' })
initial.renderOrder.push({ kind: 'custom', id: 'custom-2' })
const dragCheck = new URLSearchParams(location.search).has('drag-check')
if (dragCheck) {
  initial.base.spec.blocks = initial.base.spec.blocks.slice(0, 1)
  initial.base.spec.relations = initial.base.spec.relations.filter(relation => relation.blockId === initial.base.spec.blocks[0].id)
  initial.custom.instances = initial.custom.instances.slice(0, 1)
  initial.custom.positions = { 'custom-1': { x: .5, y: .7 } }
  initial.base.blockPositions = { [initial.base.spec.blocks[0].id]: { x: .5, y: .25 } }
  initial.renderOrder = [{ kind: 'builtin', id: initial.base.spec.blocks[0].id }, { kind: 'custom', id: 'custom-1' }]
}
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
const persistenceKey = dragCheck ? 'custom-block-bc-drag-test-only' : 'custom-block-bc-test-only'
const saved = localStorage.getItem(persistenceKey)
let state = freeze(await parseCustomProject(saved ? JSON.parse(saved) : initial, registry))
const listeners = new Set<() => void>()
const owner = {
  getSnapshot: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  compareAndSwap(expected: CustomProject, next: CustomProject) {
    if (state !== expected || next.revision !== state.revision + 1) return { ok: false as const, error: { code: 'REVISION_CONFLICT', message: 'stale' } }
    localStorage.setItem(persistenceKey, JSON.stringify(next))
    state = freeze(next); listeners.forEach(listener => listener())
    return { ok: true as const, duplicate: false, committedRevision: state.revision }
  },
}
const adapter = await createCustomBlockBCAdapter(owner, registry)
function App() {
  const [mode, setMode] = useState<'B' | 'C'>('B'), [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState('pending-build')
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot)
  return <main><header className="test-header"><Logo /><img src={mochi} alt="Mochi 像素猫" width="60" /><h1>B/C 静态元数据验收</h1><span>非 AI 输出，无可运行组件</span></header>
    <nav aria-label="测试模式"><button onClick={() => setMode('B')}>B 模式</button><button onClick={() => setMode('C')}>C 模式</button><button onClick={() => setStatus('unavailable')}>后端不可用</button><button onClick={() => setStatus('runnable')}>伪造 runnable（测试）</button>
      <button onClick={() => owner.compareAndSwap(snapshot, { ...structuredClone(snapshot), revision: snapshot.revision + 1 })}>外部 revision（测试）</button></nav>
    <output data-testid="revision">{snapshot.revision}</output>
    <div hidden={mode !== 'B'} className="test-layout"><CustomBlockCanvas adapter={adapter} selectedId={selected} onSelect={setSelected} /><CustomBlockInspector adapter={adapter} instanceId={selected} /></div>
    <div hidden={mode !== 'C'}><CustomBlockRunSurface adapter={adapter} renderBuiltin={block => <section className="test-builtin">内置插槽测试：{block.name}</section>} observationFor={instance => ({ reference: referenceOf(instance), status })} /></div>
    <pre data-testid="snapshot" hidden>{JSON.stringify(snapshot)}</pre>
  </main>
}
const style = document.createElement('style')
style.textContent = `body{background:#fffbf6;padding:20px}main{max-width:1300px;margin:auto}.test-header{display:flex;align-items:center;gap:15px;flex-wrap:wrap}.test-header h1{font-size:20px}.test-header span{font-size:12px}nav{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}nav button{padding:10px;background:#ffe1c9;border:1px solid #ead9c9;border-radius:10px}.test-layout:not([hidden]){display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:20px;align-items:start}.test-builtin{padding:20px;border:1px solid #ead9c9;border-radius:16px}@media(max-width:700px){body{padding:10px}.test-layout:not([hidden]){display:flex;flex-direction:column}.test-layout>*{width:100%}.custom-block-bc__inspector{box-sizing:border-box}}`
document.head.append(style)
createRoot(document.getElementById('root')!).render(<App />)
