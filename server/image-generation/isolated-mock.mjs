import {Worker} from 'node:worker_threads'
const providers=new WeakSet()
const unavailable=()=>Object.assign(new Error('IMAGE_DISABLED'),{code:'IMAGE_DISABLED'})
/** Trusted, server-configured MOCK modules only. Worker ownership, not an OS security sandbox.
 * Environment/preloads are not inherited. No network/live provider activation path.
 */
export function createIsolatedMockProvider({moduleUrl=new URL('./provider.ts',import.meta.url),dataForRequest=()=>({}),terminationMs=2000}={}){
  if(!(moduleUrl instanceof URL)||moduleUrl.protocol!=='file:')throw unavailable()
  const active=new Map();let spawned=0,entered=0,exited=0,highWater=0,blocked=false
  const stop=entry=>{
    if(entry.stopping)return
    entry.stopping=true
    // This timer never releases capacity or resolves generate while a worker is alive.
    entry.guard=setTimeout(()=>{blocked=true;entry.worker.unref()},terminationMs)
    entry.guard.unref?.()
    void entry.worker.terminate().catch(()=>{blocked=true;entry.worker.unref()})
  }
  const provider={kind:'MOCK',
    generate(request,{signal}){
      if(blocked)return Promise.reject(unavailable())
      signal.throwIfAborted()
      const worker=new Worker(new URL('./mock-worker.mjs',import.meta.url),{env:{},execArgv:[],
        resourceLimits:{maxOldGenerationSizeMb:32,maxYoungGenerationSizeMb:8,stackSizeMb:4},
        workerData:{moduleUrl:moduleUrl.href,request,data:dataForRequest(request)}})
      const entry={worker,stopping:false,guard:null};active.set(worker,entry);spawned++;highWater=Math.max(highWater,active.size)
      return new Promise((resolve,reject)=>{
        let message,error
        const abort=()=>stop(entry)
        signal.addEventListener('abort',abort,{once:true})
        worker.on('message',value=>{
          if(value?.type==='started'){entered++;return}
          if(message)return
          message=value;stop(entry) // Even successful modules must release every owned handle.
        })
        worker.once('error',()=>{error=true;stop(entry)})
        worker.once('exit',()=>{
          active.delete(worker);exited++;clearTimeout(entry.guard);signal.removeEventListener('abort',abort)
          // generate settles ONLY after exit, so the coordinator's finally owns real capacity.
          if(signal.aborted)return reject(Object.assign(new Error('CANCELLED'),{code:'CANCELLED'}))
          if(error||message?.type!=='result')return reject(Object.assign(new Error('PROVIDER_FAILED'),{code:'PROVIDER_FAILED'}))
          resolve(message.result)
        })
        if(signal.aborted)abort()
      })
    },
    resources:()=>({active:active.size,spawned,entered,exited,highWater,blocked}),
    async close(){
      for(const entry of active.values())stop(entry)
      const until=Date.now()+terminationMs
      while(active.size&&Date.now()<until)await new Promise(r=>setTimeout(r,5))
      if(active.size)blocked=true
      return {closed:active.size===0,...provider.resources()}
    },
  }
  providers.add(provider);return provider
}
export const isIsolatedMockProvider=provider=>providers.has(provider)
