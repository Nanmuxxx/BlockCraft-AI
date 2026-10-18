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
import { mockAddOptionalField } from '../../src/integrations/mochi/mockPlanner'
import { toMinimalPlanInput } from '../../src/integrations/mochi/planning'

const runtime = createAppRuntime(createClubRegistrationExample())
// Registered before Host/React observers: reproduce a real write whose early
// subscriber prevents the Host from receiving that revision notification.
const stopEarlySubscriber = runtime.subscribe(() => {
  if (qa.missNextNotification) { qa.missNextNotification = false; throw new Error('Offline early subscriber failure after write') }
})
let subscriptions = 0
const subscribe = runtime.subscribe
runtime.subscribe = listener => {
  subscriptions++
  const unsubscribe = subscribe(listener)
  return () => { subscriptions--; unsubscribe() }
}
const qa = { runtime, host: null as ReturnType<typeof createMochiHost> | null, failure: false, missNextNotification: false,
  defer: false, pending: [] as Array<{ resolve: () => void; reject: () => void }>, replaceHost: () => {},
  calls: 0, get subscriptions() { return subscriptions }, inputs: [] as unknown[], unmount: () => { stopEarlySubscriber(); root.unmount() } }
Object.assign(window, { mochiQA: qa })
function Fixture() {
  const [generation, setGeneration] = useState(0)
  qa.replaceHost = () => setGeneration(value => value + 1)
  const [host, setHost] = useState<ReturnType<typeof createMochiHost> | null>(null)
  useEffect(() => {
    const instance = createMochiHost(runtime, async request => {
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
