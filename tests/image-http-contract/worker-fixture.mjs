import {createImageProvider} from '../../server/image-generation/provider.ts'
import {setTimeout as delay} from 'node:timers/promises'
export function createFixtureProvider({mode='normal',delayMs=0}={}){
 return {kind:'MOCK',async generate(request,context){
  // Intentionally permanent and abort-ignoring. Parent must kill this worker, not race it.
  if(mode==='hang')return new Promise(()=>{})
  if(mode==='spin')while(true){}
  if(delayMs)await delay(delayMs)
  if(mode==='fail')throw Error('private-upstream-detail')
  const image=await createImageProvider({mode:'mock'}).generate(request,context)
  return mode==='bad-image'?{...image,mimeType:'image/jpeg'}:image
 }}
}
