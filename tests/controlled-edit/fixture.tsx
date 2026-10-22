// Only the harness owns initial data and observes snapshots. All edits use production
// Workshop + HTTP provider + Host + Planner + Runtime; browser.cjs supplies offline JSON.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppSpecWorkshop } from '../../src/components/app-builder/AppSpecWorkshop'
import { createAppRuntime, type AppRuntime } from '../../src/model/appRuntime'
import { createClubRegistrationExample } from '../../src/model/appSpecExamples'
import type { RestoredProject } from '../../src/integrations/project-json/format'
import '../../src/styles.css'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg=='
const initial = createClubRegistrationExample()
initial.spec.version = 2
initial.spec.name = 'Mochi 可控修改离线验收'
initial.spec.entities[0].fields.push({ id: 'quantity', name: '数量', type: 'number', required: false })
initial.records.applicants[0].values.quantity = 12
initial.spec.blocks.push({ id: 'gallery-1', name: '作品图库', type: 'gallery', protocolVersion: 1, imageIds: [], layout: 'grid', interaction: 'preview' })
initial.assets = { 'fixture-png': { id: 'fixture-png', name: '四像素.png', altText: '红绿蓝白四像素', mimeType: 'image/png', dataUrl: 'data:image/png;base64,' + png } }
const qa = { runtime: null as AppRuntime | null, imports: 0 }
Object.assign(window, { controlledEditQA: qa })
function Fixture() {
  const [runtime, setRuntime] = useState(() => createAppRuntime(initial))
  qa.runtime = runtime
  function restore(restored: RestoredProject) {
    qa.imports++
    setRuntime(createAppRuntime(restored.base, restored.artifacts, restored.project))
  }
  return <><p role="note">离线契约验收：真实 Workshop、HTTP Provider、Host、Runtime 与 ZIP，零真实 AI 调用。</p><AppSpecWorkshop runtime={runtime} onImportProject={restore} /></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
