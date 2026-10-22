// Developer-authored scaffolding. Artifact text is only copied as text by export.mjs.
export const packageJson = {
  name: 'blockcraft-export', version: '1.0.0', private: true, type: 'module',
  engines: { node: '>=22.16.0' },
  scripts: { dev: 'vite --host 127.0.0.1', build: 'tsc --noEmit && vite build', preview: 'vite preview --host 127.0.0.1' },
  dependencies: { react: '19.3.1', 'react-dom': '19.3.1' },
  devDependencies: { '@types/react': '19.3.0', '@types/react-dom': '19.3.0', typescript: '5.9.3', vite: '8.3.4' },
}
export const tsconfig = {
  compilerOptions: {
    target: 'ES2020', lib: ['ES2020', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler',
    jsx: 'react-jsx', strict: true, esModuleInterop: true, skipLibCheck: true, noEmit: true,
    resolveJsonModule: true, allowImportingTsExtensions: true, isolatedModules: true,
  }, include: ['src', 'vite.config.ts'],
}
export const model = `export type Value = string | number | boolean;
export type Row = { id: string; values: Record<string, Value> };
export type Field = { id: string; name: string; required: boolean } & ({ type: 'text' | 'number' | 'boolean' | 'date' } | { type: 'select'; options: string[] });
export type Asset = { id: string; name: string; altText?: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; dataUrl: string };
export type Block = { id: string; name: string } & ({ type: 'form'; fieldIds: string[] } | { type: 'list'; fieldIds: string[] } | { type: 'gallery'; protocolVersion: 1; imageIds: string[]; layout: 'grid'; interaction: 'preview' } | { type: 'metric'; aggregation: 'count' } | { type: 'metric'; aggregation: 'sum' | 'average'; fieldId: string });
export type Records = Record<string, Row[]>;
export type Project = {
  formatVersion: 2; revision: number;
  base: { spec: { version: 1; id: string; name: string; entities: { id: string; name: string; fields: Field[] }[]; blocks: Block[]; relations: { id: string; type: 'dataBinding'; blockId: string; entityId: string }[] }; records: Records; blockPositions: Record<string, { x: number; y: number }>; assets?: Record<string, Asset> };
  custom: { instances: { id: string; definitionId: string; versionDigest: string; props: Record<string, unknown> }[]; positions: Record<string, { x: number; y: number }>; states: Record<string, never> };
  renderOrder: { kind: 'builtin' | 'custom'; id: string }[];
};
`
export const form = `import { useState, type FormEvent } from 'react';
import type { Field, Row, Value } from '../model';
export default function FormBlock({ fields, initial, onSave, onCancel }: { fields: Field[]; initial?: Row; onSave: (values: Record<string, Value>) => void; onCancel?: () => void }) {
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map(field => {
    const value = initial && Object.prototype.hasOwnProperty.call(initial.values, field.id) ? initial.values[field.id] : undefined;
    return [field.id, field.type === 'boolean' ? value === true : value === undefined ? '' : String(value)];
  })));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const next: Record<string, Value> = {};
    for (const field of fields) {
      const current = values[field.id];
      if (field.type === 'boolean') { next[field.id] = current === true; continue; }
      const raw = String(current ?? '');
      if (raw.trim() === '') { if (field.required) { setError('请填写：' + field.name); return; } if (initial) next[field.id] = ''; continue; }
      if (field.type === 'number') { const value = Number(raw); if (!Number.isFinite(value)) { setError('无效数字'); return; } next[field.id] = value; }
      else { next[field.id] = raw; }
    }
    onSave(next); setError('');
    if (!initial) setValues(Object.fromEntries(fields.map(field => [field.id, field.type === 'boolean' ? false : ''])));
  }
  return <form onSubmit={submit}>{fields.map(field => <label key={field.id}>{field.name}{field.required ? ' *' : ''}
    {field.type === 'select' ? <select name={field.id} required={field.required} value={String(values[field.id] ?? '')} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))}><option value="">请选择</option>{field.options.map(value => <option key={value}>{value}</option>)}</select>
    : <input name={field.id} type={field.type === 'boolean' ? 'checkbox' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'} step={field.type === 'number' ? 'any' : undefined} required={field.type !== 'boolean' && field.required} checked={field.type === 'boolean' ? values[field.id] === true : undefined} value={field.type === 'boolean' ? undefined : String(values[field.id] ?? '')} onChange={event => setValues(current => ({ ...current, [field.id]: field.type === 'boolean' ? event.target.checked : event.target.value }))} />}
  </label>)}<button type="submit">{initial ? '保存修改' : '保存'}</button>{initial && onCancel && <button type="button" onClick={onCancel}>取消编辑</button>}{error && <p role="alert">{error}</p>}</form>;
}
`
export const list = `import FormBlock from './FormBlock';
import type { Field, Row, Value } from '../model';
export default function ListBlock({ fields, rows, editing, onEdit, onDelete, onUpdate, onCancel }: { fields: Field[]; rows: Row[]; editing?: Row; onEdit: (id: string) => void; onDelete: (id: string) => void; onUpdate: (id: string, values: Record<string, Value>) => void; onCancel: () => void }) {
  return <div className="table-scroll"><table><thead><tr>{fields.map(field => <th key={field.id}>{field.name}</th>)}<th>操作</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} data-record-id={row.id}>{fields.map(field => { const value = Object.prototype.hasOwnProperty.call(row.values, field.id) ? row.values[field.id] : undefined; return <td key={field.id}>{typeof value === 'boolean' ? (value ? '是' : '否') : String(value ?? '')}</td>; })}<td><button type="button" onClick={() => onEdit(row.id)}>编辑</button><button type="button" onClick={() => onDelete(row.id)}>删除</button></td></tr>)}</tbody>
  </table>{rows.length === 0 && <p>暂无记录</p>}{editing && <FormBlock key={editing.id} fields={fields} initial={editing} onSave={values => onUpdate(editing.id, values)} onCancel={onCancel} />}</div>;
}
`
export const metric = `import type { Block, Row } from '../model';
export default function MetricBlock({ block, rows }: { block: Extract<Block, { type: 'metric' }>; rows: Row[] }) {
  const numbers = block.aggregation === 'count' ? [] : rows.map(row => row.values[block.fieldId]).filter((value): value is number => typeof value === 'number');
  const sum = numbers.reduce((a, b) => a + b, 0);
  const value = block.aggregation === 'count' ? rows.length : block.aggregation === 'sum' ? sum : numbers.length ? sum / numbers.length : 0;
  return <output className="metric">{Number.isFinite(value) ? value : '数值超出范围'}</output>;
}
`
export const gallery = `import type { Asset } from '../model';
export default function GalleryBlock({ block, assets }: { block: { name: string; imageIds: string[] }; assets: Record<string, Asset> }) {
  return <section aria-label={block.name}><h2>{block.name}</h2>{block.imageIds.length === 0 ? <p>画廊还没有图片。</p> : <div className="gallery-grid">{block.imageIds.map(id => { const asset = assets[id]; return asset ? <figure key={id}><img src={asset.dataUrl} alt={asset.altText || asset.name} loading="lazy" /><figcaption>{asset.name}</figcaption></figure> : <p key={id} role="alert">图片资源不可用：{id}</p> })}</div>}</section>;
}
`
export const main = `import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<App />);
`
export const recordOperations = `export function updateRows(rows: Row[], id: string, values: Record<string, Value>): Row[] {
  return rows.map(row => {
    if (row.id !== id) return row;
    const next = { ...row.values };
    for (const [field, value] of Object.entries(values)) {
      if (value === '') delete next[field];
      else Object.defineProperty(next, field, { value, enumerable: true, configurable: true, writable: true });
    }
    return { ...row, id: row.id, values: next };
  });
}
`
export function app(customImports, customCases) {
  return `import { useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';
import type { Records, Row, Block, Value } from './model';
import { project } from './data';
import FormBlock from './components/FormBlock';
import ListBlock from './components/ListBlock';
import MetricBlock from './components/MetricBlock';
import GalleryBlock from './components/GalleryBlock';
${customImports}
${recordOperations}
// Records live only in this standalone app's memory. Reload restores exported data.
const customComponents: Record<string, ComponentType<any>> = { ${customCases} };
function own<T>(values: Record<string, T>, key: string): T | undefined { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined; }
export default function App() {
  const [records, setRecords] = useState<Records>(project.base.records);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ entity: string; id: string } | null>(null);
  const positionedHeight = Math.max(0, ...[...Object.values(project.base.blockPositions), ...Object.values(project.custom.positions)].map(position => position.y * 800 + 620));
  function add(entity: string, row: Row) { setRecords(current => ({ ...current, [entity]: [...(own(current, entity) ?? []), row] })); }
  function remove(entity: string, id: string) { setRecords(current => ({ ...current, [entity]: (own(current, entity) ?? []).filter(row => row.id !== id) })); setEditing(current => current?.entity === entity && current.id === id ? null : current); }
  function update(entity: string, id: string, values: Record<string, Value>) { if (!(own(records, entity) ?? []).some(row => row.id === id)) { setError('记录不存在，请重新选择'); setEditing(null); return; } setRecords(current => ({ ...current, [entity]: updateRows(own(current, entity) ?? [], id, values) })); setError(''); setEditing(null); }
  return <main><h1>{project.base.spec.name}</h1>{error && <p role="alert">{error}</p>}<div className="board" style={{ '--positioned-height': positionedHeight + 'px' } as CSSProperties}>{project.renderOrder.map((item, index) => {
    const position = item.kind === 'builtin' ? own(project.base.blockPositions, item.id) : own(project.custom.positions, item.id);
    // Normalized saved coordinates determine the desktop board; DOM/tab order stays renderOrder.
    const style = position ? { '--x': position.x, '--y': position.y, zIndex: index + 1 } as CSSProperties : undefined;
    if (item.kind === 'custom') {
      const instance = project.custom.instances.find(instance => instance.id === item.id)!;
      const Component = customComponents[instance.id];
      return <section key={'custom:' + item.id} data-block-id={item.id} data-positioned={!!position} className="block" style={style}><Component {...instance.props} /></section>;
    }
    const block: Block = project.base.spec.blocks.find(block => block.id === item.id)!;
    if (block.type === 'gallery') return <section key={'builtin:' + item.id} data-block-id={item.id} data-positioned={!!position} className="block" style={style}><GalleryBlock block={block} assets={project.base.assets ?? {}} /></section>;
    const binding = project.base.spec.relations.find(binding => binding.blockId === block.id)!;
    const entity = project.base.spec.entities.find(entity => entity.id === binding.entityId)!;
    const rows = own(records, entity.id) ?? [];
    const fields = block.type === 'metric' ? [] : block.fieldIds.map(id => entity.fields.find(field => field.id === id)!);
    return <section key={'builtin:' + item.id} data-block-id={item.id} data-positioned={!!position} className="block" style={style}><h2>{block.name}</h2>
      {block.type === 'form' ? <FormBlock fields={fields} onSave={values => add(entity.id, { id: crypto.randomUUID(), values })} /> : block.type === 'list' ? <ListBlock fields={fields} rows={rows} editing={editing?.entity === entity.id ? rows.find(row => row.id === editing.id) : undefined} onEdit={id => { if (!rows.some(row => row.id === id)) { setError('记录不存在，请重新选择'); setEditing(null); return; } setError(''); setEditing({ entity: entity.id, id }); }} onDelete={id => remove(entity.id, id)} onUpdate={(id, values) => update(entity.id, id, values)} onCancel={() => setEditing(null)} /> : <MetricBlock block={block} rows={rows} />}
    </section>;
  })}</div></main>;
}
`
}
export const css = `:root { font-family: system-ui, sans-serif; color: #26354b; background: #f4f6fb; } * { box-sizing: border-box; }
main { max-width: 1280px; margin: auto; padding: 24px; } h1 { margin-top: 0; } h2 { font-size: 1.2rem; }
.board { position: relative; padding-top: var(--positioned-height, 0px); display: grid; gap: 20px; align-content: start; }
.block { background: white; border: 1px solid #d6deed; border-radius: 12px; padding: 20px; min-width: 0; overflow: auto; }
.block[data-positioned="true"] { position: absolute; width: 320px; max-height: 600px; left: calc(var(--x) * (100% - 320px)); top: calc(var(--y) * 800px); }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; } .gallery-grid figure { margin: 0; } .gallery-grid img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; } .gallery-grid figcaption { padding-top: 4px; font-size: .9rem; }
label { display: grid; gap: 6px; margin-bottom: 12px; } input, select, button { padding: 8px; font: inherit; } input[type="checkbox"] { justify-self: start; }
button { cursor: pointer; } table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
.table-scroll { overflow: auto; } .metric { font-size: 2.2rem; }
@media (max-width: 700px) { .board { padding-top: 0; } .block[data-positioned="true"] { position: static; width: auto; max-height: none; } }
`
export const readme = `# 独立 React + TypeScript + Vite 工程

要求 Node.js >= 22.16。审查源码后，在本目录运行：

\`\`\`sh
npm ci
npm run dev
npm run build
npm run preview
\`\`\`

dev 的回环地址由 Vite 显示；build 产物位于 dist/。可编辑 src/App.tsx、src/components/ 和 src/data.ts。
无需 BlockCraft 网站、账号、API 或远程 Runtime。React/Vite 依赖来自 npm，需要用户自行联网安装。
package.json 固定直接依赖版本，随包附带 package-lock.json 锁定传递依赖，使用 npm ci 按锁文件安装。离线安装仅在完整缓存已具备时可运行 npm ci --offline；ZIP 本身不包含依赖。
制品 SRI 作为版本准入核对声明，不代表本导出器已下载并认证 npm 包或其传递依赖。

内置 form 保存记录，list 展示/编辑/删除记录，metric count/sum/average 自动更新；编辑保存会保留原记录 ID，取消编辑或删除正在编辑的记录不会留下编辑状态；业务数据保存在内存，刷新恢复导出的初始记录。
字段顺序按配置；桌面保留归一化坐标与 renderOrder 的层叠/DOM 顺序，未设置坐标的积木排在坐标区域下方，手机全部按 renderOrder 顺排。此工程是独立功能布局，不是编辑器像素快照。
CustomBlock 仅支持默认 React 组件接收 props、使用组件本地状态的独立协议。宿主状态槽、声明状态、事件、能力请求均拒绝。
provenance.json 记录准确 definitionId/versionDigest；src/components/custom/ 中保留原始源文本和相对模块路径。

## 安全和数据

第三方及 AI 生成源码必须由你自行审查。摘要与静态语法/import 检查不等于安全沙箱认证、语义类型检查或行为正确性证明。
导出器没有安装或运行这些源码；只有仓库中固定且经过哈希确认的人工样本可进入独立验收环境。
代码在你启动后可获得普通网页的能力，不提供 CustomBlock 隔离。请勿将秘密、真实个人记录或凭据交给未审查代码。
导出包含项目已存记录和参数；共享 ZIP 前自行确认数据。已知凭据/环境文件/宿主路径模式会被拒绝，但文本扫描无法识别所有秘密。
不要把此工程接入可信服务器自动执行，也不要把它视为已经通过安全 Viewer 的制品。
`
