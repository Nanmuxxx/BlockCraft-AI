// Real loopback handler, fresh contexts. Routing injects connection loss, never image success.
const {chromium}=require('playwright')
const {expect}=require('playwright/test')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const path=require('node:path')
const {execFileSync}=require('node:child_process')
const ownRoot=path.resolve(__dirname,'../..')
const root=path.resolve(process.env.GALLERY_SOURCE_ROOT||ownRoot)
const before=process.env.REWORK_EXPECT_BEFORE==='1'
const width=Number(process.env.GALLERY_VIEWPORT_WIDTH||1440)
const output=path.resolve(process.env.GALLERY_EVIDENCE_DIR||path.join(ownRoot,'.cache/image-rework/dom-'+width))
const report={mode:'HTTP MOCK REWORK',before,width,cases:[],pageErrors:[],externalRequests:[]}
async function main(){
 await fs.mkdir(output,{recursive:true})
 const {createServer}=await import('vite')
 const {createHttpMockFixture}=await import('./fixture.mjs')
 const fixture=createHttpMockFixture()
 const server=await createServer({root,define:{'import.meta.env.VITE_IMAGE_HTTP_FIXTURE':JSON.stringify('1')},
  server:{host:'127.0.0.1',port:0,fs:{allow:[root,ownRoot]}},plugins:[fixture.plugin,{name:'deny-non-image-apis',configureServer(s){
   s.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/api/'))return next();res.writeHead(503,{'Content-Type':'application/json'});res.end('{"enabled":false}')})
  }}]})
 let browser
 const contexts=[]
 try{
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
  browser=await chromium.launch({headless:true})
  report.environment={node:process.version,platform:process.platform,browser:browser.version(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()}
  if(process.env.GALLERY_EXPECTED_SHA)assert.equal(report.environment.head,process.env.GALLERY_EXPECTED_SHA)
  const generate='生成一张 HTTP Mock 测试图片'
  const postCount=()=>fixture.requests.filter(x=>x.method==='POST'&&x.path==='/api/image-generations').length
  async function openGallery(page){
   await page.goto(origin+'/ai-create')
   await page.locator('#generation-mode').selectOption('gallery-fixture')
   await page.getByRole('button',{name:'打开离线图库',exact:true}).click()
   const select=page.getByRole('combobox',{name:'图片生成方式',exact:true})
   if(await select.inputValue()!=='HTTP_MOCK')await select.selectOption('HTTP_MOCK')
  }
  async function project(page){
   const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载项目 JSON',exact:true}).click()
   const download=await pending;return JSON.parse(await fs.readFile(await download.path(),'utf8')).project
  }
  async function locked(page,requestId,jobId,initialPosts){
   const panel=page.locator('.gallery-generation'),alert=panel.getByRole('alert')
   await expect(alert).toContainText('任务/费用状态未确认')
   await expect(alert).toContainText('核对前不要重新提交')
   await expect(alert).toContainText(requestId)
   await expect(alert).toContainText(jobId||'任务 ID：未取得')
   await expect(page.getByRole('button',{name:generate,exact:true})).toBeDisabled()
   for(let n=0;n<3;n++)await page.getByRole('button',{name:generate,exact:true}).evaluate(el=>el.click())
   const guarded=await page.evaluate(async()=>{
    const {createHttpMockImageProvider}=await import('/src/integrations/gallery-generation/http.ts')
    const provider=createHttpMockImageProvider('fixture-project')
    return Promise.all([1,2,3].map(async()=>{try{await provider.generate('no new key',new AbortController().signal);return 'UNSAFE'}catch(error){return error.code}}))
   })
   assert.deepEqual(guarded,['IMAGE_REVIEW_REQUIRED','IMAGE_REVIEW_REQUIRED','IMAGE_REVIEW_REQUIRED'])
   await expect(panel.locator('figure')).toHaveCount(0)
   await expect(panel.getByRole('button',{name:'确认采用并保存',exact:true})).toHaveCount(0)
   assert.equal(postCount()-initialPosts,1)
  }
  const scenarios=before?['uncertain']:['uncertain','lost-create','lost-cancel','unknown-job','poll-network']
  for(const scenario of scenarios){
   fixture.controls.mode=scenario==='uncertain'?'uncertain':scenario==='lost-cancel'?'hang':'normal';fixture.controls.revoked=false
   const context=await browser.newContext({viewport:{width,height:1100},acceptDownloads:true,serviceWorkers:'block'});contexts.push(context)
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue(): (report.externalRequests.push(route.request().url()),route.abort()))
   const page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message))
   await openGallery(page)
   const original=await project(page),initialPosts=postCount()
   const getReview=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('blockcraft:image-review:1:fixture-project')))
   if(scenario==='lost-create')await page.route('**/api/image-generations',async route=>{await route.fetch();await route.abort('connectionreset')})
   if(scenario==='lost-cancel')await page.route('**/api/image-generations/*/cancel',async route=>{await route.fetch();await route.abort('connectionreset')})
   if(scenario==='unknown-job'||scenario==='poll-network')await page.route('**/api/image-generations/*',route=>{
    if(route.request().method()!=='GET')return route.continue()
    return scenario==='poll-network'?route.abort('connectionreset'):route.continue({url:origin+'/api/image-generations/11111111-1111-4111-8111-111111111111'})
   })
   await page.getByRole('button',{name:generate,exact:true}).click()
   if(scenario==='lost-cancel'){
    await expect.poll(getReview).toMatchObject({jobId:expect.stringMatching(/^[a-f0-9-]{36}$/)})
    await page.getByRole('button',{name:'取消生成图片',exact:true}).click()
   }
   const alert=page.locator('.gallery-generation').getByRole('alert')
   await expect(alert).toBeVisible()
   if(before){
    const text=await alert.innerText();assert.ok(!text.includes('UNCERTAIN'))
    await expect(page.getByRole('button',{name:generate,exact:true})).toBeEnabled()
    await page.getByRole('button',{name:generate,exact:true}).click();await expect.poll(()=>postCount()-initialPosts).toBe(2)
    report.cases.push({scenario,reproduced:true,finalAlert:text,creates:2,noCandidate:await page.locator('.gallery-generation figure').count()===0})
   }else{
    const review=await getReview();assert.ok(review);if(scenario==='uncertain')assert.equal(review.state,'UNCERTAIN')
    if(scenario==='lost-create')assert.equal(review.jobId,null);else assert.match(review.jobId,/^[a-f0-9-]{36}$/)
    await locked(page,review.requestId,review.jobId,initialPosts)
    assert.deepEqual(await project(page),original)
    assert.equal(await page.evaluate(async()=>(await import('/src/integrations/project-workspace/repository.ts')).workspaceRepository.read()),null)
    if(scenario==='uncertain'||scenario==='unknown-job'){
     await page.getByRole('button',{name:'核对原任务状态（不重试）',exact:true}).click()
     await locked(page,review.requestId,review.jobId,initialPosts)
    }
    if(scenario==='lost-cancel'){
     fixture.controls.revoked=true
     await page.getByRole('button',{name:'核对原任务状态（不重试）',exact:true}).click();await page.waitForTimeout(100)
     await locked(page,review.requestId,review.jobId,initialPosts)
     fixture.controls.revoked=false
     await page.getByRole('button',{name:'核对原任务状态（不重试）',exact:true}).click()
     await expect(page.getByRole('button',{name:generate,exact:true})).toBeEnabled();assert.equal(postCount()-initialPosts,1)
     assert.equal(await getReview(),null)
    }else{
     if(!review.jobId)await expect(page.getByRole('button',{name:'核对原任务状态（不重试）',exact:true})).toBeDisabled()
     await page.reload();await openGallery(page);await locked(page,review.requestId,review.jobId,initialPosts)
    }
    await page.screenshot({path:path.join(output,scenario+'.png'),fullPage:true})
    report.cases.push({scenario,passed:true,review,creates:postCount()-initialPosts,unchanged:true})
   }
   await context.close()
  }
  assert.deepEqual(report.externalRequests,[]);assert.deepEqual(report.pageErrors,[]);report.passed=true
 }catch(error){report.error=error.stack;throw error}
 finally{for(const context of contexts)await context.close().catch(()=>{});await browser?.close();await fixture.handler.close();await server.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))}
}
const watchdog=setTimeout(()=>{console.error('REWORK_BROWSER_DEADLINE_EXCEEDED');process.exit(1)},180000)
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>clearTimeout(watchdog))
