// STORE-only ZIP: bounded allocation, fixed DOS epoch, UTF-8, no compression or IO.
export class ProjectExportError extends Error {
  constructor(code, reason) { super(reason ? `${code}: ${reason}` : code); this.name = 'ProjectExportError'; this.code = code; if (reason) this.reason = reason }
}
export function ensure(value, code) { if (!value) throw new ProjectExportError(code) }
export const ZIP_LIMITS = Object.freeze({ maxFiles: 256, maxFileBytes: 524288, maxTotalBytes: 4194304, maxZipBytes: 4259840 })
const encoder = new TextEncoder()
const roots = new Set(['package.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'README.md', 'provenance.json'])
export function assertOutputPath(path) {
  ensure(typeof path === 'string' && path.length <= 240 && (roots.has(path) || /^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:ts|tsx|css|json)$/.test(path)), 'OUTPUT_PATH')
  ensure(!path.split('/').some(part => /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)), 'OUTPUT_PATH')
}
function limitsFor(overrides) {
  ensure(overrides && typeof overrides === 'object' && !Array.isArray(overrides), 'LIMIT_CONFIG')
  ensure(Object.keys(overrides).every(key => Object.hasOwn(ZIP_LIMITS, key)), 'LIMIT_CONFIG')
  const limits = { ...ZIP_LIMITS, ...overrides }
  for (const key of Object.keys(limits)) ensure(Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= ZIP_LIMITS[key], 'LIMIT_CONFIG')
  return limits
}
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
/** Internal serializer. Accepts text only, never paths to read or prebuilt archives. */
export function encodeProjectZip(files, overrides = {}) {
  const limits = limitsFor(overrides)
  ensure(Array.isArray(files) && files.length > 0 && files.length <= limits.maxFiles, 'FILE_COUNT_LIMIT')
  const seen = new Set(), entries = []
  let total = 0, zipBytes = 22
  for (const { path, content } of files) {
    assertOutputPath(path)
    ensure(!seen.has(path.toLowerCase()), 'OUTPUT_COLLISION'); seen.add(path.toLowerCase())
    ensure(!files.some(file => file.path.startsWith(`${path}/`)), 'OUTPUT_COLLISION')
    ensure(typeof content === 'string' && content.length <= limits.maxFileBytes, 'FILE_SIZE_LIMIT')
    const data = encoder.encode(content), name = encoder.encode(path)
    ensure(data.length <= limits.maxFileBytes, 'FILE_SIZE_LIMIT')
    total += data.length; zipBytes += data.length + name.length * 2 + 76
    ensure(total <= limits.maxTotalBytes, 'TOTAL_SIZE_LIMIT')
    ensure(zipBytes <= limits.maxZipBytes, 'ZIP_SIZE_LIMIT')
    entries.push({ path, name, data, crc: crc32(data) })
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const bytes = new Uint8Array(zipBytes), view = new DataView(bytes.buffer)
  const u16 = (offset, n) => view.setUint16(offset, n, true)
  const u32 = (offset, n) => view.setUint32(offset, n, true)
  let offset = 0
  for (const entry of entries) {
    entry.offset = offset
    u32(offset, 0x04034b50); u16(offset + 4, 20); u16(offset + 6, 0x800)
    u16(offset + 12, 33) // 1980-01-01 00:00:00, independent of timezone.
    u32(offset + 14, entry.crc); u32(offset + 18, entry.data.length); u32(offset + 22, entry.data.length)
    u16(offset + 26, entry.name.length)
    bytes.set(entry.name, offset + 30); bytes.set(entry.data, offset + 30 + entry.name.length)
    offset += 30 + entry.name.length + entry.data.length
  }
  const directory = offset
  for (const entry of entries) {
    u32(offset, 0x02014b50); u16(offset + 4, 20); u16(offset + 6, 20); u16(offset + 8, 0x800)
    u16(offset + 14, 33); u32(offset + 16, entry.crc)
    u32(offset + 20, entry.data.length); u32(offset + 24, entry.data.length); u16(offset + 28, entry.name.length)
    u32(offset + 42, entry.offset); bytes.set(entry.name, offset + 46)
    offset += 46 + entry.name.length
  }
  u32(offset, 0x06054b50); u16(offset + 8, entries.length); u16(offset + 10, entries.length)
  u32(offset + 12, offset - directory); u32(offset + 16, directory)
  return bytes
}
