import { crc32, inflateSync } from 'node:zlib'
import { IMAGE_LIMITS } from './contract.ts'

/** Bounded, deliberately narrow normalized PNG subset. No external decoder/URLs. */
export function validateMockPng(result) {
  const fail = () => { throw Object.assign(new Error('INVALID_IMAGE'), { code: 'INVALID_IMAGE' }) }
  if (!result || result.kind !== 'MOCK' || result.mimeType !== 'image/png' || !(result.bytes instanceof Uint8Array)) fail()
  const bytes = Buffer.from(result.bytes)
  if (bytes.length < 57 || bytes.length > IMAGE_LIMITS.pngBytes || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail()
  let width, height, channels, ended = false, dataStarted = false, dataEnded = false
  const chunks = []
  for (let p=8; p<bytes.length;) {
    if (p+12>bytes.length) fail()
    const n=bytes.readUInt32BE(p), type=bytes.toString('ascii',p+4,p+8)
    if (n>bytes.length-p-12 || crc32(bytes.subarray(p+4,p+8+n))!==bytes.readUInt32BE(p+8+n)) fail()
    if (p===8) {
      if (type!=='IHDR' || n!==13) fail()
      width=bytes.readUInt32BE(p+8);height=bytes.readUInt32BE(p+12)
      channels=({0:1,2:3,4:2,6:4})[bytes[p+17]]
      if (!width || !height || width>IMAGE_LIMITS.width || height>IMAGE_LIMITS.height || width*height>IMAGE_LIMITS.pixels
        || bytes[p+16]!==8 || !channels || bytes[p+18]!==0 || bytes[p+19]!==0 || bytes[p+20]!==0) fail()
    } else if (type==='IDAT') {
      if (dataEnded) fail()
      dataStarted=true; chunks.push(bytes.subarray(p+8,p+8+n))
    } else if (type==='IEND') {
      if (n!==0 || !dataStarted || p+12!==bytes.length) fail()
      dataEnded=true;ended=true
    } else fail() // metadata, animation, unknown critical chunks rejected
    p+=n+12
  }
  if (!ended || width!==result.width || height!==result.height) fail()
  const row=width*channels+1, length=row*height
  let decoded
  try {
    const compressed=Buffer.concat(chunks)
    const inflated=inflateSync(compressed,{maxOutputLength:length,info:true})
    if (inflated.engine.bytesWritten!==compressed.length) fail()
    decoded=inflated.buffer
  } catch { fail() }
  if (decoded.length!==length) fail()
  for (let p=0;p<length;p+=row) if (decoded[p]>4) fail()
  return Object.freeze({kind:'MOCK',mimeType:'image/png',encoding:'base64',data:bytes.toString('base64'),width,height})
}
