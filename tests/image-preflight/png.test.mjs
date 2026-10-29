import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { validateCandidatePng, decodeCandidateBase64, CANDIDATE_LIMITS } from '../../server/image-generation/preflight/png.mjs'
import { png,chunk } from './fixtures.mjs'
const invalid = fn => assert.throws(fn,{code:'INVALID_IMAGE'})
test('OFFLINE: genuine bounded PNG bytes, dimensions, ownership, hash and base64 round-trip',()=>{
  for(const color of [0,2,4,6])for(const filter of [0,1,2,3,4]){
    const bytes=png({color,filter}),result=validateCandidatePng(bytes,{mimeType:'image/png',width:2,height:2})
    assert.equal(result.state,'VALIDATED_BYTES_ONLY');assert.equal(result.sha256.length,64)
    assert.deepEqual(result.bytes,bytes);bytes[0]=0;assert.equal(result.bytes[0],137)
    assert.deepEqual(decodeCandidateBase64(result.bytes.toString('base64')),result)
  }
})
test('OFFLINE: rejects malformed/animated/metadata/oversized/dimension-mismatched images',()=>{
  const bytes=png(),badCrc=Buffer.from(bytes);badCrc[29]^=1
  const cases=[Buffer.alloc(0),Buffer.alloc(CANDIDATE_LIMITS.bytes+1),Buffer.from('GIF89a'),badCrc,
    bytes.subarray(0,-1),Buffer.concat([bytes,Buffer.from([0])]),png({filter:5}),png({width:1025}),
    png({color:3}),png({extra:[chunk('acTL',Buffer.alloc(8))]}),png({extra:[chunk('tEXt',Buffer.from('untrusted'))]}),
    png({raw:Buffer.alloc(10000)}),png({raw:Buffer.alloc(1)}),png({compressed:Buffer.concat([deflateSync(Buffer.alloc(18)),Buffer.from([0])])})]
  for(const value of cases)invalid(()=>validateCandidatePng(value))
  invalid(()=>validateCandidatePng(png(),{mimeType:'image/png',width:3,height:2}))
  invalid(()=>validateCandidatePng(png(),{mimeType:'image/jpeg',width:2,height:2}))
})
test('OFFLINE: canonical base64 only, bounded before decode and no URL/whitespace',()=>{
  for(const value of ['https://example.invalid/x','data:image/png;base64,AAAA',' A===','AA=A','AAAA\n',
    'A'.repeat(CANDIDATE_LIMITS.base64Chars+4),'AB==',null])invalid(()=>decodeCandidateBase64(value))
})
test('OFFLINE: maximum admitted 1024-square image stays within scanline budget',()=>{
  const result=validateCandidatePng(png({width:1024,height:1024}));assert.equal(result.width*result.height,1048576)
})
