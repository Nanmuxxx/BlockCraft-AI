const {chromium}=require('playwright')
const assert=require('node:assert/strict')
const path=require('node:path')
const {once}=require('node:events')
async function main(){
 const {createAppServer}=await import('../../server/index.mjs')
 let calls=0
 const server=createAppServer({staticDir:path.resolve(__dirname,'../../dist'),apiKey:'',generationAccess:()=>false,fetchImpl:async()=>{calls++;throw Error('forbidden')}})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const browser=await chromium.launch({headless:true})
 try{
  const base=`http://127.0.0.1:${server.address().port}`
  const context=await browser.newContext({serviceWorkers:'block'})
  await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort())
  const page=await context.newPage();await page.goto(base+'/ai-create')
  await page.locator('#generation-mode').selectOption('gallery-fixture')
  await page.getByRole('button',{name:'打开离线图库',exact:true}).click()
  assert.equal(await page.locator('select[aria-label="图片生成方式"] option[value="HTTP_MOCK"]').count(),0)
  for(const [method,url]of [['POST','/api/image-generations'],['GET','/api/image-generations/11111111-1111-4111-8111-111111111111'],['POST','/api/image-generations/11111111-1111-4111-8111-111111111111/cancel']]){
   const response=await fetch(base+url,{method});assert.equal(response.status,404)
  }
  assert.equal(calls,0);console.log('PASS OFFLINE production: fixture option absent even with build flag, all image routes 404, provider calls=0')
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
}
main().catch(e=>{console.error(e);process.exitCode=1})
