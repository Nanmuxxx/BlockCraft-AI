import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/pixelify-sans/latin-500.css'
import '@fontsource/pixelify-sans/latin-700.css'
import '../../src/styles.css'
import { AppSpecWorkshop } from '../../src/components/app-builder/AppSpecWorkshop'
import { createAppRuntime, type AppRuntime } from '../../src/model/appRuntime'
import { createClubRegistrationExample } from '../../src/model/appSpecExamples'
import { generateProject } from '../../src/components/ai-create/generateApp'
import { parseCustomProject } from '../../src/custom-block'

const qa = { runtime: null as AppRuntime | null,
  roundTrip: async () => parseCustomProject(JSON.parse(JSON.stringify(qa.runtime!.customProject.getSnapshot())), qa.runtime!.customProject.registry) }
Object.assign(window, { fieldQA: qa })
function Fixture() {
  const [runtime, setRuntime] = useState<AppRuntime | null>(() => new URLSearchParams(location.search).has('generate') ? null : createAppRuntime(createClubRegistrationExample()))
  const [pending, setPending] = useState(false), [error, setError] = useState('')
  qa.runtime = runtime
  return <>
    <p role="note">MVP 验收入口：使用正式 Workshop、HTTP Provider、计划宿主与 Runtime；是否真实调用以服务端账本为准。</p>
    {!runtime && <button type="button" disabled={pending} onClick={async () => {
      setPending(true); setError('')
      try { setRuntime(createAppRuntime(await generateProject('创建社团报名工具。一个报名者实体，姓名是必填文本，部门是必填选项（技术部、宣传部），邮箱是可选文本。三个积木依次为报名表、报名名单、报名人数统计，绑定同一实体。表单和名单都显示姓名、部门、邮箱。', new AbortController().signal))) }
      catch (e) { setError(e instanceof Error ? e.message : '生成失败') }
      finally { setPending(false) }
    }}>生成社团报名应用</button>}
    {error && <p role="alert">{error}</p>}
    {runtime && <AppSpecWorkshop runtime={runtime} />}
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
