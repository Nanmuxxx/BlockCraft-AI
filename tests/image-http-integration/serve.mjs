import {createServer} from 'vite'
import {createHttpMockFixture} from './fixture.mjs'
const fixture=createHttpMockFixture()
const server=await createServer({server:{host:'127.0.0.1',port:5178,strictPort:true},
 define:{'import.meta.env.VITE_IMAGE_HTTP_FIXTURE':JSON.stringify('1')},
 plugins:[fixture.plugin,{name:'deny-other-fixture-apis',configureServer(s){s.middlewares.use((req,res,next)=>{
  if(!req.url?.startsWith('/api/'))return next()
  res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({enabled:false,error:{code:'FIXTURE_ONLY'}}))
 })}}]})
await server.listen()
console.log('HTTP MOCK isolated fixture only (no production auth/ledger/model): http://127.0.0.1:5178/ai-create')
for(const event of ['SIGINT','SIGTERM'])process.once(event,async()=>{fixture.handler.close();await server.close();process.exit(0)})
