import test from 'node:test'
import assert from 'node:assert/strict'
import { crc32, deflateSync } from 'node:zlib'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const root=process.env.QA_SOURCE_ROOT??'/Users/nanmuxun/BlockAI/BlockCraft-AI-image-phase2-qa-20261029'
const {validateCandidatePng,decodeCandidateBase64}=await import(pathToFileURL(root+'/server/image-generation/preflight/png.mjs'))
const {createCandidateDownloader}=await import(pathToFileURL(root+'/server/image-generation/preflight/download.mjs'))
function chunk(name,data){const h=Buffer.alloc(8),c=Buffer.alloc(4);h.writeUInt32BE(data.length);h.write(name,4);c.writeUInt32BE(crc32(Buffer.concat([h.subarray(4),data])));return Buffer.concat([h,data,c])}
const sig=Buffer.from([137,80,78,71,13,10,26,10])
function image(w=1,h=1,options={}){const hdr=Buffer.alloc(13);hdr.writeUInt32BE(w);hdr.writeUInt32BE(h,4);hdr[8]=8;hdr[9]=6;const raw=options.raw??Buffer.alloc((w*4+1)*h);return Buffer.concat([sig,chunk('IHDR',hdr),...(options.before??[]),chunk('IDAT',options.deflate??deflateSync(raw)),...(options.after??[]),chunk('IEND',Buffer.alloc(0))])}
const tick=()=>new Promise(r=>setImmediate(r)),url='https://image.example.invalid/a?private=signed-reference'
function setup(kind='good'){let req,res,opens=0,closes=0;const pending=[];const request=(u,o,cb)=>{opens++;assert.equal(u.href,url);assert.equal(o.rejectUnauthorized,true);assert.equal(o.agent,false);assert.equal(o.servername,'image.example.invalid');o.lookup(u.hostname,{},(err,ip,family)=>{assert.equal(err,null);assert.equal(ip,'1.1.1.1');assert.equal(family,4)});req=new EventEmitter();req.destroy=()=>{closes++;if(kind!=='no-close')queueMicrotask(()=>req.emit('close'))};req.end=()=>pending.push(()=>{res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'image/png'};res.complete=true;res.destroy=()=>req.destroy();cb(res)});return req};const d=createCandidateDownloader({allowedHosts:['image.example.invalid'],lookup:async()=>[{address:'1.1.1.1',family:4}],request,timeoutMs:40});return{d,pending,get req(){return req},get res(){return res},stats:()=>({opens,closes})}}
test('QA PNG parser: exact 512 KiB accepted and +1 denied without changing valid bytes',()=>{
  const original=image(),target=524288,remaining=target-original.length
  // IDAT boundaries may contain empty chunks: no semantic padding/trailing bytes.
  const emptyCount=Math.floor(remaining/12),remainder=remaining%12
  // Build a zlib stream with uncompressed blocks so exact stream size can be tuned.
  let exact
  for(let width=1;width<=1024&&!exact;width++){
    // Instead of assuming compressor output length, append legal empty IDAT chunks and test modulus.
    const im=image(width,1),extra=target-im.length
    if(extra>=0&&extra%12===0){exact=Buffer.concat([im.subarray(0,-12),...Array.from({length:extra/12},()=>chunk('IDAT',Buffer.alloc(0))),im.subarray(-12)])}
  }
  assert.ok(exact);assert.equal(exact.length,target);assert.deepEqual(validateCandidatePng(exact).bytes,exact)
  assert.throws(()=>validateCandidatePng(Buffer.concat([exact,Buffer.from([0])])),{code:'INVALID_IMAGE'})
})
test('QA PNG parser: duplicate IHDR, non-contiguous IDAT, high-bit chunk, overinflation and concatenated zlib denied',()=>{
  const base=image(),hdr=base.subarray(16,29)
  const high=chunk('IDAT',deflateSync(Buffer.alloc(5)));high[4]|=128;high.writeUInt32BE(crc32(high.subarray(4,-4)),high.length-4)
  const cases=[image(1,1,{before:[chunk('IHDR',hdr)]}),image(1,1,{after:[chunk('tEXt',Buffer.from('a'))]}),
    Buffer.concat([base.subarray(0,33),high,base.subarray(-12)]),image(1,1,{raw:Buffer.alloc(5*1024*1024)}),
    image(1,1,{deflate:Buffer.concat([deflateSync(Buffer.alloc(5)),deflateSync(Buffer.alloc(5))])})]
  for(const x of cases)assert.throws(()=>validateCandidatePng(x),{code:'INVALID_IMAGE'})
})
test('QA maximum raster: dimensions and hashes based on actual decoded bounded bytes',()=>{
  const bytes=image(1024,1024),result=decodeCandidateBase64(bytes.toString('base64'),{mimeType:'image/png',width:1024,height:1024})
  assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'))
  assert.throws(()=>validateCandidatePng(image(1,1025)),{code:'INVALID_IMAGE'})
  assert.throws(()=>validateCandidatePng(bytes,{mimeType:'image/png',width:1,height:1}),{code:'INVALID_IMAGE'})
})
test('QA abort while headers pending: late response destroyed and never delivers a candidate',async()=>{
  const s=setup(),a=new AbortController(),p=s.d.download(url,{signal:a.signal});await tick();a.abort()
  await assert.rejects(p,{code:'CANCELLED'});s.pending.shift()();await tick();assert.ok(s.stats().closes>=1)
  assert.equal(s.stats().opens,1);assert.equal(s.d.resources().active,false)
})
test('QA truncated response/connection: failed, safe diagnostics, one request',async()=>{
  const s=setup(),p=s.d.download(url,{signal:new AbortController().signal});await tick();s.pending.shift()()
  s.res.emit('data',image().subarray(0,20));s.res.complete=false;s.res.emit('end')
  await assert.rejects(p,{code:'DOWNLOAD_REJECTED',message:'DOWNLOAD_REJECTED'});await tick();assert.equal(s.stats().opens,1)
})
test('QA native-like premature close rejects before successful candidate',async()=>{
  const s=setup(),p=s.d.download(url,{signal:new AbortController().signal});await tick();s.req.emit('close')
  await assert.rejects(p,{code:'DOWNLOAD_FAILED'});assert.equal(s.d.resources().active,false)
})
test('QA success cannot release slot until request close; new request busy',async()=>{
  const s=setup('no-close'),p=s.d.download(url,{signal:new AbortController().signal});await tick();s.pending.shift()()
  s.res.emit('data',image());s.res.emit('end');assert.equal((await p).state,'VALIDATED_BYTES_ONLY')
  await assert.rejects(s.d.download(url,{signal:new AbortController().signal}),{code:'DOWNLOAD_BUSY'})
  s.req.emit('close');assert.equal(s.d.resources().active,false)
})
test('QA DNS abort resolution: late public address cannot cause a request',async()=>{
  let release,requests=0;const a=new AbortController();const d=createCandidateDownloader({allowedHosts:['image.example.invalid'],lookup:()=>new Promise(r=>release=r),request:()=>{requests++;throw Error('network must not open')}})
  const p=d.download(url,{signal:a.signal});await tick();a.abort();await assert.rejects(p,{code:'CANCELLED'});assert.equal(d.resources().active,true)
  release([{family:4,address:'1.1.1.1'}]);await tick();assert.equal(requests,0);assert.equal(d.resources().active,false)
})
test('QA native Node HTTPS lookup path consumes the pinned address; socket is deliberately never opened',async()=>{
  const {request:nativeRequest}=await import('node:https');let pinned,lookups=0,transportCalls=0
  const request=(target,options,cb)=>{
    transportCalls++
    return nativeRequest(target,{...options,lookup:(host,lookupOptions,callback)=>{
      lookups++;options.lookup(host,lookupOptions,(err,answer,family)=>{
        assert.equal(err,null);pinned=Array.isArray(answer)?answer[0].address:answer
        // Abort the native connect at lookup; no remote socket or TLS handshake.
        callback(Object.assign(new Error('QA deliberately prevents all sockets'),{code:'ENOTFOUND'}))
      })
    }},cb)
  }
  const d=createCandidateDownloader({allowedHosts:['image.example.invalid'],lookup:async()=>[{address:'1.1.1.1',family:4}],request})
  await assert.rejects(d.download(url,{signal:new AbortController().signal}),{code:'DOWNLOAD_FAILED',message:'DOWNLOAD_FAILED'})
  await tick();assert.equal(pinned,'1.1.1.1');assert.equal(lookups,1);assert.equal(transportCalls,1);assert.equal(d.resources().active,false)
})
