const assert=require('node:assert/strict')
const {expect}=require('playwright/test')
const path=require('node:path')
const key='blockcraft:image-review:1:fixture-project'
const button=page=>page.getByRole('button',{name:'生成一张 HTTP Mock 测试图片',exact:true})
const alert=page=>page.locator('.gallery-generation [role="alert"]')
const review=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)
module.exports=async function ownership({browser,origin,fixture,width,output,report,openGallery,project}){
 const count=()=>fixture.requests.filter(x=>x.method==='POST'&&x.path==='/api/image-generations').length
 async function fresh(){
  const context=await browser.newContext({viewport:{width,height:1100},acceptDownloads:true,serviceWorkers:'block'})
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(report.externalRequests.push(route.request().url()),route.abort()))
  const a=await context.newPage(),b=await context.newPage()
  for(const [p,tab]of [[a,'A'],[b,'B']]){p.on('pageerror',e=>report.pageErrors.push(e.message));await p.setExtraHTTPHeaders({'x-rework-tab':tab})}
  return {context,a,b}
 }
 async function directGuard(page){
  return page.evaluate(async()=>{
   const {createHttpMockImageProvider}=await import('/src/integrations/gallery-generation/http.ts')
   const {createGalleryImageController}=await import('/src/integrations/gallery-generation/controller.ts')
   const {createAppRuntime}=await import('/src/model/appRuntime.ts')
   const {createGalleryPractice}=await import('/src/integrations/gallery-generation/offline.ts')
   const {createWorkspaceSession}=await import('/src/integrations/project-workspace/session.ts')
   const runtime=createAppRuntime(createGalleryPractice()),workspace=createWorkspaceSession(runtime,{sequence:0})
   const before=JSON.stringify(runtime.customProject.getSnapshot())
   const provider=createHttpMockImageProvider('fixture-project'),controller=createGalleryImageController(workspace,provider,10000,'MOCK')
   const result=[]
   for(let i=0;i<3;i++){
    await controller.generate('controller re-entry','practice-gallery')
    try{await provider.generate('provider re-entry',new AbortController().signal);result.push('UNSAFE')}catch(e){result.push(e.code)}
   }
   const candidate=controller.getSnapshot().candidate
   controller.dispose();workspace.dispose()
   return {result,candidate,unchanged:before===JSON.stringify(runtime.customProject.getSnapshot())}
  })
 }
 async function locked(page,second,initial){
  await expect(alert(page)).toContainText('核对前不要重新提交')
  await expect(alert(page)).toContainText(second.requestId);await expect(alert(page)).toContainText(second.jobId)
  await expect(button(page)).toBeDisabled()
  await expect(page.getByRole('combobox',{name:'图片生成方式',exact:true})).toBeDisabled()
  for(let i=0;i<3;i++)await button(page).evaluate(el=>el.click())
  assert.deepEqual(await directGuard(page),{result:Array(3).fill('IMAGE_REVIEW_REQUIRED'),candidate:null,unchanged:true})
  assert.deepEqual(await review(page),second)
  assert.equal(count()-initial,2)
  await expect(page.locator('.gallery-generation figure')).toHaveCount(0)
 }
 // Real loopback transitions and explicit held GET; no manually replacing/clearing locks.
 for(const outcome of ['success','failure','cancelled','network','unknown','abort','dispose','late-reconcile','j2-authorized']){
  const {context,a,b}=await fresh();const initial=count()
  try{
   fixture.controls.mode=outcome==='failure'?'fail':outcome==='cancelled'?'hang':'normal'
   fixture.controls.revoked=false;fixture.controls.holdTab='A'
   await openGallery(a);await openGallery(b)
   const original=await project(b)
   if(outcome==='success')await b.getByRole('combobox',{name:'图片生成方式',exact:true}).selectOption('MOCK')
   {
    await a.evaluate(async()=>{
     const {createHttpMockImageProvider}=await import('/src/integrations/gallery-generation/http.ts')
     const {createGalleryImageController}=await import('/src/integrations/gallery-generation/controller.ts')
     const {createAppRuntime}=await import('/src/model/appRuntime.ts')
     const {createGalleryPractice}=await import('/src/integrations/gallery-generation/offline.ts')
     const {createWorkspaceSession}=await import('/src/integrations/project-workspace/session.ts')
     window.oldWorkspace=createWorkspaceSession(createAppRuntime(createGalleryPractice()),{sequence:0})
     const provider=createHttpMockImageProvider('fixture-project'),generate=provider.generate.bind(provider)
     window.oldProviderDone=false
     provider.generate=(...args)=>generate(...args).finally(()=>window.oldProviderDone=true)
     window.oldController=createGalleryImageController(window.oldWorkspace,provider,10000,'HTTP_MOCK')
     window.oldDone=false;window.oldTask=window.oldController.generate('old controller','practice-gallery').finally(()=>window.oldDone=true)
    })
   }
   await expect.poll(()=>fixture.held.length).toBe(1)
   const first=await review(b);assert.ok(first.jobId)
   if(outcome==='cancelled')await b.evaluate(async id=>{await fetch('/api/image-generations/'+id+'/cancel',{method:'POST'})},first.jobId)
   const terminal=outcome==='failure'?'FAILED':outcome==='cancelled'?'CANCELLED':'SUCCEEDED'
   await expect.poll(async()=>b.evaluate(async id=>(await(await fetch('/api/image-generations/'+id)).json()).status,first.jobId)).toBe(terminal)
   if(outcome==='late-reconcile'){
    // Also hold a second, explicit reconciliation in A; both completions are stale later.
    await a.evaluate(async()=>{
     const {createHttpMockImageProvider}=await import('/src/integrations/gallery-generation/http.ts')
     window.lateReconcile=createHttpMockImageProvider('fixture-project').reconcile().then(value=>window.lateReconcileResult=value)
    })
    await expect.poll(()=>fixture.held.length).toBe(2)
   }
   await b.getByRole('button',{name:'核对原任务状态（不重试）',exact:true}).click()
   await expect(button(b)).toBeEnabled();assert.equal(await review(b),null)
   fixture.controls.mode=outcome==='j2-authorized'?'hang':'uncertain'
   await button(b).click()
   if(outcome==='j2-authorized'){
    await expect.poll(()=>review(b)).toMatchObject({jobId:expect.stringMatching(/^[a-f0-9-]{36}$/)})
    await b.getByRole('button',{name:'取消生成图片',exact:true}).click()
    await expect.poll(()=>review(b)).toMatchObject({state:'UNKNOWN'})
   }else await expect(alert(b)).toContainText('（UNCERTAIN）')
   const second=await review(b);assert.notEqual(first.requestId,second.requestId)
   if(outcome==='abort'||outcome==='dispose'){
    await a.evaluate(outcome=>window.oldController[outcome==='abort'?'cancel':'dispose'](),outcome)
    await expect.poll(()=>a.evaluate(()=>window.oldDone)).toBe(true)
   }
   fixture.releaseHeld(outcome==='network'||outcome==='unknown'?outcome:'normal')
   if(outcome==='late-reconcile')await expect.poll(()=>a.evaluate(()=>window.lateReconcileResult)).toBe(false)
   // Wait for original provider's actual promise, not an arbitrary sleep or J2's early UI event.
   await expect.poll(()=>a.evaluate(()=>window.oldDone&&window.oldProviderDone)).toBe(true)
   assert.equal(await a.evaluate(()=>window.oldController.getSnapshot().candidate),null)
   await expect(a.locator('.gallery-generation figure')).toHaveCount(0)
   await locked(b,second,initial)
   await openGallery(b);await locked(b,second,initial)
   // Remount a second controller and verify no project save/adoption was triggered.
   assert.deepEqual(await project(b),original)
   assert.equal(await b.evaluate(async()=>(await import('/src/integrations/project-workspace/repository.ts')).workspaceRepository.read()),null)
   fixture.controls.revoked=true
   assert.equal(await b.evaluate(async()=> (await import('/src/integrations/gallery-generation/http.ts')).createHttpMockImageProvider('fixture-project').reconcile()),false)
   fixture.controls.revoked=false
   const released=await b.evaluate(async()=> (await import('/src/integrations/gallery-generation/http.ts')).createHttpMockImageProvider('fixture-project').reconcile())
   assert.equal(released,outcome==='j2-authorized')
   if(!released)await locked(b,second,initial)
   else {
    assert.equal(await review(b),null);assert.equal(count()-initial,2)
    await expect(b.locator('.gallery-generation figure')).toHaveCount(0)
    assert.deepEqual(await project(b),original)
   }
   const serverState=await b.evaluate(async id=>await(await fetch('/api/image-generations/'+id)).json(),second.jobId)
   assert.equal(serverState.status,outcome==='j2-authorized'?'CANCELLED':'UNCERTAIN');assert.equal(serverState.charge,outcome==='j2-authorized'?'NONE':'UNCERTAIN')
   await b.screenshot({path:path.join(output,'stale-'+outcome+'.png'),fullPage:true})
   report.cases.push({scenario:'stale-'+outcome,passed:true,first,second,creates:count()-initial,serverStatus:serverState.status,serverCharge:serverState.charge,unchanged:true})
  }finally{fixture.releaseHeld();await context.close()}
 }
 // Serialized simultaneous admissions: both pages enter provider before either can claim.
 {
  const {context,a,b}=await fresh();const initial=count();fixture.controls.mode='uncertain'
  try{
   await openGallery(a);await openGallery(b)
   await a.evaluate(async key=>{
    window.gateReady=false
    void navigator.locks.request(key,()=>new Promise(resolve=>{window.releaseAdmission=resolve;window.gateReady=true}))
   },key)
   await expect.poll(()=>a.evaluate(()=>window.gateReady)).toBe(true)
   for(const page of [a,b])await page.evaluate(async()=>{
    const {createHttpMockImageProvider}=await import('/src/integrations/gallery-generation/http.ts')
    window.race=createHttpMockImageProvider('fixture-project').generate('simultaneous',new AbortController().signal).then(()=>window.raceResult='UNSAFE',e=>window.raceResult=e.code)
   })
   await expect.poll(()=>a.evaluate(async()=> (await navigator.locks.query()).pending.length)).toBe(2)
   await a.evaluate(()=>window.releaseAdmission())
   for(const page of [a,b])await expect.poll(()=>page.evaluate(()=>window.raceResult)).toBe('IMAGE_REVIEW_REQUIRED')
   assert.equal(count()-initial,1);assert.equal((await review(b)).state,'UNCERTAIN')
   report.cases.push({scenario:'atomic-two-tab-admission',passed:true,creates:1})
  }finally{await context.close()}
 }
 // Each fault uses a fresh storage partition; no personal browser or product storage reset.
 for(const fault of ['bad-json','null-json','invalid-schema','read','write','remove','coordination-missing','coordination-reject','coordination-timeout']){
  const {context,a,b}=await fresh();const initial=count();fixture.controls.mode='normal'
  try{
   await openGallery(a);await openGallery(b)
   if(fault==='remove'){
    fixture.controls.holdTab='A';await button(a).click();await expect.poll(()=>fixture.held.length).toBe(1)
    const first=await review(b)
    await expect.poll(()=>b.evaluate(async id=>(await(await fetch('/api/image-generations/'+id)).json()).status,first.jobId)).toBe('SUCCEEDED')
   }
   await b.evaluate(({fault,key})=>{
    if(fault==='bad-json')localStorage.setItem(key,'{')
    if(fault==='null-json')localStorage.setItem(key,'null')
    if(fault==='invalid-schema')localStorage.setItem(key,'{}')
    if(['read','write','remove'].includes(fault)){
     const method={read:'getItem',write:'setItem',remove:'removeItem'}[fault],original=Storage.prototype[method]
     Storage.prototype[method]=function(k,...args){if(k===key)throw new DOMException('injected storage fault','QuotaExceededError');return original.call(this,k,...args)}
     window.restoreFault=()=>Storage.prototype[method]=original
    }
    if(fault==='coordination-missing')Object.defineProperty(navigator,'locks',{value:undefined,configurable:true})
    if(fault==='coordination-reject')navigator.locks.request=()=>Promise.reject(new DOMException('injected lock failure','SecurityError'))
   },{fault,key})
   if(fault==='coordination-timeout'){
    await a.evaluate(key=>{window.gateReady=false;void navigator.locks.request(key,()=>new Promise(r=>{window.releaseAdmission=r;window.gateReady=true}))},key)
    await expect.poll(()=>a.evaluate(()=>window.gateReady)).toBe(true)
   }
   if(fault==='remove'){
    assert.equal(await b.evaluate(async()=> (await import('/src/integrations/gallery-generation/http.ts')).createHttpMockImageProvider('fixture-project').reconcile()),false)
   }
   const guarded=await directGuard(b)
   assert.deepEqual(guarded,{result:Array(3).fill('IMAGE_REVIEW_REQUIRED'),candidate:null,unchanged:true})
   assert.equal(count()-initial,fault==='remove'?1:0)
   if(fault==='remove'){
    await b.evaluate(()=>window.restoreFault())
    assert.equal(await b.evaluate(async()=> (await import('/src/integrations/gallery-generation/http.ts')).createHttpMockImageProvider('fixture-project').reconcile()),true)
    assert.equal(await review(b),null)
   }
   if(fault==='coordination-timeout')await a.evaluate(()=>window.releaseAdmission())
   report.cases.push({scenario:'fail-closed-'+fault,passed:true,creates:count()-initial})
  }finally{fixture.releaseHeld();await context.close()}
 }
}
