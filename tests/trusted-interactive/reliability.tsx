// Test-only mixed project. Reuses the sole Runtime and unchanged formal Workshop.
import { StrictMode, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/styles.css'
import { createClubRegistrationExample } from '../../src/model/appSpecExamples'
import { createAppRuntime } from '../../src/model/appRuntime'
import { AppSpecWorkshop } from '../../src/components/app-builder/AppSpecWorkshop'
import { CustomBlockViewer } from '../../src/integrations/custom-block-bc/CustomBlockViewer'
const initial = createClubRegistrationExample()
initial.spec.version = 2
initial.spec.blocks.push({ id: 'reliable-timer', name: '可靠性番茄钟', type: 'pomodoro', protocolVersion: 1, durationSeconds: 6 })
initial.blockPositions['reliable-timer'] = { x: .5, y: .8 }
const runtime = createAppRuntime(initial)
const instance = { id: 'untrusted', definitionId: 'inert', versionDigest: `sha256:${'a'.repeat(64)}` as const, props: {} }
function Acceptance() {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  return <><p>离线可靠性验收：旧记录 + 可信番茄钟；不调用模型。</p><AppSpecWorkshop runtime={runtime} />
    <pre data-testid="reliability-snapshot">{JSON.stringify(state)}</pre>
    <div data-testid="untrusted-viewer"><CustomBlockViewer instance={instance} name="不可信 TSX 拒绝验证" observation={{ reference: { definitionId: instance.definitionId, versionDigest: instance.versionDigest }, status: 'runnable' }} /></div>
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Acceptance /></StrictMode>)
