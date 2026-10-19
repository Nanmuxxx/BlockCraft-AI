// Independent QA: production-built route, no application instrumentation or model calls.
const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
require('../custom-block/fixtures.cjs')
const { DEMO_GALLERY } = require('../../src/model/appSpecExamples.ts')
const root = path.resolve(__dirname, '../..')
const out = path.join(root, 'docs/acceptance/gallery-qa')
const sha = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
const report = {codeSha:sha,baseSha:execFileSync('git',['rev-parse','HEAD^'],{cwd:root,encoding:'utf8'}).trim(),classification:'OFFLINE FIXTURES; real Gallery /ai-create production build; no model generation or replay',viewports:[[1440,900],[390,844]],cases:[],pageErrors:[],consoleErrors:[],network:[],unexpectedNetwork:[],httpErrors:[],screenshots:[],liveCalls:0}
function metricExpected(state, block, records) {
 const entity=state.spec.relations.find(r=>r.blockId===block.id).entityId
 const rows=records[entity]||[]
 if(block.aggregation==='count')return rows.length
 const values=rows.map(r=>r.values[block.fieldId]).filter(v=>typeof v==='number')
 const sum=values.reduce((a,b)=>a+b,0);return block.aggregation==='sum'?sum:values.length?sum/values.length:0
}
async function run(){
 const { preview }=await import('vite');const server=await preview({root,preview:{host:'127.0.0.1',port:5205,strictPort:true}})
 let browser,page
 try {
  await fs.mkdir(path.join(out,'screenshots'),{recursive:true});browser=await chromium.launch({headless:true});report.chromium=browser.version()
  for(const [width,height] of report.viewports) {
   for(let idx=0;idx<DEMO_GALLERY.length;idx++){
    const item=DEMO_GALLERY[idx],state=item.create(),records=structuredClone(state.records),caseId=`${item.id}-${width}`
    page=await browser.newPage({viewport:{width,height},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'})
    page.on('pageerror',e=>report.pageErrors.push({caseId,text:e.message}));page.on('console',e=>{if(e.type()==='error')report.consoleErrors.push({caseId,text:e.text()})})
    page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({caseId,status:r.status(),url:r.url()})})
    await page.route('**/*',route=>{const req=route.request(),url=new URL(req.url());report.network.push({caseId,method:req.method(),path:url.pathname})
     if(url.hostname==='127.0.0.1'&&url.pathname==='/api/mochi-ai/status'&&req.method()==='GET')return route.fulfill({json:{enabled:false,proactiveEnabled:false,modificationsEnabled:false,reason:'ACCESS_UNAVAILABLE'}})
     if(url.hostname==='127.0.0.1'&&req.method()==='GET'&&!url.pathname.startsWith('/api/'))return route.continue()
     report.unexpectedNetwork.push({caseId,url:req.url(),method:req.method()});return route.abort()
    })
    const shot=async label=>{const name=`screenshots/${caseId}-${label}.png`;await page.screenshot({path:path.join(out,name),fullPage:true});report.screenshots.push({caseId,label,path:name})}
    await page.goto('http://127.0.0.1:5205/');await page.getByRole('link',{name:'探索应用案例',exact:true}).click()
    await expect(page.locator('.demo-gallery__card')).toHaveCount(6)
    for(const demo of DEMO_GALLERY){const card=page.locator('.demo-gallery__card').filter({has:page.getByRole('heading',{name:demo.name,exact:true})});await expect(card).toContainText('离线应用示例')}
    if(idx===0)await shot('gallery')
    const choose=async name=>{await page.getByRole('button',{name:'查看案例',exact:true}).click();await page.locator('.demo-gallery__card').filter({has:page.getByRole('heading',{name,exact:true})}).getByRole('button',{name:'加载到工作台'}).click()}
    await page.locator('.demo-gallery__card').filter({has:page.getByRole('heading',{name:item.name,exact:true})}).getByRole('button',{name:'加载到工作台'}).click()
    const workshop=page.getByRole('region',{name:'生成的应用',exact:true}),source=page.getByLabel('当前应用来源')
    await expect(workshop).toBeVisible();await expect(source).toContainText(`离线应用示例 · ${item.name} · AppSpec Fixture（非实时 AI 生成）`)
    const b=page.getByRole('button',{name:'B 模式 · 编辑积木',exact:true}),c=page.getByRole('button',{name:'C 模式 · 运行应用',exact:true})
    const formBlock=state.spec.blocks.find(x=>x.type==='form'), listBlock=state.spec.blocks.find(x=>x.type==='list')
    await page.locator(`[data-block-key="builtin:${formBlock.id}"]`).click()
    const inspector=page.getByRole('complementary',{name:'积木属性',exact:true})
    const fieldName=`QA备注${width}`;await inspector.getByLabel('字段名称',{exact:true}).fill(fieldName);await inspector.getByRole('button',{name:'新增字段',exact:true}).click()
    await expect(inspector.getByRole('status')).toContainText('实体字段已新增')
    await inspector.getByRole('checkbox',{name:`展示 ${fieldName}`,exact:true}).check()
    await page.locator(`[data-block-key="builtin:${listBlock.id}"]`).click();await inspector.getByRole('checkbox',{name:`展示 ${fieldName}`,exact:true}).check()
    await shot('B-edited');await c.click()
    const form=page.locator('.renderer-block--form'),list=page.getByRole('region',{name:listBlock.name,exact:true})
    await expect(form.getByLabel(fieldName,{exact:true})).toBeVisible();await expect(list.getByRole('columnheader',{name:fieldName,exact:true})).toBeVisible()
    const entity=state.spec.entities.find(e=>e.id===state.spec.relations.find(r=>r.blockId===formBlock.id).entityId)
    const values={},textField=entity.fields.find(f=>f.type==='text'),numeric=entity.fields.find(f=>f.type==='number')
    for(const field of entity.fields){
     const control=form.getByLabel(field.name,{exact:false});const value=field.type==='text'?`QA-${caseId}-${field.id}`:field.type==='date'?'2026-10-19':field.type==='number'?7:field.type==='boolean'?true:field.options[0];values[field.id]=value
     if(field.type==='select'||field.type==='boolean')await control.selectOption(String(value));else await control.fill(String(value))
    }
    await form.getByLabel(fieldName,{exact:true}).fill(`创建-${caseId}`)
    const initialRows=records[entity.id].length
    const metrics=state.spec.blocks.filter(x=>x.type==='metric')
    const checkMetrics=async()=>{for(const block of metrics)await expect(page.getByRole('region',{name:block.name,exact:true}).locator('output')).toHaveText(metricExpected(state,block,records).toLocaleString('zh-CN',{maximumFractionDigits:2}))}
    await checkMetrics();await form.getByRole('button',{name:'提交',exact:true}).click()
    records[entity.id].push({id:'qa',values:{...values}})
    await expect(list.locator('tbody tr')).toHaveCount(initialRows+1);await checkMetrics()
    let row=list.locator('tbody tr').filter({hasText:values[textField.id]});await expect(row).toHaveCount(1);await expect(row).toContainText(`创建-${caseId}`)
    await row.getByRole('button',{name:'编辑',exact:true}).click()
    const editor=list.locator('form');await editor.getByLabel(textField.name,{exact:false}).fill(`EDIT-${caseId}`)
    if(numeric)await editor.getByLabel(numeric.name,{exact:false}).fill('11')
    await editor.getByLabel(fieldName,{exact:true}).fill(`保留-${caseId}`);await editor.getByRole('button',{name:'保存修改',exact:true}).click()
    records[entity.id].at(-1).values[textField.id]=`EDIT-${caseId}`;if(numeric)records[entity.id].at(-1).values[numeric.id]=11
    row=list.locator('tbody tr').filter({hasText:`EDIT-${caseId}`});await expect(row).toHaveCount(1);await expect(row).toContainText(`保留-${caseId}`);await checkMetrics()
    for(let n=0;n<3;n++){await b.click();await c.click()}
    await expect(row).toHaveCount(1);await checkMetrics();await shot('C-updated')
    const retained=await list.locator('tbody').innerText(),oldTitle=await workshop.locator('h1').innerText(),next=DEMO_GALLERY[(idx+1)%DEMO_GALLERY.length]
    await choose(next.name);const dialog=page.getByRole('dialog');await expect(dialog).toContainText(next.name);await shot('replace-dialog');await dialog.getByRole('button',{name:'取消',exact:true}).click()
    await expect(dialog).toHaveCount(0);assert.equal(await workshop.locator('h1').innerText(),oldTitle);assert.equal(await list.locator('tbody').innerText(),retained);await checkMetrics()
    await row.getByRole('button',{name:'删除',exact:true}).click();records[entity.id].pop();await expect(list.locator('tbody tr')).toHaveCount(initialRows);await checkMetrics()
    // Gallery remains open after Cancel. Confirm a fresh choice explicitly.
    await page.locator('.demo-gallery__card').filter({has:page.getByRole('heading',{name:next.name,exact:true})}).getByRole('button',{name:'加载到工作台'}).click()
    await page.getByRole('dialog').getByRole('button',{name:'确认加载',exact:true}).click()
    const nextState=next.create();await expect(workshop.locator('h1')).toHaveText(nextState.spec.name);await expect(source).toContainText(`离线应用示例 · ${next.name}`)
    await c.click();await expect(page.locator('.app-spec-preview-content')).not.toContainText(`EDIT-${caseId}`);await expect(page.locator('.app-spec-preview-content')).not.toContainText(fieldName)
    const nextList=nextState.spec.blocks.find(x=>x.type==='list'),nextEntity=nextState.spec.relations.find(x=>x.blockId===nextList.id).entityId
    await expect(page.getByRole('region',{name:nextList.name,exact:true}).locator('tbody tr')).toHaveCount(nextState.records[nextEntity].length)
    const overflow=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.ok(overflow.width<=overflow.viewport+1,JSON.stringify(overflow));await shot('confirmed-switch')
    report.cases.push({id:caseId,width,height,gallery:item.name,classification:'OFFLINE FIXTURE',initialRows,metricKinds:metrics.map(x=>x.aggregation),initialMetrics:metrics.map(x=>({id:x.id,value:metricExpected(state,x,state.records)})),checks:['six cards/source labels','B add optional entity field','B configure form and list','C create/read/update/delete','count or sum updates where supported; task has no metric','three B/C round trips','Cancel preserves edited rows and project','explicit Confirm loads different project','fresh initial records/no old field leak','no horizontal overflow'],passed:true})
    await page.close()
   }
  }
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.unexpectedNetwork,[]);assert.deepEqual(report.httpErrors,[])
 }catch(e){report.failure=e.stack;if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw e}
 finally{report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server.httpServer.close(resolve))}
}
run().catch(e=>{console.error(e);process.exitCode=1})
