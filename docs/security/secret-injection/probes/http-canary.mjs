import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
const nativeFetch=globalThis.fetch
let externalAttempts=0
globalThis.fetch=(url,options)=>{
 const u=new URL(url)
 if(u.hostname!=='127.0.0.1'){externalAttempts++;throw new Error('External network forbidden')}
 return nativeFetch(url,options)
}
const {startServer}=await import(pathToFileURL(join(process.cwd(),'server/index.mjs')).href)
const {createPaidGenerationRuntime}=await import(pathToFileURL(join(process.cwd(),'server/paid-gateway/runtime.mjs')).href)
const canary='SYNTHETIC-ONLY-SUPERVISOR-CANARY-20261019-NO-REAL-KEY'
const spec={version:1,id:'safe',name:'任务',entities:[{id:'items',name:'任务',fields:[{id:'title',name:'名称',type:'text',required:true}]}],blocks:[{id:'list',name:'清单',type:'list',fieldIds:['title']}],relations:[{id:'bind',type:'dataBinding',blockId:'list',entityId:'items'}]}
const envelope=content=>({model:canary,metadata:canary,choices:[{finish_reason:'stop',message:{role:'assistant',content}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})
const results=[]
for(const kind of ['success-with-untrusted-metadata','upstream-error-body','upstream-throws-secret','secret-in-spec','auth-throws-secret','key-only-closed']){
 const dir=await mkdtemp(join(tmpdir(),'supervisor-canary-'))
 const ledger=join(dir,'ledger.json')
 let calls=0
 let factoryCalls=0
 let captured=''
 const originals={log:console.log,error:console.error,warn:console.warn,info:console.info}
 for(const name of Object.keys(originals))console[name]=(...args)=>{captured+=args.map(String).join(' ')}
 let started
 try{
 const fetchImpl=async(url,wire)=>{
  calls++
  assert.equal(url,'https://api.deepseek.com/chat/completions')
  assert.equal(wire.redirect,'error')
  assert.equal(wire.headers.Authorization,'Bearer '+canary)
  if(kind==='upstream-error-body')return new Response(canary,{status:500,headers:{'X-Upstream-Secret':canary}})
  if(kind==='upstream-throws-secret')throw new Error(canary)
  const content=JSON.stringify(kind==='secret-in-spec'?{...spec,name:canary}:spec)
  return Response.json(envelope(content),{headers:{'X-Upstream-Secret':canary}})
 }
 started=await startServer({
  host:'127.0.0.1',port:0,env:{DEEPSEEK_API_KEY:canary,DEEPSEEK_BUDGET_LEDGER_PATH:ledger},
  resolveIdentity:kind==='key-only-closed'?undefined:kind==='auth-throws-secret'?()=>{throw new Error(canary)}:()=>true,
  paidRuntimeFactory:options=>{factoryCalls++;return createPaidGenerationRuntime({...options,fetchImpl})},
 })
 const response=await fetch('http://127.0.0.1:'+started.server.address().port+'/api/ai/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idea:'任务清单'})})
 const text=await response.text()
 assert.equal(response.status,kind==='success-with-untrusted-metadata'?200:['auth-throws-secret','key-only-closed'].includes(kind)?401:502)
 assert.ok(!text.includes(canary))
 assert.ok(!JSON.stringify([...response.headers]).includes(canary))
 await started.shutdown()
 let disk=''
 try{disk=await readFile(ledger,'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
 assert.ok(!disk.includes(canary))
 assert.ok(!captured.includes(canary))
 assert.equal(calls,['auth-throws-secret','key-only-closed'].includes(kind)?0:1)
 if(kind==='key-only-closed')assert.equal(factoryCalls,0)
 results.push({case:kind,status:response.status,mock_calls:calls,leak:false,pass:true})
 }finally{
  if(started)await started.shutdown()
  Object.assign(console,originals)
  await rm(dir,{recursive:true,force:true})
 }
}
assert.equal(externalAttempts,0)
const result={candidate_sha:'63a4ab2b65b9ffba72875a383a4ad82f472725fe',node:process.version,platform:process.platform,results,external_attempts:externalAttempts,real_model_calls:0,scope:'loopback HTTP response/headers, captured console, synthetic ledger only; browser/build/image/export not covered'}
await writeFile('./supervisor-canary-result.json',JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))

