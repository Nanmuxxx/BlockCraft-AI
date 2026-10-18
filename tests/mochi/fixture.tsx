// Served only by tests/mochi/browser.cjs's temporary Vite middleware.
// Fixed Mock fixture. No language understanding and no production route.
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/latin-500.css'
import '@fontsource/pixelify-sans/latin-700.css'
import '../../src/styles.css'
import { AppSpecWorkshop, MochiWorkshop } from '../../src/components/app-builder/AppSpecWorkshop'
import { createAppRuntime } from '../../src/model/appRuntime'
import { createClubRegistrationExample } from '../../src/model/appSpecExamples'
import { createMochiHost } from '../../src/integrations/mochi/host'
import { createModelPlanProvider } from '../../src/integrations/mochi/modelPlanProvider'
import { mockAddOptionalField } from '../../src/integrations/mochi/mockPlanner'
import { toMinimalPlanInput } from '../../src/integrations/mochi/planning'

const runtime = createAppRuntime(createClubRegistrationExample())
let subscriptions = 0
const subscribe = runtime.subscribe
runtime.subscribe = listener => {
  subscriptions++
  const unsubscribe = subscribe(() => { if (!qa.missNextNotification) listener() })
  return () => { subscriptions--; unsubscribe() }
}
const qa = { runtime, host: null as ReturnType<typeof createMochiHost> | null, failure: false, missNextNotification: false,
  defer: false, pending: [] as Array<{ resolve: () => void; reject: () => void }>, replaceHost: () => {},
  calls: 0, get subscriptions() { return subscriptions }, inputs: [] as unknown[], unmount: () => { root.unmount() } }
Object.assign(window, { mochiQA: qa })
function Fixture() {
  const [generation, setGeneration] = useState(0)
  qa.replaceHost = () => setGeneration(value => value + 1)
  const [host, setHost] = useState<ReturnType<typeof createMochiHost> | null>(null)
  useEffect(() => {
    const fixedJsonProvider = createModelPlanProvider(async ({ request }) => {
      qa.calls++; qa.inputs.push(request)
      const response = () => JSON.stringify({ request: {
        requestId: request.requestId, baseRevision: request.baseRevision, commands: [
          { type: 'addField', entityId: request.entity.id, field: { id: `${request.requestId}-field`, name: 'Mock 备注', type: 'text', required: false } },
          { type: 'configureBlockFields', blockId: request.block.id, fieldIds: [...request.block.fieldIds, `${request.requestId}-field`] },
        ],
      }, capabilityIds: [] })
      // Fixed JSON completion only; never call a model, even for arbitrary input.
      if (qa.defer) return new Promise((resolve, reject) => { qa.pending.push({ resolve: () => resolve(response()), reject: () => reject(new Error('Late offline test failure')) }) })
      if (qa.failure) throw new Error('Offline test failure')
      return response()
    })
    const instance = createMochiHost(runtime, new URLSearchParams(location.search).has('model-plan') ? fixedJsonProvider : async request => {
      qa.calls++; qa.inputs.push(toMinimalPlanInput(request))
      // Deliberately ignore abort to exercise late-provider isolation end to end.
      if (qa.defer) return new Promise((resolve, reject) => { qa.pending.push({ resolve: () => resolve(mockAddOptionalField(request)), reject: () => reject(new Error('Late offline test failure')) }) })
      if (qa.failure) throw new Error('Offline test failure')
      return mockAddOptionalField(request)
    })
    qa.host = instance; setHost(instance)
    return () => { instance.dispose(); qa.host = null }
  }, [generation])
  return host ? <><p role="note">验收夹具：固定 Mock 计划，不理解自然语言，不调用 AI。</p><MochiWorkshop runtime={runtime} host={host} /></> : null
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode>{new URLSearchParams(location.search).has('production') ? <AppSpecWorkshop runtime={runtime} /> : <Fixture />}</StrictMode>)
