import { ProjectPackageError } from './errors'

export const PACKAGE_LIMITS = Object.freeze({
  maxFiles: 34,
  maxFileBytes: 4_000_000,
  maxTotalBytes: 5_100_000,
  maxZipBytes: 5_200_000,
})

const UTF8 = 0x0800
const LOCAL = 0x04034b50
const CENTRAL = 0x02014b50
const END = 0x06054b50
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
function fail(code = 'PACKAGE_INVALID'): never {
  const messages: Record<string, string> = {
    PACKAGE_INVALID: '项目包 ZIP 结构无效。', PACKAGE_LIMIT: '项目包超过大小或文件数量限制。',
    PACKAGE_PATH: '项目包含非法或重复文件路径。', PACKAGE_UNSUPPORTED: '不支持此 ZIP 特性，请使用原始项目包。',
    PACKAGE_INTEGRITY: '项目包文件完整性校验失败。',
  }
  throw new ProjectPackageError(code, messages[code])
}
function validPath(path: string, paths: Set<string>) {
  const asset = /^assets\/([A-Za-z][A-Za-z0-9_-]{0,127})\.(png|jpg|webp|gif)$/.exec(path)
  if (path !== 'manifest.json' && path !== 'project.json' && (!asset || asset[0] !== path || ['constructor', 'prototype', '__proto__'].includes(asset[1]))) fail('PACKAGE_PATH')
  const folded = path.toLowerCase()
  if (paths.has(folded)) fail('PACKAGE_PATH')
  paths.add(folded)
}
const crcTable = new Uint32Array(256)
for (let i = 0; i < crcTable.length; i++) {
  let n = i
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0)
  crcTable[i] = n >>> 0
}
function crc32(data: Uint8Array) {
  let n = 0xffffffff
  for (const byte of data) n = (n >>> 8) ^ crcTable[(n ^ byte) & 255]
  return (n ^ 0xffffffff) >>> 0
}

/** Deterministic STORE ZIP. No compression, network, or filesystem access. */
export function encodePackageZip(files: { path: string, data: Uint8Array }[]): Uint8Array {
  if (!Array.isArray(files)) fail()
  if (files.length > PACKAGE_LIMITS.maxFiles) fail('PACKAGE_LIMIT')
  let total = 0
  let zipLength = 22
  const paths = new Set<string>()
  const entries = files.map(file => {
    if (!file || typeof file.path !== 'string' || !(file.data instanceof Uint8Array)) fail()
    validPath(file.path, paths)
    if (file.data.length > PACKAGE_LIMITS.maxFileBytes) fail('PACKAGE_LIMIT')
    total += file.data.length
    if (total > PACKAGE_LIMITS.maxTotalBytes) fail('PACKAGE_LIMIT')
    const name = encoder.encode(file.path)
    zipLength += 30 + name.length + file.data.length + 46 + name.length
    return { name, data: file.data, crc: crc32(file.data), offset: 0 }
  })
  if (zipLength > PACKAGE_LIMITS.maxZipBytes) fail('PACKAGE_LIMIT')
  const bytes = new Uint8Array(zipLength)
  const view = new DataView(bytes.buffer)
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true)
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true)
  let pos = 0
  for (const entry of entries) {
    entry.offset = pos
    u32(pos, LOCAL); u16(pos + 4, 20); u16(pos + 6, UTF8)
    u16(pos + 12, 33) // 1980-01-01; stable exports, no local clock metadata.
    u32(pos + 14, entry.crc); u32(pos + 18, entry.data.length); u32(pos + 22, entry.data.length)
    u16(pos + 26, entry.name.length)
    bytes.set(entry.name, pos + 30); bytes.set(entry.data, pos + 30 + entry.name.length)
    pos += 30 + entry.name.length + entry.data.length
  }
  const centralOffset = pos
  for (const entry of entries) {
    u32(pos, CENTRAL); u16(pos + 4, 20); u16(pos + 6, 20); u16(pos + 8, UTF8)
    u16(pos + 14, 33)
    u32(pos + 16, entry.crc); u32(pos + 20, entry.data.length); u32(pos + 24, entry.data.length)
    u16(pos + 28, entry.name.length); u32(pos + 42, entry.offset)
    bytes.set(entry.name, pos + 46)
    pos += 46 + entry.name.length
  }
  u32(pos, END); u16(pos + 8, entries.length); u16(pos + 10, entries.length)
  u32(pos + 12, pos - centralOffset); u32(pos + 16, centralOffset)
  return bytes
}

/** Parses only the bounded v1 ZIP subset; never extracts paths to disk. */
export function decodePackageZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (!(bytes instanceof Uint8Array)) fail()
  if (bytes.length > PACKAGE_LIMITS.maxZipBytes) fail('PACKAGE_LIMIT')
  if (bytes.length < 22) fail()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (offset: number) => view.getUint16(offset, true)
  const u32 = (offset: number) => view.getUint32(offset, true)
  const end = bytes.length - 22
  if (u32(end) !== END) fail() // Also rejects archive comments and trailing payloads.
  if (u16(end + 4) || u16(end + 6) || u16(end + 20)) fail('PACKAGE_UNSUPPORTED')
  const count = u16(end + 10)
  if (u16(end + 8) !== count) fail('PACKAGE_UNSUPPORTED')
  if (count === 0xffff || u32(end + 12) === 0xffffffff || u32(end + 16) === 0xffffffff) fail('PACKAGE_UNSUPPORTED')
  if (count > PACKAGE_LIMITS.maxFiles) fail('PACKAGE_LIMIT')
  const centralOffset = u32(end + 16)
  const centralSize = u32(end + 12)
  if (centralOffset + centralSize !== end) fail()
  const paths = new Set<string>()
  const result = new Map<string, Uint8Array>()
  let pos = centralOffset
  let localPos = 0
  let total = 0
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== CENTRAL) fail()
    const madeBy = u16(pos + 4)
    const version = u16(pos + 6)
    if ((version !== 10 && version !== 20) || ![0, 3].includes(madeBy >>> 8)) fail('PACKAGE_UNSUPPORTED')
    if (u16(pos + 8) !== UTF8 || u16(pos + 10) !== 0) fail('PACKAGE_UNSUPPORTED')
    const compressed = u32(pos + 20)
    const length = u32(pos + 24)
    if (compressed === 0xffffffff || length === 0xffffffff || u32(pos + 42) === 0xffffffff) fail('PACKAGE_UNSUPPORTED')
    if (length > PACKAGE_LIMITS.maxFileBytes || compressed > PACKAGE_LIMITS.maxFileBytes) fail('PACKAGE_LIMIT')
    if (compressed !== length) fail('PACKAGE_INTEGRITY')
    total += length
    if (total > PACKAGE_LIMITS.maxTotalBytes) fail('PACKAGE_LIMIT')
    const nameLength = u16(pos + 28)
    if (u16(pos + 30) || u16(pos + 32) || u16(pos + 34)) fail('PACKAGE_UNSUPPORTED')
    const attributes = u32(pos + 38)
    const kind = (attributes >>> 16) & 0xf000
    if ((attributes & 0x10) || (kind !== 0 && kind !== 0x8000)) fail('PACKAGE_UNSUPPORTED')
    if (pos + 46 + nameLength > end) fail()
    let path: string
    try { path = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength)) } catch { fail('PACKAGE_PATH') }
    validPath(path, paths)
    const offset = u32(pos + 42)
    if (offset !== localPos || offset + 30 > centralOffset || u32(offset) !== LOCAL) fail()
    if (u16(offset + 28)) fail('PACKAGE_UNSUPPORTED')
    if (u16(offset + 4) !== version || u16(offset + 6) !== u16(pos + 8) || u16(offset + 8) !== u16(pos + 10)
      || u16(offset + 10) !== u16(pos + 12) || u16(offset + 12) !== u16(pos + 14)
      || u32(offset + 14) !== u32(pos + 16) || u32(offset + 18) !== compressed || u32(offset + 22) !== length
      || u16(offset + 26) !== nameLength) fail('PACKAGE_INTEGRITY')
    const dataOffset = offset + 30 + nameLength
    const dataEnd = dataOffset + length
    if (dataEnd > centralOffset) fail()
    for (let n = 0; n < nameLength; n++) if (bytes[offset + 30 + n] !== bytes[pos + 46 + n]) fail('PACKAGE_INTEGRITY')
    const data = bytes.subarray(dataOffset, dataEnd)
    if (crc32(data) !== u32(pos + 16)) fail('PACKAGE_INTEGRITY')
    result.set(path, new Uint8Array(data)) // Also copies Node Buffers, whose slice() aliases memory.
    localPos = dataEnd
    pos += 46 + nameLength
  }
  if (pos !== end || localPos !== centralOffset) fail()
  return result
}
