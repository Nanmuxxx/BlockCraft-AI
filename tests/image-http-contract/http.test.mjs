import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { crc32, deflateSync } from 'node:zlib'
import { createMockImageHandler } from '../../server/image-generation/coordinator.mjs'
import { createImageProvider } from '../../server/image-generation/provider.ts'
import { IMAGE_PROTOCOL, validJob } from '../../server/image-generation/contract.ts'
import {createIsolatedMockProvider} from '../../server/image-generation/isolated-mock.mjs'
import { validateMockPng } from '../../server/image-generation/validation.mjs'
const input={version:IMAGE_PROTOCOL,projectId:'project-a',prompt:'一只小猫'}
const fixture=createImageProvider({mode:'mock'})
const png=()=>fixture.generate({prompt:'cat'},{signal:new AbortController().signal})
async function harness(t,options={}) {
 const members=new Set(['alice/project-a','bob/project-b'])
 const provider=options.provider||createIsolatedMockProvider({moduleUrl:new URL('./worker-fixture.mjs',import.meta.url),dataForRequest:()=>({mode:options.mode||'normal',delayMs:options.delayMs||0})})
 const handler=createMockImageHandler({fixture:true,resolveIdentity:req=>req.headers['x-fixture-user'],authorizeProject:(p,id)=>members.has(`${p}/${id}`),provider,...options})
 const server=createServer(handler);server.requestTimeout=10000;server.headersTimeout=10000
 server.listen(0,'127.0.0.1');await once(server,'listening')
 t.after(async()=>{await handler.close?.();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
 const base=`http://127.0.0.1:${server.address().port}`
 const send=async(path='',{user='alice',method=path?'GET':'POST',body=path?undefined:input,key='request-1234567890',headers={}}={})=>{
 const response=await fetch(base+'/api/image-generations'+path,{method,headers:{...(user?{'x-fixture-user':user}:{}),'Content-Type':'application/json','Idempotency-Key':key,...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})})
 assert.equal(response.headers.get('cache-control'),'no-store')
 return {status:response.status,body:await response.json()}
 }
 const settled=async id=>{for(let i=0;i<100;i++){const x=await send('/'+id);if(!['QUEUED','RUNNING'].includes(x.body.status))return x;await delay(5)}throw Error('fixture did not settle')}
 return {send,settled,base,members,handler,get calls(){return provider.resources().spawned}}
}
test('HTTP MOCK: create/poll/replay is serializable, bounded, exactly one dispatch',async t=>{
 const h=await harness(t); const [a,b]=await Promise.all([h.send(),h.send()]);assert.equal(a.status,202);assert.equal(a.body.id,b.body.id)
 const result=await h.settled(a.body.id);assert.equal(result.body.status,'SUCCEEDED');assert.ok(validJob(result.body));assert.equal(h.calls,1)
 assert.equal(result.body.image.width,1);assert.equal((await h.send()).body.id,a.body.id)
 assert.equal((await h.send('',{body:{...input,prompt:'different'}})).status,409)
 assert.ok(h.handler.audit().every(x=>!JSON.stringify(x).includes('alice')&&!JSON.stringify(x).includes('小猫')))
})
test('HTTP MOCK: anonymous, forged identity/project, other owner and revoked cached results denied',async t=>{
 const h=await harness(t)
 assert.equal((await h.send('',{user:null})).status,401)
 assert.equal((await h.send('',{user:'forged'})).status,403)
 assert.equal((await h.send('',{body:{...input,projectId:'project-b'}})).status,403)
 const a=await h.send();await h.settled(a.body.id)
 assert.equal((await h.send('/'+a.body.id,{user:'bob'})).status,404)
 assert.equal((await h.send('/'+a.body.id+'/cancel',{user:'bob',method:'POST'})).status,404)
 h.members.clear()
 for(const path of ['', '/'+a.body.id,'/'+a.body.id+'/cancel']) assert.equal((await h.send(path,{method:'POST',...(path&&!path.endsWith('cancel')?{method:'GET'}:{})})).status,403)
 assert.equal(h.calls,1)
})
test('HTTP MOCK: strict JSON, version, input bounds, duplicate key and cross-origin rejected',async t=>{
 const h=await harness(t)
 for(const body of ['{',[],{...input,principal:'alice'},{...input,version:'2'},{...input,prompt:'\0'},{...input,prompt:'x'.repeat(501)}]) assert.equal((await h.send('',{body})).status,400)
 assert.equal((await h.send('',{body:'x'.repeat(4097)})).status,413)
 assert.equal((await h.send('',{headers:{'Content-Type':'text/plain'}})).status,415)
 assert.equal((await h.send('',{key:'small'})).status,400)
 assert.equal((await h.send('',{headers:{Origin:'https://evil.invalid'}})).status,403)
 assert.equal((await h.send('',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403)
 const status=await new Promise(resolve=>{const req=request(h.base+'/api/image-generations',{method:'POST',headers:{'Content-Type':'application/json','x-fixture-user':'alice','Idempotency-Key':['request-1234567890','request-1234567890']}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.end(JSON.stringify(input))})
 assert.equal(status,400);assert.equal(h.calls,0)
})
test('HTTP MOCK: cancel twice fences late provider success',async t=>{
 const h=await harness(t,{mode:'normal',delayMs:200})
 const a=await h.send();await delay(10)
 for(let i=0;i<2;i++)assert.equal((await h.send('/'+a.body.id+'/cancel',{method:'POST'})).body.status,'CANCELLED')
 await delay(250)
 assert.equal((await h.send('/'+a.body.id)).body.status,'CANCELLED');assert.equal((await h.send()).body.id,a.body.id)
})
test('HTTP MOCK: timeout fences late success and provider errors are safe',async t=>{
 const h=await harness(t,{deadlineMs:60,mode:'hang'})
 const a=await h.send();const result=await h.settled(a.body.id);assert.equal(result.body.error.code,'TIMEOUT')
 await delay(50);assert.equal((await h.send('/'+a.body.id)).body.status,'FAILED')
 const broken=await harness(t,{mode:'fail'})
 const b=await broken.send();const failure=await broken.settled(b.body.id)
 assert.equal(failure.body.error.code,'PROVIDER_FAILED');assert.ok(!JSON.stringify(failure).includes('private'))
})
test('HTTP MOCK: budget denial and ledger outage prevent dispatch; uncertain settlement withholds image',async t=>{
 for(const code of ['BUDGET_DENIED','LEDGER_UNAVAILABLE']){
 const h=await harness(t,{budget:{admit(){throw Object.assign(Error('private'),{code})}}})
 const a=await h.send();assert.equal(a.body.error.code,code);assert.equal(h.calls,0)
 }
 const h=await harness(t,{budget:{admit(){},settle(){throw Error('private-ledger')}}})
 const a=await h.send(),b=await h.settled(a.body.id)
 assert.equal(b.body.status,'UNCERTAIN');assert.equal(b.body.charge,'UNCERTAIN');assert.ok(!b.body.image)
 assert.equal((await h.send()).body.id,a.body.id);assert.equal(h.calls,1)
})
test('HTTP MOCK: bounded concurrency, immutable tombstones and expiry never redispatch',async t=>{
 let clock=100;const h=await harness(t,{now:()=>clock,retentionMs:20,maxJobs:1,maxRunning:1,mode:'hang'})
 const a=await h.send();assert.equal((await h.send('',{key:'another-1234567890'})).status,429)
 clock=121;assert.equal((await h.send('/'+a.body.id)).status,410);assert.equal((await h.send()).status,410)
 await delay(50);assert.equal((await h.send('',{key:'another-1234567890'})).status,429)
})
test('HTTP MOCK: missing authority defaults closed; live provider construction rejected',async t=>{
 const h=await harness(t,{fixture:false});assert.equal((await h.send()).body.error.code,'IMAGE_DISABLED');assert.equal(h.calls,0)
 assert.throws(()=>createMockImageHandler({fixture:true,resolveIdentity(){},authorizeProject(){},provider:{kind:'REAL'}}),{code:'IMAGE_DISABLED'})
})
test('MOCK: byte-level PNG checks reject MIME, corruption, dimensions, oversize, raster and animation',async()=>{
 const good=await png();assert.equal(validateMockPng(good).width,1)
 for(const result of [{...good,mimeType:'image/jpeg'},{...good,width:2},{...good,bytes:new Uint8Array(524289)},{...good,bytes:good.bytes.slice(0,-1)},{...good,bytes:new Uint8Array(good.bytes.length)}]) assert.throws(()=>validateMockPng(result),{code:'INVALID_IMAGE'})
 function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b}
 const prefix=Buffer.from(good.bytes.slice(0,33)),end=Buffer.from(good.bytes.slice(-12))
 for(const raster of [Buffer.from([5,255,255]),Buffer.from([0]),Buffer.alloc(100000)]){
 const bytes=Buffer.concat([prefix,chunk('IDAT',deflateSync(raster)),end]);assert.throws(()=>validateMockPng({...good,bytes}),{code:'INVALID_IMAGE'})
 }
 assert.throws(()=>validateMockPng({...good,bytes:Buffer.concat([prefix,chunk('acTL',Buffer.alloc(8)),Buffer.from(good.bytes.slice(33))])}),{code:'INVALID_IMAGE'})
})
test('HTTP MOCK: invalid provider bytes fail safely through HTTP',async t=>{
 const h=await harness(t,{mode:'bad-image'})
 const a=await h.send();assert.equal((await h.settled(a.body.id)).body.error.code,'INVALID_IMAGE')
})

test('HTTP MOCK: same key scoped across owners/projects; distinct keys execute concurrently',async t=>{
 const h=await harness(t)
 const results=await Promise.all([h.send(),h.send('',{key:'different-1234567890'}),h.send('',{user:'bob',body:{...input,projectId:'project-b'}})])
 assert.equal(new Set(results.map(x=>x.body.id)).size,3)
 for(const [i,x]of results.entries()){
  const end= i===2 ? await h.send('/'+x.body.id,{user:'bob'}) : await h.settled(x.body.id)
  assert.equal(end.body.status,'SUCCEEDED')
 }
 assert.equal(h.calls,3)
 const replay=await h.send('',{body:{...input,prompt:'  '+input.prompt+'  '}});assert.equal(replay.body.id,results[0].body.id)
})
