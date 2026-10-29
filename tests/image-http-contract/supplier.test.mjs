import test from 'node:test'
import assert from 'node:assert/strict'
import {buildQwenRequest,inspectQwenResponse} from '../../server/image-generation/supplier-contract.mjs'
const fixture={request_id:'fixture-response-1',usage:{image_count:1,width:1024,height:1024},output:{choices:[{finish_reason:'stop',message:{role:'assistant',content:[{image:'https://result.example.invalid/fixture.png?Expires=1'}]}}]}}
test('MOCK TRANSPORT ONLY: pinned Qwen request, fixed safe parameters and serializable schema',()=>{
 const x=buildQwenRequest('一只小猫');assert.equal(x.model,'qwen-image-2.0-2026-03-03');assert.equal(x.parameters.n,1);assert.equal(x.parameters.prompt_extend,false)
 assert.deepEqual(JSON.parse(JSON.stringify(x)),x);assert.throws(()=>buildQwenRequest(''))
})
test('MOCK TRANSPORT ONLY: supplier reference requires explicit host policy and remains unverified',()=>{
 assert.throws(()=>inspectQwenResponse(JSON.stringify(fixture)))
 const options={allowedResultHosts:['result.example.invalid']}
 const x=inspectQwenResponse(JSON.stringify(fixture),options);assert.equal(x.state,'NEEDS_BOUNDED_DOWNLOAD');assert.equal(x.charge,'UNRECONCILED')
 for(const bad of [null,{...fixture,code:'DataInspectionFailed'},{...fixture,usage:{...fixture.usage,image_count:2}},{...fixture,output:{choices:[]}}])assert.throws(()=>inspectQwenResponse(JSON.stringify(bad),options),/SUPPLIER_RESPONSE_REJECTED/)
 for(const image of ['http://result.example.invalid/x','https://localhost/x','https://127.0.0.1/x','https://other.invalid/x','https://result.example.invalid:999/x']){
  const bad=structuredClone(fixture);bad.output.choices[0].message.content[0].image=image
  assert.throws(()=>inspectQwenResponse(JSON.stringify(bad),options))
 }
 assert.throws(()=>inspectQwenResponse('x'.repeat(16385),options))
})
