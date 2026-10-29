import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import {createMockImageHandler} from '../../server/image-generation/coordinator.mjs'
import {createIsolatedMockProvider} from '../../server/image-generation/isolated-mock.mjs'
async function until(check,limit=6000){const end=Date.now()+limit;while(!check()){if(Date.now()>end)throw Error('BOUNDED_WAIT_EXCEEDED');await delay(10)}}
for(const outcome of ['cancel','timeout'])test(`HTTP MOCK R2: four permanent abort-ignoring workers ${outcome}; confirmed exit, tombstones, fifth admission`,{timeout:10000},async t=>{
 const provider=createIsolatedMockProvider({moduleUrl:new URL('./worker-fixture.mjs',import.meta.url),dataForRequest:r=>({mode:r.prompt==='hang'?'hang':'normal'})})
 let settlements=0
 const handler=createMockImageHandler({fixture:true,resolveIdentity:()=> 'owner',authorizeProject:()=>true,provider,maxRunning:4,deadlineMs:2000,
  budget:{admit(){},settle(){settlements++}}})
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening')
 t.after(async()=>{const closed=await handler.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(closed.closed,true)})
 const base=`http://127.0.0.1:${server.address().port}/api/image-generations`
 const create=async(i,prompt='hang')=>{const res=await fetch(base,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'isolation-request-'+i},body:JSON.stringify({version:'image-generation/1',projectId:'project',prompt})});return {status:res.status,body:await res.json()}}
 const jobs=[];for(let i=0;i<4;i++)jobs.push((await create(i)).body)
 await until(()=>provider.resources().entered===4)
 assert.equal(handler.resources().running,4);assert.equal(provider.resources().active,4)
 assert.equal((await create(4,'normal')).status,429)
 if(outcome==='cancel')await Promise.all(jobs.map(job=>fetch(base+'/'+job.id+'/cancel',{method:'POST'})))
 await until(()=>handler.resources().running===0)
 const freed=handler.resources();assert.equal(freed.active,0);assert.equal(freed.exited,4);assert.equal(freed.spawned,4);assert.equal(freed.blocked,false)
 assert.equal(settlements,0)
 for(let i=0;i<4;i++){
  const replay=await create(i);assert.equal(replay.body.id,jobs[i].id)
  assert.equal(replay.body.status,outcome==='cancel'?'CANCELLED':'FAILED');assert.ok(!replay.body.image)
  if(outcome==='timeout')assert.equal(replay.body.error.code,'TIMEOUT')
  const twice=await fetch(base+'/'+jobs[i].id+'/cancel',{method:'POST'});assert.equal((await twice.json()).status,replay.body.status)
 }
 assert.equal(provider.resources().spawned,4)
 const fifth=await create(4,'normal');assert.equal(fifth.status,202)
 await until(()=>handler.resources().running===0)
 const result=await (await fetch(base+'/'+fifth.body.id)).json();assert.equal(result.status,'SUCCEEDED')
 assert.equal(settlements,1);assert.equal(provider.resources().spawned,5);assert.equal(provider.resources().exited,5);assert.equal(provider.resources().active,0)
 assert.equal(provider.resources().highWater,4)
 console.log(JSON.stringify({outcome,before:{permanentPending:4},after:freed,fifth:result.status,final:handler.resources(),settlements}))
})
test('MOCK R2: arbitrary in-process provider rejected rather than pretending cancellation terminates it',()=>{
 assert.throws(()=>createMockImageHandler({fixture:true,resolveIdentity(){},authorizeProject(){},provider:{kind:'MOCK',generate:()=>new Promise(()=>{})}}),{code:'IMAGE_DISABLED'})
})
test('MOCK R2: terminate also stops a CPU loop, with bounded cleanup', {timeout:10000},async()=>{
 const provider=createIsolatedMockProvider({moduleUrl:new URL('./worker-fixture.mjs',import.meta.url),dataForRequest:()=>({mode:'spin'})})
 const abort=new AbortController();const pending=provider.generate({prompt:'cat'},{signal:abort.signal});const rejection=assert.rejects(pending,{code:'CANCELLED'})
 await until(()=>provider.resources().entered===1);abort.abort();await rejection
 assert.equal(provider.resources().active,0);assert.equal(provider.resources().exited,1);assert.equal((await provider.close()).closed,true)
})
