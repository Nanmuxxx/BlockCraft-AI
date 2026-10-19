const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
const { expect } = require((process.env.QA_PLAYWRIGHT_MODULE || 'playwright') + '/test');
const root=path.resolve(process.env.QA_SOURCE_DIR || path.join(__dirname,'../..')), out=path.resolve(process.env.DEPLOYMENT_QA_EVIDENCE || path.join(root,'docs/acceptance/deployment-support/local')), base='http://127.0.0.1:17860';
fs.mkdirSync(out,{recursive:true});
const report={sha:'4a95cae50f772cd242d932cdbd93366381d1df74',environment:'Windows Node '+process.version,scope:'production-built local CLI; real local HTTP, no API response mocks, server fetch blocked, synthetic key only',http:[],cases:[],errors:[],external:[]};
const env={};for(const [k,v] of Object.entries(process.env))if(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','LOCALAPPDATA','APPDATA','USERPROFILE','COMSPEC','PATHEXT'].includes(k.toUpperCase()))env[k]=v;
Object.assign(env,{NODE_ENV:'production',PORT:'17860',DEEPSEEK_API_KEY:'offline-synthetic-not-a-real-key',QA_EGRESS_LOG:path.join(out,'egress.log')});
fs.writeFileSync(env.QA_EGRESS_LOG,'');
const child=spawn(process.execPath,['--import',require('node:url').pathToFileURL(path.join(__dirname,'deny-egress.mjs')).href,'server/index.mjs'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
async function request(url,options){const r=await fetch(base+url,{...options,signal:AbortSignal.timeout(5000)}); const text=await r.text();report.http.push({path:url,method:options?.method||'GET',status:r.status,type:r.headers.get('content-type'),body:url.startsWith('/api')?text:undefined});return {r,text};}
async function main(){
 let browser;
 try{
  for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  for(const route of ['/','/ai-create','/app-renderer']){const {r,text}=await request(route);assert.equal(r.status,200);assert.match(text,/<div id="root"/);for(const m of text.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g))assert.equal((await request(m[1])).r.status,200);}
  for(const route of ['/api/unknown','/assets/missing.js','/api/local-project-export'])assert.equal((await request(route)).r.status,404);
  for(const payload of [{idea:'offline rejection'},{idea:'offline rejection',protocol:'trusted-interactive/1'}])for(const forged of [false,true]){
   const {r,text}=await request('/api/ai/generate',{method:'POST',headers:{'Content-Type':'application/json',...(forged?{Authorization:'Bearer offline-forged-token',Origin:base,'X-Forwarded-For':'127.0.0.1'}:{})},body:JSON.stringify(payload)});
   assert.equal(r.status,401);assert.equal(JSON.parse(text).error.code,'UNAUTHORIZED');
  }
  const status=await request('/api/mochi-ai/status');assert.equal(status.r.status,200);assert.equal(JSON.parse(status.text).enabled,false);
  assert.equal((await request('/api/mochi-ai/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).r.status,503);
  browser=await chromium.launch({headless:true});report.browser=browser.version();
  for(const width of [1440,390]){
   const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await ctx.newPage();const errors=[],consoleErrors=[],httpErrors=[],generation=[],requests=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()})});
   await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base){report.external.push(u.origin+u.pathname);return route.abort();}requests.push({method:route.request().method(),path:u.pathname});if(u.pathname==='/api/ai/generate')generation.push(route.request().method());return route.continue();});
   await page.goto(base);await expect(page.locator('#root')).not.toBeEmpty();await page.screenshot({path:path.join(out,`home-${width}.png`),fullPage:true});
   await page.goto(base+'/ai-create');await expect(page.getByRole('complementary',{name:'Mochi 展示区'})).toBeVisible();await page.screenshot({path:path.join(out,`entry-${width}.png`),fullPage:true});
   await page.getByLabel('创建方式',{exact:true}).selectOption('trusted-fixture');await page.getByRole('button',{name:'加载离线番茄钟',exact:true}).click();
   const b=page.getByRole('button',{name:'B 模式 · 编辑积木',exact:true}),c=page.getByRole('button',{name:'C 模式 · 运行应用',exact:true});
   await expect(b).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-block-key]')).toHaveCount(1);await expect(page.getByLabel('当前应用来源',{exact:true})).toContainText('离线固定 Fixture');
   await page.getByRole('button',{name:'数学专注',exact:true}).click();await expect(page.getByRole('complementary',{name:'积木属性',exact:true})).toBeVisible();await expect(page.locator('[data-workshop-panel="mochi"]')).toBeVisible();
   await page.screenshot({path:path.join(out,`editor-${width}.png`),fullPage:true});
   await c.click();const timer=page.getByRole('region',{name:'数学专注',exact:true}),time=timer.getByLabel('剩余时间');await expect(time).toHaveText('25:00');await timer.getByRole('button',{name:'开始',exact:true}).click();await expect(time).not.toHaveText('25:00');
   await timer.getByRole('button',{name:'暂停',exact:true}).click();const paused=await time.textContent();await page.waitForTimeout(1100);await expect(time).toHaveText(paused);
   for(let n=0;n<3;n++){await b.click();await c.click();await expect(time).toHaveText(paused);}
   await timer.getByRole('button',{name:'重置',exact:true}).click();await expect(time).toHaveText('25:00');await page.screenshot({path:path.join(out,`runtime-${width}.png`),fullPage:true});assert.equal(generation.length,0,'offline demo must have zero generation requests');
   await page.getByRole('button',{name:'导出 React 项目',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'暂不支持 React ZIP 导出'})).toBeVisible();
   const details=page.locator('.ai-create-regenerate');if(!await details.evaluate(e=>e.open))await details.locator('summary').click();await page.getByLabel('创建方式',{exact:true}).selectOption('legacy-v1');await page.getByLabel('你想做什么软件？').fill('QA: must reject without trusted authorization');await page.getByRole('button',{name:'生成新应用',exact:true}).click();await expect(page.locator('.ai-create-error')).toContainText('当前应用和数据已保留');await expect(time).toHaveText('25:00');
   await page.screenshot({path:path.join(out,`denied-${width}.png`),fullPage:true});
   for(let i=0;i<2;i++){await page.reload();await expect(page.getByLabel('创建方式',{exact:true})).toBeVisible();}
   await page.getByLabel('创建方式',{exact:true}).selectOption('trusted-fixture');await page.getByRole('button',{name:'加载离线番茄钟',exact:true}).click();await expect(b).toHaveAttribute('aria-pressed','true');
   await page.goto(base+'/app-renderer');await expect(page.locator('#root')).not.toBeEmpty();
   assert.deepEqual(errors,[]);assert.deepEqual(httpErrors.filter(x=>!x.url.endsWith('/api/ai/generate')||x.status!==401),[]);assert.deepEqual(consoleErrors.filter(x=>!x.includes('401')),[]);
   report.cases.push({width,status:'PASS',pageErrors:errors,consoleErrors,httpErrors,generationRequests:generation.length,offlineGenerationRequests:0,requests,checks:['home/editor/Mochi visible','bundled offline timer','B selection and inspector','C start/pause/reset','three B/C round trips','ZIP unsupported error','real local 401 preserves app','two reloads and re-entry','app-renderer route']});await ctx.close();
  }
  assert.deepEqual(report.external,[]);assert.equal(fs.readFileSync(env.QA_EGRESS_LOG,'utf8'),'');report.serverFetchAttempts=0;report.realModelCalls=0;
 }catch(e){report.errors.push(e.stack);process.exitCode=1;}
 finally{if(browser)await browser.close();if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}fs.writeFileSync(path.join(out,'cli.log'),logs);fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({cases:report.cases.map(c=>({width:c.width,status:c.status})),errors:report.errors,serverFetchAttempts:report.serverFetchAttempts}));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
