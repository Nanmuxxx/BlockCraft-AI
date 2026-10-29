import test from 'node:test'
import assert from 'node:assert/strict'
import { createCandidateDownloader, inspectDownloadUrl, isPublicIPv4 } from '../../server/image-generation/preflight/download.mjs'
import { png,transport } from './fixtures.mjs'
const url='https://cdn.example.invalid/result.png?opaque=redacted'
const allowedHosts=['cdn.example.invalid'],signal=()=>new AbortController().signal
const publicLookup=async()=>[{family:4,address:'8.8.8.8'}]
const options=extra=>({allowedHosts,lookup:publicLookup,...extra})
const tick=()=>new Promise(r=>setImmediate(r))
test('OFFLINE injected transport: zero-default egress and exact HTTPS URL policy',async()=>{
  let calls=0;const d=createCandidateDownloader({lookup:()=>{calls++;throw Error('not allowed')},request:()=>{calls++;throw Error('not allowed')}})
  await assert.rejects(d.download(url,{signal:signal()}),{code:'DOWNLOAD_REJECTED'});assert.equal(calls,0)
  for(const u of ['http://cdn.example.invalid/x','https://cdn.example.invalid.evil/x','https://127.0.0.1/x',
    'https://2130706433/x','https://[::1]/x','https://user:pass@cdn.example.invalid/x','https://cdn.example.invalid:444/x',
    'https://cdn.example.invalid./x','https://cdn.example.invalid/x#f','https://cdn.example.invalid\\@evil/x',url+'\n'])
    assert.throws(()=>inspectDownloadUrl(u,allowedHosts),{code:'DOWNLOAD_REJECTED'})
})
test('OFFLINE: all resolved records must be public IPv4; no IPv6/mapped/private/special fallback',async()=>{
  for(const address of ['0.1.2.3','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1',
    '192.0.0.9','192.0.2.1','192.88.99.1','192.168.1.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::ffff:127.0.0.1','2001:4860:4860::8888'])assert.equal(isPublicIPv4(address),false,address)
  for(const records of [[],[{family:6,address:'2001:4860:4860::8888'}],[{family:4,address:'8.8.8.8'},{family:4,address:'127.0.0.1'}]]){
    const t=transport();const d=createCandidateDownloader(options({lookup:async()=>records,request:t.request}))
    await assert.rejects(d.download(url,{signal:signal()}),{code:'DOWNLOAD_REJECTED'});assert.equal(t.stats().calls,0)
  }
})
test('OFFLINE: pinned connection uses original TLS hostname, no agent/cookies/auth, single GET, validated bytes',async()=>{
  let lookups=0
  const t=transport({onOptions:(u,o)=>{
    assert.equal(u.hostname,'cdn.example.invalid');assert.equal(o.method,'GET');assert.equal(o.agent,false)
    assert.equal(o.servername,u.hostname);assert.equal(o.rejectUnauthorized,true);assert.equal(o.maxHeaderSize,16384)
    assert.deepEqual(Object.keys(o.headers).sort(),['Accept','Accept-Encoding'])
    o.lookup(u.hostname,{},(err,ip,family)=>{assert.equal(err,null);assert.equal(ip,'8.8.8.8');assert.equal(family,4)})
    o.lookup(u.hostname,{all:true},(err,records)=>{assert.equal(err,null);assert.deepEqual(records,[{address:'8.8.8.8',family:4}])})
  }})
  const d=createCandidateDownloader(options({lookup:async()=>{lookups++;return publicLookup()},request:t.request}))
  const result=await d.download(url,{signal:signal(),expected:{mimeType:'image/png',width:2,height:2}})
  assert.deepEqual(result.bytes,png());assert.equal(lookups,1);assert.equal(t.stats().calls,1)
  await tick();assert.equal(d.resources().active,false)
})
test('OFFLINE: redirects, incorrect MIME/compression/length and oversized streamed bodies rejected without retry',async()=>{
  for(const config of [{status:302,headers:{location:'http://127.0.0.1/'}},{headers:{'content-type':'image/jpeg'}},
    {headers:{'content-encoding':'gzip'}},{headers:{'content-length':'524289'}},{headers:{'content-length':'NaN'}},
    {headers:{'content-length':'1'}},{body:Buffer.from('invalid')},{pieces:[Buffer.alloc(524288),Buffer.alloc(1)]}]){
    const t=transport(config),d=createCandidateDownloader(options({request:t.request}))
    await assert.rejects(d.download(url,{signal:signal()}),e=>['DOWNLOAD_REJECTED','INVALID_IMAGE'].includes(e.code))
    assert.equal(t.stats().calls,1);assert.ok(t.stats().destroys>=1)
  }
})
test('OFFLINE: abort and timeout bound stuck response; no second dispatch before actual close',async()=>{
  const t=transport({hold:true,noClose:true}),d=createCandidateDownloader(options({request:t.request,timeoutMs:30}))
  const pending=d.download(url,{signal:signal()})
  await assert.rejects(d.download(url,{signal:signal()}),{code:'DOWNLOAD_BUSY'})
  await assert.rejects(pending,{code:'DOWNLOAD_TIMEOUT'});assert.equal(d.resources().active,true)
  await assert.rejects(d.download(url,{signal:signal()}),{code:'DOWNLOAD_BUSY'});assert.equal(t.stats().calls,1)
  const a=new AbortController(),t2=transport({hold:true}),d2=createCandidateDownloader(options({request:t2.request}))
  const p=d2.download(url,{signal:a.signal});await tick();a.abort('sensitive reason')
  await assert.rejects(p,{code:'CANCELLED',message:'CANCELLED'});await tick();assert.equal(d2.resources().active,false)
})
test('OFFLINE: DNS timeout holds capacity and late DNS completion cannot open a socket',async()=>{
  let release;const lookup=()=>new Promise(r=>{release=r}),t=transport(),d=createCandidateDownloader(options({lookup,request:t.request,timeoutMs:20}))
  await assert.rejects(d.download(url,{signal:signal()}),{code:'DOWNLOAD_TIMEOUT'});assert.equal(d.resources().active,true)
  release(await publicLookup());await tick();assert.equal(t.stats().calls,0);assert.equal(d.resources().active,false)
})
test('OFFLINE: safe diagnostics never include upstream message or signed URL; pre-abort zero dispatch',async()=>{
  const t=transport(),d=createCandidateDownloader(options({lookup:async()=>{throw Error('SECRET '+url)},request:t.request}))
  await assert.rejects(d.download(url,{signal:signal()}),{message:'DOWNLOAD_FAILED',code:'DOWNLOAD_FAILED'})
  const a=new AbortController();a.abort();await assert.rejects(d.download(url,{signal:a.signal}),{code:'CANCELLED'})
  assert.equal(t.stats().calls,0)
})
