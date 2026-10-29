import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {setTimeout as delay} from 'node:timers/promises'
const root='/Users/nanmuxun/BlockAI/BlockCraft-AI-image-http-phase2',out=process.env.QA_EVIDENCE_DIR||'/Users/nanmuxun/BlockAI/qa-evidence/pr98-retest-c55280a'
await fs.mkdir(out,{recursive:true})
const {createServer}=await import(root+'/node_modules/vite/dist/node/index.js')
const {createMockImageHandler}=await import(root+'/server/image-generation/coordinator.mjs')
const {chromium}=createRequire('/tmp/blockcraft-workshop-browser-tools/package.json')('playwright')
const {expect}=createRequire('/tmp/blockcraft-workshop-browser-tools/package.json')('playwright/test')
const requests=[],held=[];let holdA=true,uncertain=false
const handler=createMockImageHandler({fixture:true,resolveIdentity:()=> 'qa-owner',authorizeProject:(p,id)=>p==='qa-owner'&&id==='fixture-project',budget:{admit(){},settle(){if(uncertain)throw Error('synthetic-settlement-failure')}}})
const server=await createServer({root,define:{'import.meta.env.VITE_IMAGE_HTTP_FIXTURE':JSON.stringify('1')},server:{host:'127.0.0.1',port:0},plugins:[{name:'independent-delayed-http-get',configureServer(s){s.middlewares.use((req,res,next)=>{
 if(req.url.startsWith('/api/image-generations')){
  requests.push({method:req.method,path:req.url,tab:req.headers['x-qa-tab']})
  if(holdA&&req.headers['x-qa-tab']==='A'&&req.method==='GET'){held.push(()=>handler(req,res));return}
  void handler(req,res);return
 }
 if(req.url.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end('{}');return}next()
})}}]})
await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`,browser=await chromium.launch({headless:true})
const report={sha:'c55280a9c8b068d3cf5377e6c8e8c5806d5b379d',external:[],pageErrors:[]}
const until=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>5000)throw Error('PROBE_WAIT_LIMIT');await delay(10)}}
try{
 const context=await browser.newContext({viewport:{width:Number(process.env.QA_VIEWPORT_WIDTH||1440),height:1100},serviceWorkers:'block'})
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){report.external.push(route.request().url());return route.abort()}return route.continue()})
 const a=await context.newPage(),b=await context.newPage()
 for(const [page,tab]of [[a,'A'],[b,'B']]){await page.setExtraHTTPHeaders({'x-qa-tab':tab});page.on('pageerror',e=>report.pageErrors.push(e.message))}
 const generate=page=>page.getByRole('button',{name:'生成一张 HTTP Mock 测试图片',exact:true})
 const alert=page=>page.locator('.gallery-generation [role="alert"]')
 const review=page=>page.evaluate(()=>localStorage.getItem('blockcraft:image-review:1:fixture-project'))
 const posts=()=>requests.filter(x=>x.method==='POST'&&x.path==='/api/image-generations').length
 async function open(page){await page.goto(origin+'/ai-create');await page.locator('#generation-mode').selectOption('gallery-fixture');await page.getByRole('button',{name:'打开离线图库',exact:true}).click();const select=page.getByRole('combobox',{name:'图片生成方式',exact:true});if(await select.inputValue()!=='HTTP_MOCK')await select.selectOption('HTTP_MOCK')}
 await open(a);await open(b)
 await generate(a).click();await until(()=>held.length===1&&handler.audit().some(x=>x.event==='SUCCEEDED'))
 const first=JSON.parse(await review(a));report.firstJob=first
 await expect(generate(b)).toBeDisabled()
 await b.getByRole('button',{name:'核对原任务状态（不重试）',exact:true}).click()
 await expect(generate(b)).toBeEnabled();assert.equal(await review(b),null);assert.equal(posts(),1)
 report.authorizedFirstReconciliation={cleared:true,creates:posts()}
 uncertain=true
 await generate(b).click();await expect(alert(b)).toContainText('（UNCERTAIN）')
 const second=JSON.parse(await review(b));assert.notEqual(second.requestId,first.requestId)
 report.secondBeforeOldResponse={review:second,alert:await alert(b).innerText(),buttonDisabled:await generate(b).isDisabled(),creates:posts()}
 await b.screenshot({path:out+'/r1-cross-tab-before.png',fullPage:true})
 holdA=false;await Promise.all(held.splice(0).map(f=>f()))
 await expect(a.getByRole('img',{name:'待采用的 HTTP Mock 图片预览',exact:true})).toBeVisible()
 report.sharedLatchAfterOldSuccess=await review(a)
 report.secondServerAfterOldSuccess=await b.evaluate(async id=>await(await fetch('/api/image-generations/'+id)).json(),second.jobId)
 await open(b)
 report.afterReload={review:await review(b),buttonEnabled:await generate(b).isEnabled(),panel:await b.locator('.gallery-generation').innerText()}
 await b.screenshot({path:out+'/r1-cross-tab-after-reload.png',fullPage:true})
 if(await generate(b).isEnabled()){await generate(b).click();await expect(alert(b)).toContainText('（UNCERTAIN）')}
 report.createsAfterOrdinaryClick=posts();report.audit=handler.audit();report.requests=requests
 assert.equal(report.external.length,0);assert.equal(report.pageErrors.length,0)
 report.reproduced=report.sharedLatchAfterOldSuccess===null&&report.secondServerAfterOldSuccess.status==='UNCERTAIN'&&report.createsAfterOrdinaryClick===3
 console.log(JSON.stringify(report,null,2))
}finally{await fs.writeFile(out+'/r1-cross-tab-probe.json',JSON.stringify(report,null,2));await browser.close();await handler.close();await server.close()}
