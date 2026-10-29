import { createMockImageHandler } from '../../server/image-generation/coordinator.mjs'
import {createIsolatedMockProvider} from '../../server/image-generation/isolated-mock.mjs'
import { setTimeout as delay } from 'node:timers/promises'

/** Explicit local acceptance environment only. Never import from vite.config/startup.
 * Identity/membership are isolated fixtures, NOT production authentication.
 */
export function createHttpMockFixture() {
  const requests=[], held=[], controls={mode:'normal',delayMs:150,revoked:false,holdTab:null}
  const releaseHeld = (outcome='normal') => {
    controls.holdTab=null
    for(const {req,res} of held.splice(0)){
      if(outcome==='network'){res.destroy();continue}
      if(outcome==='unknown')req.url='/api/image-generations/11111111-1111-4111-8111-111111111111'
      void handler(req,res)
    }
  }

  const handler=createMockImageHandler({fixture:true,
    resolveIdentity:req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)?'fixture-owner':null,
    authorizeProject:(p,id)=>p==='fixture-owner'&&id==='fixture-project'&&!controls.revoked,
    budget:{admit(){},settle(){if(controls.mode==='uncertain')throw Error('synthetic-settlement-outage')}},
    provider:createIsolatedMockProvider({moduleUrl:new URL('../image-http-contract/worker-fixture.mjs',import.meta.url),
      dataForRequest:()=>({mode:controls.mode,delayMs:controls.delayMs})}),
  })
  return {handler,requests,controls,held,releaseHeld,plugin:{name:'isolated-http-mock-fixture',configureServer(server){
    server.middlewares.use((req,res,next)=>{
      if(!req.url?.startsWith('/api/image-generations'))return next()
      requests.push({method:req.method,path:req.url,tab:req.headers['x-rework-tab']})
      if(controls.holdTab&&req.headers['x-rework-tab']===controls.holdTab&&req.method==='GET'){held.push({req,res});return}
      if(controls.mode==='slow-response'&&req.method==='GET')void delay(100).then(()=>handler(req,res))
      else void handler(req,res)
    })
    server.httpServer?.on('close',()=>handler.close())
  }}}
}
