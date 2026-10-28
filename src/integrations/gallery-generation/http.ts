import { IMAGE_PROTOCOL, IMAGE_PATH, IMAGE_LIMITS, validJob, type JobStatus } from '../../../server/image-generation/contract.ts'
import { createMockImageAdapter } from './mock'
import type { ImageProvider } from './offline'

/** Same-origin HTTP MOCK only. No URL/key/model configuration or paid fallback. */
export function createHttpMockImageProvider(projectId: string, onStatus: (status: JobStatus) => void = () => {},
  options: { pollMs?: number; deadlineMs?: number; requestTimeoutMs?: number } = {}): ImageProvider {
  return { async generate(prompt, signal) {
    const key=crypto.randomUUID(), lifetime=new AbortController()
    let jobId: string | undefined, cancelSent=false
    const cancel=async () => {
      if(!jobId||cancelSent)return
      cancelSent=true
      try {await fetch(`${IMAGE_PATH}/${jobId}/cancel`,{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(3000)})}catch{/* Outcome unknown; never claim refund or retry. */}
    }
    const abort=()=>{lifetime.abort();void cancel()}
    signal.addEventListener('abort',abort,{once:true})
    const timer=setTimeout(abort,options.deadlineMs??IMAGE_LIMITS.jobDeadlineMs)
    const request=async(path:string,init:RequestInit={})=>{
      const timeout=AbortSignal.timeout(options.requestTimeoutMs??IMAGE_LIMITS.requestTimeoutMs)
      const response=await fetch(path,{...init,credentials:'same-origin',signal:AbortSignal.any([lifetime.signal,timeout])})
      if(!response.headers.get('content-type')?.startsWith('application/json'))throw Error('HTTP Mock 响应格式无效。')
      const reader=response.body?.getReader();if(!reader)throw Error('HTTP Mock 响应为空。')
      let size=0;const parts:Uint8Array[]=[]
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>IMAGE_LIMITS.responseBytes)throw Error('HTTP Mock 响应超过限制。');parts.push(value)}}
      catch(e){await reader.cancel().catch(()=>{});throw e}finally{reader.releaseLock()}
      const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}
      let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw Error('HTTP Mock JSON 无效。')}
      if(!response.ok)throw Error('HTTP Mock 请求失败；原作品未更改，请检查服务状态后再操作。')
      if(!validJob(value))throw Error('HTTP Mock 任务响应无效。')
      return value
    }
    try{
      signal.throwIfAborted()
      const initial=await request(IMAGE_PATH,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},
        body:JSON.stringify({version:IMAGE_PROTOCOL,projectId,prompt})})
      jobId=initial.id
      if(lifetime.signal.aborted){void cancel();throw Error('HTTP Mock 已取消。')}
      let job=initial
      while(true){
        lifetime.signal.throwIfAborted();onStatus(job.status)
        if(job.status==='SUCCEEDED'){
          if(!job.image)throw Error('HTTP Mock 缺少候选。')
          const dataUrl=`data:image/png;base64,${job.image.data}`
          if(dataUrl.length>IMAGE_LIMITS.dataUrlChars)throw Error('HTTP Mock 候选超过资源限制。')
          const image=job.image
          return createMockImageAdapter({async generate(){return {kind:'MOCK',mimeType:image.mimeType,
            bytes:Uint8Array.from(atob(image.data),c=>c.charCodeAt(0)),width:image.width,height:image.height}}}).generate(prompt,lifetime.signal)
        }
        if(!['QUEUED','RUNNING'].includes(job.status))throw Error(job.status==='UNCERTAIN'?'费用状态不确定；已停止，请等待核对，不要重新提交。':'HTTP Mock 任务未成功；原作品未更改。')
        await new Promise<void>((resolve,reject)=>{
          const done=()=>{lifetime.signal.removeEventListener('abort',stop);resolve()}
          const wait=setTimeout(done,options.pollMs??250)
          const stop=()=>{clearTimeout(wait);lifetime.signal.removeEventListener('abort',stop);reject(Error('HTTP Mock 已取消。'))}
          lifetime.signal.addEventListener('abort',stop,{once:true});if(lifetime.signal.aborted)stop()
        })
        job=await request(`${IMAGE_PATH}/${jobId}`)
        if(job.id!==jobId)throw Error('HTTP Mock 任务标识不匹配。')
      }
    }catch{
      void cancel()
      throw Error('HTTP Mock 未完成；原作品未更改。取消或提交结果可能尚未确认，请先核对任务，勿自动重试。')
    }finally{clearTimeout(timer);signal.removeEventListener('abort',abort)}
  }}
}
