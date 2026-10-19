const { chromium } = require('playwright')
const { expect } = require('playwright/test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const output = process.env.WORKSHOP_QA_OUTPUT || path.join(root, '.cache/workshop-presentation')
async function run() {
  const { createServer } = await import('vite')
  const vite = await createServer({ root, server: { host: '127.0.0.1', port: 5195, strictPort: true }, plugins: [{ name: 'isolated-workshop-presentation', configureServer(server) {
    server.middlewares.use('/__presentation', async (_req, res, next) => {
      try { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__presentation', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/workshop-presentation/fixture.tsx"></script></body></html>')) } catch(e) { next(e) }
    })
  } }] })
  const report = { sha: execFileSync('git', ['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim(), provider:'isolated fixed JSON completion + real Workshop/Host/Runtime/CAS; zero AI calls', cases:[], errors:[], network:[] }
  let browser, activePage
  try {
    await fs.mkdir(output,{recursive:true}); await vite.listen(); browser = await chromium.launch({headless:true})
    report.chromium = browser.version()
    for (const [width,height] of [[1366,1000],[390,844]]) {
      const page = activePage = await browser.newPage({viewport:{width,height},hasTouch:width===390,isMobile:width===390})
      page.on('pageerror',e=>report.errors.push(e.message))
      page.on('console',e=>{if(e.type()==='error') report.errors.push(e.text())})
      await page.route('**/*',route=>{
        const url=new URL(route.request().url())
        if(url.pathname==='/api/mochi-ai/status') return route.fulfill({json:{enabled:false,proactiveEnabled:false,modificationsEnabled:false,reason:'ACCESS_UNAVAILABLE'}})
        if(url.hostname==='127.0.0.1' && route.request().method()==='GET' && !url.pathname.startsWith('/api/')) return route.continue()
        report.network.push(url.href); return route.abort()
      })
      await page.goto('http://127.0.0.1:5195/__presentation')
      const block = page.locator('[data-block-key="builtin:registration-form"]')
      const input = page.getByRole('textbox',{name:'给 Mochi 发消息'})
      const preview = page.getByRole('region',{name:'修改计划预览'})
      const state = ()=>page.evaluate(()=>window.presentationQA.runtime.getSnapshot())
      const b=page.getByRole('button',{name:'B 模式 · 编辑积木',exact:true}),c=page.getByRole('button',{name:'C 模式 · 运行应用',exact:true})
      const patch = async value=>page.evaluate(v=>{window.presentationQA.patch=v},value)
      const request = async ()=>{await input.fill('离线受控属性修改');await page.locator('.mochi-ai').getByRole('button',{name:'发送',exact:true}).click()}
      const confirm = ()=>preview.getByRole('button',{name:'确认',exact:true}).click()
      const styles = el=>el.evaluate(e=>({bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,radius:getComputedStyle(e).borderRadius}))
      await block.click(); await page.mouse.move(0,0); await page.waitForTimeout(200); const original=await state(), defaults=await styles(block)
      await patch({buttonText:'立即报名',backgroundColor:'#abcdef',textColor:'#123456',borderRadius:12})
      await request();await expect(preview).toBeVisible();assert.deepEqual(await state(),original);assert.deepEqual(await styles(block),defaults)
      await c.click();await expect(page.locator('.renderer-block--form button[type=submit]')).toHaveText('提交');await b.click()
      await page.screenshot({path:path.join(output,`preview-${width}.png`),fullPage:true})
      await confirm();await expect(preview).toHaveCount(0);await expect(page.locator('.mochi-ai')).toContainText('本次提交回执版本：1');assert.equal((await state()).revision,original.revision+1)
      const applied=await state();await expect(block.locator('.block-canvas__detail')).toHaveText('按钮：立即报名')
      const expected={bg:'rgb(171, 205, 239)',color:'rgb(18, 52, 86)',radius:'12px'}
      assert.deepEqual(await styles(block),expected)
      await page.screenshot({path:path.join(output,`applied-B-${width}.png`),fullPage:true})
      await c.click();assert.deepEqual(await styles(page.locator('.renderer-block--form')),expected);await expect(page.locator('.renderer-block--form button[type=submit]')).toHaveText('立即报名');assert.deepEqual(await state(),applied)
      await page.screenshot({path:path.join(output,`applied-C-${width}.png`),fullPage:true});await b.click()
      // Partial patch preserves all earlier fields, and zero is a real radius.
      await patch({borderRadius:0});await request();await confirm();assert.equal((await state()).revision,applied.revision+1)
      await expect(block).toHaveCSS('border-radius','0px');await c.click();await expect(page.locator('.renderer-block--form')).toHaveCSS('border-radius','0px');await b.click()
      const retained=await state()
      await patch({buttonText:'取消不提交'});await request();await preview.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await state(),retained)
      await request();await page.locator('[data-block-key="builtin:applicant-list"]').click();await expect(preview).toHaveCount(0);assert.deepEqual(await state(),retained);await block.click()
      // An actual concurrent Runtime write invalidates the old preview; no rebase.
      await request();const old=await page.evaluate(()=>window.presentationQA.host.getSnapshot().preview.planId)
      await page.evaluate(()=>window.presentationQA.runtime.moveBlock('registration-form',{x:.3,y:.3}))
      await expect(preview).toHaveCount(0)
      const stale=await page.evaluate(async id=>{try{await window.presentationQA.host.callbacks.onConfirm(id);return 'unexpected'}catch(e){return e.code}},old)
      assert.notEqual(stale,'unexpected');assert.equal((await state()).spec.blocks[0].presentation.buttonText,'立即报名')
      // Revoke authorization during CONFIRMING: the existing final owner guard
      // must reject the captured token without refreshing it or writing state.
      await request();const beforeDenied=await state()
      await page.evaluate(()=>{
        const {host,runtime}=window.presentationQA
        const off=host.subscribe(()=>{if(host.getSnapshot().phase==='CONFIRMING'){off();runtime.customProject.setReadOnly(true)}})
      })
      await confirm();await expect(preview).toHaveCount(0);assert.deepEqual(await state(),beforeDenied)
      await page.evaluate(()=>window.presentationQA.runtime.customProject.setReadOnly(false))
      // Real readonly authorization gate and invalid provider output.
      await page.evaluate(()=>window.presentationQA.runtime.customProject.setReadOnly(true));await request();await expect(preview).toHaveCount(0)
      await page.evaluate(()=>window.presentationQA.runtime.customProject.setReadOnly(false));await patch({backgroundColor:'url(https://invalid)'});await request();await expect(preview).toHaveCount(0)
      assert.equal((await state()).spec.blocks[0].presentation.backgroundColor,'#abcdef')
      // Cancel request; provider deliberately ignores abort, then resolves late.
      await patch({buttonText:'迟到不得提交'});await page.evaluate(()=>{window.presentationQA.defer=true});await request();await page.getByRole('button',{name:'取消请求',exact:true}).click()
      await page.evaluate(()=>{window.presentationQA.pending.splice(0).forEach(done=>done());window.presentationQA.defer=false});await expect(preview).toHaveCount(0)
      // Replace the real project while completion is pending; dispose old Host.
      await page.evaluate(()=>{window.presentationQA.defer=true});await request();await page.evaluate(()=>{window.presentationOldRuntime=window.presentationQA.runtime;window.presentationOldSnapshot=window.presentationQA.runtime.getSnapshot();window.presentationQA.replace()})
      await expect(block).toBeVisible();await page.evaluate(()=>{window.presentationQA.pending.splice(0).forEach(done=>done());window.presentationQA.defer=false})
      await expect(preview).toHaveCount(0);assert.ok(await page.evaluate(()=>window.presentationOldRuntime.getSnapshot()===window.presentationOldSnapshot));assert.equal((await state()).revision,0);assert.equal((await state()).spec.blocks[0].presentation,undefined)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow')
      report.cases.push({width,height,passed:true,originalRevision:original.revision,confirmedRevision:applied.revision,styles:expected,checks:['Preview zero writes B/C','Confirm receipt + revision','B/C computed styles and button text','partial patch + radius zero','Cancel','selection invalidation','concurrent revision rejected','authorization revocation during Confirm rejects without write','read-only gate','unsafe patch rejected','cancel late completion','project replacement late completion','no horizontal overflow']})
      await page.close()
    }
    await vite.close()
    // The actual production-built /ai-create route: controlled generation response,
    // no test Runtime globals and no enabled modification provider.
    const { preview: servePreview } = await import('vite')
    const production = await servePreview({root,preview:{host:'127.0.0.1',port:5194,strictPort:true}})
    try {
      const { createClubRegistrationExample } = require('../custom-block/fixtures.cjs')
      for (const [width,height] of [[1366,1000],[390,844]]) {
        const page=activePage=await browser.newPage({viewport:{width,height},isMobile:width===390,hasTouch:width===390})
        page.on('pageerror',e=>report.errors.push(e.message))
        page.on('console',e=>{if(e.type()==='error')report.errors.push(e.text())})
        const spec=createClubRegistrationExample().spec
        spec.blocks[0].presentation={buttonText:'正式页面报名',backgroundColor:'#abcdef',textColor:'#123456',borderRadius:0}
        await page.route('**/*',route=>{
          const url=new URL(route.request().url())
          if(url.pathname==='/api/ai/generate')return route.fulfill({json:spec})
          if(url.pathname==='/api/mochi-ai/status')return route.fulfill({json:{enabled:false,proactiveEnabled:false,modificationsEnabled:false,reason:'ACCESS_UNAVAILABLE'}})
          if(url.hostname==='127.0.0.1'&&route.request().method()==='GET'&&!url.pathname.startsWith('/api/'))return route.continue()
          report.network.push(url.href);return route.abort()
        })
        await page.goto('http://127.0.0.1:5194/ai-create')
        await page.getByLabel('你想做什么软件？').fill('离线生成响应，正式页面回归')
        await page.getByRole('button',{name:'生成应用',exact:true}).click()
        const block=page.locator('[data-block-key="builtin:registration-form"]')
        await expect(block).toBeVisible();await block.click()
        await expect(page.getByRole('textbox',{name:'给 Mochi 发消息'})).toBeDisabled()
        await expect(block).toHaveCSS('background-color','rgb(171, 205, 239)')
        await expect(block).toHaveCSS('border-radius','0px')
        await expect(block.locator('.block-canvas__detail')).toHaveText('按钮：正式页面报名')
        await page.screenshot({path:path.join(output,`production-B-${width}.png`),fullPage:true})
        await page.getByRole('button',{name:'C 模式 · 运行应用',exact:true}).click()
        await expect(page.locator('.renderer-block--form')).toHaveCSS('background-color','rgb(171, 205, 239)')
        await expect(page.locator('.renderer-block--form')).toHaveCSS('color','rgb(18, 52, 86)')
        await expect(page.locator('.renderer-block--form')).toHaveCSS('border-radius','0px')
        await expect(page.locator('.renderer-block--form button[type=submit]')).toHaveText('正式页面报名')
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
        assert.equal(await page.evaluate(()=>typeof window.presentationQA),'undefined')
        await page.screenshot({path:path.join(output,`production-C-${width}.png`),fullPage:true})
        report.cases.push({surface:'production build /ai-create',generation:'offline intercepted JSON response',width,height,passed:true,modificationProvider:'disabled',checks:['official schema accepted','real product B/C styles and text','production composer disabled','test globals absent','no overflow']})
        await page.close()
      }
    } finally {await new Promise(resolve=>production.httpServer.close(resolve))}
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.network,[])
  } catch(e) {report.failure=e.stack;await activePage?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw e}
  finally {await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await vite.close()}
}
run().catch(e=>{console.error(e);process.exitCode=1})
