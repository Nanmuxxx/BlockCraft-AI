import { randomUUID, createHash } from 'node:crypto'
import {createIsolatedMockProvider,isIsolatedMockProvider} from './isolated-mock.mjs'
import { IMAGE_PROTOCOL, IMAGE_PATH, IMAGE_LIMITS, IMAGE_ERRORS, validInput, validKey } from './contract.ts'
import { validateMockPng } from './validation.mjs'

const failure = code => Object.assign(new Error(code), {code})
const terminal = job => !['QUEUED','RUNNING'].includes(job.status)
const hash = x => createHash('sha256').update(x).digest('hex')
const reply = (res,status,value) => {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
  res.end(JSON.stringify(value))
}
async function readInput(req) {
  if (req.headers['content-type']?.split(';')[0].trim()!=='application/json') throw failure('UNSUPPORTED_MEDIA')
  let n=0; const parts=[]
  for await (const part of req) { n+=part.length; if(n>IMAGE_LIMITS.requestBytes) throw failure('PAYLOAD_TOO_LARGE'); parts.push(part) }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))) }
  catch { throw failure('INVALID_INPUT') }
}

/** TEST FIXTURE ONLY. Ephemeral jobs/keys are NOT a production ledger.
 * Not imported by application startup; no auth defaults or live provider selection.
 */
export function createMockImageHandler(options) {
  if (options?.fixture!==true || typeof options.resolveIdentity!=='function' || typeof options.authorizeProject!=='function') {
    return async (_req,res) => reply(res,503,{version:IMAGE_PROTOCOL,error:{code:'IMAGE_DISABLED',message:'Image request unavailable.'}})
  }
  const {resolveIdentity,authorizeProject,now=Date.now,deadlineMs=IMAGE_LIMITS.jobDeadlineMs,
    retentionMs=IMAGE_LIMITS.retentionMs,maxJobs=256,maxRunning=4,
    budget={admit(){},settle(){}},provider=createIsolatedMockProvider()}=options
  if (!isIsolatedMockProvider(provider)) throw failure('IMAGE_DISABLED')
  const jobs=new Map(), keys=new Map(), audit=[]; let running=0
  const record=(job,event) => { audit.push({id:job.id,projectTag:hash(job.projectId),event,at:now()}); if(audit.length>512) audit.shift() }
  const publish=job => ({version:IMAGE_PROTOCOL,kind:'HTTP_MOCK',id:job.id,status:job.status,charge:job.status==='UNCERTAIN'?'UNCERTAIN':'NONE',
    expiresAt:job.expiresAt,...(job.image?{image:job.image}:{}),...(job.error?{error:{code:job.error}}:{})})
  const allowed=async (principal,projectId) => {
    try { if (await authorizeProject(principal,projectId)!==true) throw failure('FORBIDDEN') }
    catch { throw failure('FORBIDDEN') }
  }
  const end=(job,status,code) => {
    if(terminal(job)) return
    job.status=status; job.error=code; delete job.image; clearTimeout(job.timer); record(job,status)
  }
  const execute=async job => {
    try {
      if(terminal(job)) return
      await allowed(job.principal,job.projectId)
      if(terminal(job)) return
      job.status='RUNNING'; record(job,'RUNNING')
      const result=await provider.generate({prompt:job.prompt},{signal:job.abort.signal})
      if(terminal(job)) return
      if(now()>=job.expiresAt) throw failure('EXPIRED')
      await allowed(job.principal,job.projectId)
      if(terminal(job)) return
      const image=validateMockPng(result)
      try { await budget.settle({id:job.id,kind:'MOCK',actual:0}) }
      catch { end(job,'UNCERTAIN','BILLING_UNCERTAIN');job.abort.abort();return }
      if(terminal(job)) return
      await allowed(job.principal,job.projectId)
      if(terminal(job)) return
      end(job,'SUCCEEDED');job.image=image
    } catch(error) {
      if(!terminal(job)) end(job,'FAILED',['INVALID_IMAGE','FORBIDDEN','EXPIRED'].includes(error.code)?error.code:'PROVIDER_FAILED')
    } finally {running--;delete job.prompt}
  }
  const handler=async(req,res)=>{
    try {
      const path=(req.url||'').split('?')[0]
      const match=new RegExp(`^${IMAGE_PATH}/([a-f0-9-]{36})(/cancel)?$`).exec(path)
      if(!((path===IMAGE_PATH&&req.method==='POST')||(match&&req.method===(match[2]?'POST':'GET')))) throw failure('NOT_FOUND')
      const origin=req.headers.origin
      if((origin&&origin!==`http://${req.headers.host}`&&origin!==`https://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site') throw failure('FORBIDDEN')
      let principal
      try {principal=await resolveIdentity(req)} catch {throw failure('UNAUTHORIZED')}
      if(typeof principal!=='string'||!principal||principal.length>256) throw failure('UNAUTHORIZED')
      if(match) {
        const job=jobs.get(match[1])
        if(!job||job.principal!==principal) throw failure('NOT_FOUND')
        await allowed(principal,job.projectId)
        if(now()>=job.expiresAt) {if(!terminal(job)){end(job,'FAILED','EXPIRED');job.abort.abort()} throw failure('EXPIRED')}
        if(match[2]) {
          if(req.headers['transfer-encoding']||Number(req.headers['content-length']||0)!==0) throw failure('INVALID_INPUT')
          if(!terminal(job)){end(job,'CANCELLED');job.abort.abort()}
        }
        return reply(res,200,publish(job))
      }
      // Reject multiple header instances, including Node's comma-joined variant.
      if(req.rawHeaders.filter((x,i)=>i%2===0&&x.toLowerCase()==='idempotency-key').length!==1||!validKey(req.headers['idempotency-key'])) throw failure('INVALID_INPUT')
      const input=await readInput(req)
      if(!validInput(input)) throw failure('INVALID_INPUT')
      await allowed(principal,input.projectId)
      const canonical=JSON.stringify({version:IMAGE_PROTOCOL,projectId:input.projectId,prompt:input.prompt.trim()})
      const scope=JSON.stringify([IMAGE_PROTOCOL,principal,input.projectId,req.headers['idempotency-key']])
      const existing=keys.get(scope)
      if(existing) {
        if(existing.digest!==hash(canonical)) throw failure('IDEMPOTENCY_CONFLICT')
        if(now()>=existing.expiresAt) throw failure('EXPIRED')
        return reply(res,202,publish(existing))
      }
      if(provider.resources().blocked) throw failure('IMAGE_DISABLED')
      if(jobs.size>=maxJobs||running>=maxRunning) throw failure('CAPACITY')
      // Atomic synchronous fixture admission, no await between uniqueness check and claim.
      try {const admission=budget.admit({kind:'MOCK',principal,projectId:input.projectId,maximum:0}); if(admission?.then) throw failure('LEDGER_UNAVAILABLE')}
      catch(e){throw failure(e.code==='BUDGET_DENIED'?'BUDGET_DENIED':'LEDGER_UNAVAILABLE')}
      const job={id:randomUUID(),principal,projectId:input.projectId,prompt:input.prompt.trim(),digest:hash(canonical),status:'QUEUED',
        expiresAt:now()+retentionMs,abort:new AbortController()}
      jobs.set(job.id,job);keys.set(scope,job);running++;record(job,'QUEUED')
      job.timer=setTimeout(()=>{end(job,'FAILED','TIMEOUT');job.abort.abort()},deadlineMs);job.timer.unref?.()
      reply(res,202,publish(job));setImmediate(()=>void execute(job))
    } catch(e) {
      const code=Object.hasOwn(IMAGE_ERRORS,e.code)?e.code:'PROVIDER_FAILED'
      reply(res,IMAGE_ERRORS[code],{version:IMAGE_PROTOCOL,error:{code,message:'Image request unavailable.'}})
    }
  }
  handler.audit=()=>structuredClone(audit)
  handler.resources=()=>({running,...provider.resources()})
  handler.close=async()=>{for(const job of jobs.values()){if(!terminal(job))end(job,'CANCELLED');job.abort.abort();clearTimeout(job.timer)}return provider.close()}
  return handler
}
