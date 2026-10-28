import { createMockImageHandler } from '../../server/image-generation/coordinator.mjs'
import { createImageProvider } from '../../server/image-generation/provider.ts'
import { setTimeout as delay } from 'node:timers/promises'

/** Explicit local acceptance environment only. Never import from vite.config/startup.
 * Identity/membership are isolated fixtures, NOT production authentication.
 */
export function createHttpMockFixture() {
  const provider=createImageProvider({mode:'mock'})
  const requests=[], controls={mode:'normal',delayMs:150}

  const handler=createMockImageHandler({fixture:true,
    resolveIdentity:req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)?'fixture-owner':null,
    authorizeProject:(p,id)=>p==='fixture-owner'&&id==='fixture-project',
    provider:{kind:'MOCK',async generate(input,context){
      const mode=controls.mode
      await delay(controls.delayMs,undefined,mode==='late'?{}:{signal:context.signal})
      if(mode==='fail')throw Error('private-provider-detail')
      const image=await provider.generate(input,mode==='late'?{signal:new AbortController().signal}:context)
      return mode==='bad-image'?{...image,mimeType:'image/jpeg'}:image
    }},
  })
  return {handler,requests,controls,plugin:{name:'isolated-http-mock-fixture',configureServer(server){
    server.middlewares.use((req,res,next)=>{
      if(!req.url?.startsWith('/api/image-generations'))return next()
      requests.push({method:req.method,path:req.url})
      if(controls.mode==='slow-response'&&req.method==='GET')void delay(100).then(()=>handler(req,res))
      else void handler(req,res)
    })
    server.httpServer?.on('close',()=>handler.close())
  }}}
}
