import {createAppRuntime} from '../../src/model/appRuntime.ts'
import {createGalleryPractice} from '../../src/integrations/gallery-generation/offline.ts'
import {createGalleryImageController} from '../../src/integrations/gallery-generation/controller.ts'
import {createHttpMockImageProvider} from '../../src/integrations/gallery-generation/http.ts'
import {createWorkspaceSession} from '../../src/integrations/project-workspace/session.ts'
import {workspaceRepository,createWorkspaceRepository} from '../../src/integrations/project-workspace/repository.ts'
const check=(x,message)=>{if(!x)throw Error(message||'HTTP integration assertion failed')}
const equal=(a,b)=>check(JSON.stringify(a)===JSON.stringify(b),'existing project/storage changed')
const wait=ms=>new Promise(r=>setTimeout(r,ms))
export async function httpCase(mode){
 const states=[]
 const runtime=createAppRuntime(createGalleryPractice())
 let failWrite=false
 const repository=mode==='storage'?createWorkspaceRepository({beforeWrite(){if(failWrite)throw new DOMException('fixture','QuotaExceededError')}}):workspaceRepository
 const workspace=createWorkspaceSession(runtime,{repository,sequence:(await workspaceRepository.read())?.sequence||0})
 const provider=createHttpMockImageProvider(mode==='forbidden'?'other-project':'fixture-project',x=>states.push(x),
   {pollMs:10,deadlineMs:mode==='deadline'?50:2000,requestTimeoutMs:mode==='request-timeout'?30:1000})
 const controller=createGalleryImageController(workspace,provider,10000,'HTTP_MOCK')
 try{
  await workspace.save()
  const before=runtime.customProject.getSnapshot(),saved=await workspaceRepository.read()
  const operation=controller.generate('HTTP fixture case','practice-gallery')
  if(mode==='cancel'){await wait(30);controller.cancel()}
  if(mode==='dispose'){await wait(30);controller.dispose()}
  await operation
  if(mode==='adopt'||mode==='storage'){
   check(controller.getSnapshot().phase==='ready',controller.getSnapshot().message)
   failWrite=mode==='storage'
   await Promise.all([controller.confirm(),controller.confirm()]);await controller.confirm()
   if(mode==='adopt'){
    check(controller.getSnapshot().phase==='adopted')
    const project=runtime.customProject.getSnapshot(),record=await workspaceRepository.read()
    check(Object.keys(project.base.assets).length===1);check(record.receipts.length===1)
    return {states,oneAsset:true,oneReceipt:true}
   }
  }
  check(!controller.getSnapshot().candidate||mode==='storage','failure retained candidate')
  equal(runtime.customProject.getSnapshot(),before);equal(await workspaceRepository.read(),saved)
  return {states,phase:controller.getSnapshot().phase,message:controller.getSnapshot().message,unchanged:true}
 }finally{controller.dispose();workspace.dispose()}
}
