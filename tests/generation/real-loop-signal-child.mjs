import { startServer,installShutdownHandlers } from '../../server/index.mjs'
import { createPaidGenerationRuntime } from '../../server/paid-gateway/runtime.mjs'
const app=await startServer({port:0,env:{DEEPSEEK_API_KEY:'synthetic-qa-not-a-real-key',DEEPSEEK_BUDGET_LEDGER_PATH:process.argv[2]},resolveIdentity:()=>true,drainTimeoutMs:200,paidRuntimeFactory:opts=>createPaidGenerationRuntime({...opts,timeoutMs:2000,fetchImpl:()=>{process.send('UPSTREAM');return new Promise(()=>{})}})})
installShutdownHandlers(async()=>{process.send('DRAIN');await app.shutdown();process.send('COMPLETE');process.disconnect()})
fetch('http://127.0.0.1:'+app.server.address().port+'/api/ai/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idea:'任务清单'})}).catch(()=>{})
