import { createMockImageHandler } from '../../server/image-generation/coordinator.mjs'
import {createIsolatedMockProvider} from '../../server/image-generation/isolated-mock.mjs'
import { setTimeout as delay } from 'node:timers/promises'

/** Explicit local acceptance environment only. Never import from vite.config/startup.
 * Identity/membership are isolated fixtures, NOT production authentication.
 */
export function createHttpMockFixture() {
  const requests=[], controls={mode:'normal',delayMs:150,revoked:false}

  const handler=createMockImageHandler({fixture:true,
    resolveIdentity:req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)?'fixture-owner':null,
    authorizeProject:(p,id)=>p==='fixture-owner'&&id==='fixture-project'&&!controls.revoked,
    budget:{admit(){},settle(){if(controls.mode==='uncertain')throw Error('synthetic-settlement-outage')}},
    provider:createIsolatedMockProvider({moduleUrl:new URL('../image-http-contract/worker-fixture.mjs',import.meta.url),
      dataForRequest:()=>({mode:controls.mode,delayMs:controls.delayMs})}),
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
