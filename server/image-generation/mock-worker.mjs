import {parentPort,workerData} from 'node:worker_threads'
const abort=new AbortController()
// Keep a pending module owned until the parent confirms terminate()/exit.
parentPort.on('message',message=>{if(message==='abort')abort.abort()})
try{
  const module=await import(workerData.moduleUrl)
  const provider=module.createImageProvider?module.createImageProvider({mode:'mock'}):module.createFixtureProvider(workerData.data)
  if(provider.kind!=='MOCK')throw Error('IMAGE_DISABLED')
  parentPort.postMessage({type:'started'})
  const result=await provider.generate(workerData.request,{signal:abort.signal})
  parentPort.postMessage({type:'result',result})
}catch{parentPort.postMessage({type:'error'})}
