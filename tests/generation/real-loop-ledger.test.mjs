import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, chmod, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { startServer } from '../../server/index.mjs'
import { createPaidGenerationRuntime } from '../../server/paid-gateway/runtime.mjs'
import { openLedger } from '../../server/paid-gateway/ledger.mjs'
import { POLICY } from '../../server/paid-gateway/pricing.mjs'

const spec = { version:1,id:'qa-app',name:'QA任务',entities:[{id:'tasks',name:'任务',fields:[{id:'title',name:'名称',type:'text',required:true}]}],blocks:[{id:'list',name:'清单',type:'list',fieldIds:['title']}],relations:[{id:'bind',type:'dataBinding',blockId:'list',entityId:'tasks'}] }
const completion=()=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(spec)}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const until=async fn=>{for(let n=0;n<100;n++){if(await fn())return;await sleep(10)}throw Error('condition deadline')}
const disk=async path=>JSON.parse(await readFile(path,'utf8'))
async function setup(t,{auth=true,fetchImpl=completion,timeoutMs=100,drainTimeoutMs=100}={}) {
 const dir=await mkdtemp(join(tmpdir(),'blockcraft-independent-qa-')); await chmod(dir,0o700)
 const path=join(dir,'synthetic.json'), env={DEEPSEEK_API_KEY:'synthetic-qa-not-a-real-key',DEEPSEEK_BUDGET_LEDGER_PATH:path}
 let calls=0, signal
 const app=await startServer({port:0,env,resolveIdentity:()=>auth,drainTimeoutMs,paidRuntimeFactory:opts=>createPaidGenerationRuntime({...opts,timeoutMs,fetchImpl:(url,init)=>{calls++; signal=init.signal;return fetchImpl(url,init)}})})
 t.after(()=>app.shutdown())
 const post=(headers={})=>fetch('http://127.0.0.1:'+app.server.address().port+'/api/ai/generate',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({idea:'任务清单'})})
 return {app,path,dir,post,calls:()=>calls,signal:()=>signal}
}
test('401 denies before reservation and egress; reopen after shutdown',async t=>{
 const x=await setup(t,{auth:false})
 const r=await x.post();assert.equal(r.status,401);assert.equal((await r.json()).error.code,'UNAUTHORIZED')
 assert.equal(x.calls(),0);assert.equal((await disk(x.path)).entries.length,0)
 assert.throws(()=>openLedger(x.path),{code:'LEDGER_LOCKED'})
 await x.app.shutdown();const reopened=openLedger(x.path);reopened.close()
 console.log(JSON.stringify({case:'401',calls:0,reservations:0}))
})
test('success settles; identical client request key is NOT idempotent (negative evidence); exhausted ledger returns 503 before egress',async t=>{
 const x=await setup(t)
 for(let i=0;i<POLICY.maxCalls;i++){
  const r=await x.post({'Idempotency-Key':'same-key'});assert.equal(r.status,200);assert.deepEqual(await r.json(),spec)
  const state=await disk(x.path);assert.equal(state.entries.length,i+1);assert(state.entries.every(e=>e.status==='settled'))
 }
 const before=await disk(x.path),calls=x.calls(),r=await x.post()
 assert.equal(r.status,503);assert.equal((await r.json()).error.code,'BUDGET_EXHAUSTED')
 assert.equal(x.calls(),calls);assert.deepEqual(await disk(x.path),before)
 await x.app.shutdown();const reopened=openLedger(x.path);assert.equal(reopened.snapshot().entries.length,POLICY.maxCalls);reopened.close()
 console.log(JSON.stringify({case:'settle-repeat-exhaust',calls,reservations:before.entries.length,repeatedKeyDeduplication:'NOT IMPLEMENTED',status:503}))
})
test('gateway timeout ignoring abort returns 504 then uncertain+halt; no second reservation/egress',async t=>{
 const x=await setup(t,{fetchImpl:()=>new Promise(()=>{}),timeoutMs:50})
 const r=await x.post();assert.equal(r.status,504);assert.equal((await r.json()).error.code,'AI_TIMEOUT')
 assert.equal(x.signal().aborted,true)
 const state=await disk(x.path);assert.equal(state.halted,true);assert.equal(state.entries[0].status,'uncertain')
 const retry=await x.post();assert.equal(retry.status,503);assert.equal((await retry.json()).error.code,'BUDGET_HALTED')
 assert.equal(x.calls(),1);assert.equal((await disk(x.path)).entries.length,1)
 console.log(JSON.stringify({case:'timeout',calls:1,reservations:1,status:504,ledger:'uncertain+halt'}))
})
test('real client disconnect aborts egress, marks uncertain and halts',async t=>{
 const x=await setup(t,{fetchImpl:()=>new Promise(()=>{}),timeoutMs:2000})
 const req=request({host:'127.0.0.1',port:x.app.server.address().port,path:'/api/ai/generate',method:'POST',headers:{'Content-Type':'application/json'}})
 req.on('error',()=>{});req.end(JSON.stringify({idea:'任务清单'}))
 await until(()=>x.calls()===1);req.destroy()
 await until(async()=> (await disk(x.path)).halted)
 assert.equal(x.signal().aborted,true);assert.equal((await disk(x.path)).entries[0].status,'uncertain')
 await x.app.shutdown();const reopened=openLedger(x.path);assert.equal(reopened.snapshot().halted,true);reopened.close()
 console.log(JSON.stringify({case:'disconnect',calls:1,reservations:1,abort:true,ledger:'uncertain+halt'}))
})
test('shutdown retains exclusive lock throughout handler drain with noncooperative fetch',async t=>{
 const x=await setup(t,{fetchImpl:()=>new Promise(()=>{}),timeoutMs:2000,drainTimeoutMs:120})
 const response=x.post().catch(()=>null);await until(()=>x.calls()===1)
 const first=x.app.shutdown();assert.strictEqual(first,x.app.shutdown())
 let completed=false,locked=0;first.then(()=>{completed=true})
 while(!completed){
  assert.throws(()=>openLedger(x.path),{code:'LEDGER_LOCKED'});locked++;await sleep(5)
 }
 await response;assert(locked>2);assert.equal(x.signal().aborted,true)
 const reopened=openLedger(x.path),state=reopened.snapshot();assert.equal(state.entries[0].status,'uncertain');assert.equal(state.halted,true);reopened.close()
 console.log(JSON.stringify({case:'shutdown',lockProbes:locked,calls:1,reservations:1,lockReleasedAfterHandlers:true,ledger:'uncertain+halt'}))
})
test('real OS SIGTERM then SIGINT cannot interrupt full server/ledger drain',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'blockcraft-signal-qa-'));await chmod(dir,0o700)
 const path=join(dir,'synthetic.json')
 const child=fork(new URL('./real-loop-signal-child.mjs',import.meta.url),[path],{stdio:['ignore','pipe','pipe','ipc'],env:{PATH:process.env.PATH}})
 let stdout='',stderr='',draining=false,complete=false,probes=0
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b)
 const exited=once(child,'exit')
 child.on('message',message=>{
  if(message==='UPSTREAM')child.kill('SIGTERM')
  if(message==='DRAIN'){draining=true;child.kill('SIGINT');child.kill('SIGTERM')}
  if(message==='COMPLETE')complete=true
 })
 const timer=setInterval(()=>{if(draining&&!complete){try{const l=openLedger(path);l.close();stderr+='EARLY_LOCK_RELEASE\n'}catch(e){if(e.code==='LEDGER_LOCKED')probes++;else stderr+=e.code+'\n'}}},5)
 const watchdog=setTimeout(()=>child.kill('SIGKILL'),5000)
 const [code,signal]=await exited;clearInterval(timer);clearTimeout(watchdog)
 console.log(JSON.stringify({case:'OS-signals',code,signal,complete,lockProbes:probes,stdout,stderr}))
 assert.equal(signal,null);assert.equal(code,0);assert.equal(complete,true);assert(probes>2);assert(!stderr.includes('EARLY_LOCK_RELEASE'))
 const reopened=openLedger(path);assert.equal(reopened.snapshot().entries[0].status,'uncertain');assert.equal(reopened.snapshot().halted,true);reopened.close()
})
