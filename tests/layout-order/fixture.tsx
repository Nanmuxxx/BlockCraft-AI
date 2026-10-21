import { createRoot } from 'react-dom/client'
import { createAppRuntime } from '../../src/model/appRuntime'
import { initializeGeneratedProject } from '../../src/components/ai-create/generateApp'
import { clubRegistrationSpec } from '../../src/model/appSpecExamples'
import { AppSpecWorkshop } from '../../src/components/app-builder/AppSpecWorkshop'
import { parseCustomProject } from '../../src/custom-block'
import '../../src/styles.css'

const runtime = createAppRuntime(initializeGeneratedProject(clubRegistrationSpec))
Object.assign(window, { orderQA: { runtime, roundTrip: () => parseCustomProject(JSON.parse(JSON.stringify(runtime.customProject.getSnapshot())), runtime.customProject.registry) } })
createRoot(document.getElementById('root')!).render(<AppSpecWorkshop runtime={runtime} />)
