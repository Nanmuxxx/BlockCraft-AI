import {createImageProvider} from '../../server/image-generation/provider.ts'
// Explicit synchronization, not a sleep: the parent releases bob only after Alice settles.
export function createFixtureProvider({gate}={}) {
 return {kind:'MOCK',async generate(request,context){
  if(request.prompt==='controlled bob') {
   const state=new Int32Array(gate)
   Atomics.store(state,1,1)
   while(Atomics.load(state,0)===0) await Atomics.waitAsync(state,0,0).value
  }
  return createImageProvider({mode:'mock'}).generate(request,context)
 }}
}
