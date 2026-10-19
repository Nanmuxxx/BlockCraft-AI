// Explicit offline test composition. No route/plugin in the production build.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/latin-500.css'
import '../../src/styles.css'
import { MochiWorkshop } from '../../src/components/app-builder/AppSpecWorkshop'
import { createAppRuntime } from '../../src/model/appRuntime'
import { createClubRegistrationExample } from '../../src/model/appSpecExamples'
import { createMochiHost } from '../../src/integrations/mochi/host'
import { createModelPlanProvider } from '../../src/integrations/mochi/modelPlanProvider'
const qa = { runtime: createAppRuntime(createClubRegistrationExample()), host: null as ReturnType<typeof createMochiHost> | null,
  patch: {} as Record<string, unknown>, defer: false, pending: [] as (() => void)[], replace: () => {} }
Object.assign(window, { presentationQA: qa })
function Fixture() {
  const [runtime, setRuntime] = useState(qa.runtime)
  const [owner, setOwner] = useState<{runtime: typeof runtime; host: ReturnType<typeof createMochiHost>} | null>(null)
  qa.replace = () => { qa.runtime = createAppRuntime(createClubRegistrationExample()); setRuntime(qa.runtime) }
  useEffect(() => {
    const provider = createModelPlanProvider(async ({ request }) => {
      const response = JSON.stringify({ request: { requestId: request.requestId, baseRevision: request.baseRevision,
        commands: [{ type: 'configureBlockPresentation', blockId: request.block.id, presentation: structuredClone(qa.patch) }] }, capabilityIds: [] })
      if (qa.defer) return new Promise(resolve => { qa.pending.push(() => resolve(response)) })
      return response
    })
    const current = createMochiHost(runtime, provider)
    qa.host = current; setOwner({runtime, host: current})
    return () => current.dispose()
  }, [runtime])
  if (!owner || owner.runtime !== runtime) return null
  const host = owner.host
  return <><p role="note">隔离验收：固定 JSON completion，不理解自然语言，不调用 AI。</p><MochiWorkshop key={host.getSnapshot().context.instanceId} runtime={runtime} host={host} /></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
