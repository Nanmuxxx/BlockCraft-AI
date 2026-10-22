// Explicit offline-only entry served by browser.cjs. No production route or AI calls.
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/latin-500.css'
import '@fontsource/pixelify-sans/latin-700.css'
import '../../src/styles.css'
import { MochiWorkshop } from '../../src/components/app-builder/AppSpecWorkshop'
import { createAppRuntime } from '../../src/model/appRuntime'
import { createClubRegistrationExample } from '../../src/model/appSpecExamples'
import { createMochiHost } from '../../src/integrations/mochi/host'

const runtime = createAppRuntime(createClubRegistrationExample())
const qa = { runtime, host: null as ReturnType<typeof createMochiHost> | null, planCalls: 0, failPlan: false, structureChange: () => {
  const state = runtime.getSnapshot(), entity = state.spec.entities[0]
  return runtime.executeCommand({ requestId: `fixture-structure-${state.revision}`, baseRevision: state.revision,
    commands: [{ type: 'addField', entityId: entity.id, field: { id: `fixture-field-${state.revision}`, name: `可选字段${state.revision}`, type: 'text', required: false } }] })
} }
Object.assign(window, { proactiveQA: qa })
function Fixture() {
  const [host, setHost] = useState<ReturnType<typeof createMochiHost> | null>(null)
  useEffect(() => {
    const instance = createMochiHost(runtime, request => {
      qa.planCalls++
      if (qa.failPlan) throw new Error('Offline provider fixture failure')
      const block = request.snapshot.spec.blocks.find(item => item.id === request.context.selectedBlockId)!
      if (!('fieldIds' in block)) throw new Error('Offline fixture requires field-bound block')
      const entityId = request.snapshot.spec.relations.find(relation => relation.blockId === block.id)!.entityId
      const fieldId = `fixture-note-${request.context.revision}`
      return { request: { requestId: request.requestId, baseRevision: request.context.revision, commands: [
        { type: 'addField', entityId, field: { id: fieldId, name: '建议备注', type: 'text', required: false } },
        { type: 'configureBlockFields', blockId: block.id, fieldIds: [...block.fieldIds, fieldId] },
      ] }, capabilityIds: [] }
    })
    instance.setSelection('registration-form')
    qa.host = instance; setHost(instance)
    return () => { instance.dispose(); qa.host = null }
  }, [])
  return host ? <><p role="note">主动建议离线验收：真实 Workshop、Host 与 Runtime；固定 API 回复，零真实 AI 调用。</p><MochiWorkshop runtime={runtime} host={host} /></> : null
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
