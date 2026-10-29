import { crc32, deflateSync } from 'node:zlib'
import { EventEmitter } from 'node:events'
export function chunk(type, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(data.length+12); bytes.writeUInt32BE(data.length); bytes.write(type,4); data.copy(bytes,8)
  bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4); return bytes
}
export function png({width=2,height=2,color=6,filter=0,raw,compressed,extra=[]}={}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=color
  const scanline = Buffer.alloc((width*(({0:1,2:3,4:2,6:4})[color]??4)+1)*height)
  for(let p=0;p<scanline.length;p+=scanline.length/height)scanline[p]=filter
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
    ...extra,chunk('IDAT',compressed??deflateSync(raw??scanline)),chunk('IEND')])
}
export function transport({body=png(),headers={},status=200,hold=false,noClose=false,onOptions=()=>{},pieces}={}) {
  let calls=0,destroys=0
  const request=(url,options,callback)=>{
    calls++;onOptions(url,options)
    const req=new EventEmitter();let closed=false
    const close=()=>{if(!closed&&!noClose){closed=true;queueMicrotask(()=>req.emit('close'))}}
    req.destroy=()=>{destroys++;close()}
    req.end=()=>queueMicrotask(()=>{
      const res=new EventEmitter();res.headers={'content-type':'image/png',...headers};res.statusCode=status;res.complete=true
      res.destroy=()=>close();callback(res)
      if(closed||hold)return
      for(const p of pieces??[body]) {if(closed)break;res.emit('data',p)}
      if(!closed){res.emit('end');close()}
    })
    return req
  }
  return {request,stats:()=>({calls,destroys})}
}
