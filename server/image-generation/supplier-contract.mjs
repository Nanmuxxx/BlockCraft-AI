/** No transport, credentials, environment reads or activation path.
 * Pure preflight schema for a future owner-approved Qwen adapter.
 */
import { validInput, IMAGE_PROTOCOL } from './contract.ts'
export const QWEN_CANDIDATE=Object.freeze({model:'qwen-image-2.0-2026-03-03',region:'ap-southeast-1',size:'1024*1024',n:1})
const denied=()=>{throw new Error('SUPPLIER_RESPONSE_REJECTED')}
export function buildQwenRequest(prompt){
  if(!validInput({version:IMAGE_PROTOCOL,projectId:'preflight',prompt}))throw new Error('INVALID_INPUT')
  return {model:QWEN_CANDIDATE.model,input:{messages:[{role:'user',content:[{text:prompt.trim()}]}]},
    parameters:{size:QWEN_CANDIDATE.size,n:1,prompt_extend:false,watermark:true}}
}
export function inspectQwenResponse(json,{allowedResultHosts=[]}={}){
  if(typeof json!=='string'||Buffer.byteLength(json)>16384)denied()
  let x;try{x=JSON.parse(json)}catch{denied()}
  if(!x||x.code||typeof x.request_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(x.request_id)
    ||x.usage?.image_count!==1||x.usage?.width!==1024||x.usage?.height!==1024)denied()
  const choices=x.output?.choices
  if(!Array.isArray(choices)||choices.length!==1||choices[0].finish_reason!=='stop'||choices[0].message?.role!=='assistant')denied()
  const content=choices[0].message.content
  if(!Array.isArray(content)||content.length!==1||typeof content[0].image!=='string'||content[0].image.length>4096)denied()
  let url;try{url=new URL(content[0].image)}catch{denied()}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!allowedResultHosts.includes(url.hostname)
    ||/^[\d.:\[\]]+$/.test(url.hostname)||url.hostname==='localhost'||url.hostname.endsWith('.localhost'))denied()
  // Opaque server-side reference only; not a validated image, safety approval or billing receipt.
  return {state:'NEEDS_BOUNDED_DOWNLOAD',url:url.href,requestId:x.request_id,claimedImages:1,
    claimedWidth:1024,claimedHeight:1024,charge:'UNRECONCILED'}
}
