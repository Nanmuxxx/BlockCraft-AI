// Offline browser-only fixture. Real Workshop/Runtime; explicitly fixed Mock planner.
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import { MochiWorkshop } from '../../src/components/app-builder/AppSpecWorkshop'
import { createAppRuntime } from '../../src/model/appRuntime'
import { createClubRegistrationExample } from '../../src/model/appSpecExamples'
import { createMochiHost } from '../../src/integrations/mochi/host'
import { mockAddOptionalField } from '../../src/integrations/mochi/mockPlanner'

const runtime = createAppRuntime(createClubRegistrationExample())
const qa = { runtime, host: null as ReturnType<typeof createMochiHost> | null, failure: false, unmount: () => root.unmount() }
Object.assign(window, { motionQA: qa })
function Fixture() {
  const [host, setHost] = useState<ReturnType<typeof createMochiHost> | null>(null)
  useEffect(() => {
    const instance = createMochiHost(runtime, async request => {
      await new Promise(resolve => setTimeout(resolve, 1200))
      if (qa.failure) throw new Error('Offline browser fixture failure')
      return mockAddOptionalField(request)
    })
    qa.host = instance; setHost(instance)
    return () => { instance.dispose(); qa.host = null }
  }, [])
  return host ? <><p role="note">动画离线验收 · 固定 Mock 计划，不调用 AI</p><MochiWorkshop runtime={runtime} host={host} /></> : null
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Fixture /></StrictMode>)
