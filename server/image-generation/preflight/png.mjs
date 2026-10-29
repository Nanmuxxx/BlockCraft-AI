import { createHash } from 'node:crypto'
import { crc32, inflateSync } from 'node:zlib'

// A deliberately narrower admission policy, not a change to ProjectAsset/HTTP v1.
export const CANDIDATE_LIMITS = Object.freeze({ bytes: 524288, width: 1024, height: 1024,
  pixels: 1048576, scanlineBytes: 4195328, base64Chars: 699052 })
const invalid = () => { throw Object.assign(new Error('INVALID_IMAGE'), { code: 'INVALID_IMAGE' }) }
const signature = Buffer.from([137,80,78,71,13,10,26,10])

/** Validate a static 8-bit noninterlaced PNG without loading a general image codec.
 * No palette/metadata/animation/URL support. Reject unsupported input; never silently transcode.
 * Returns owned bytes only: neither provenance, adoption, moderation nor a billing receipt.
 */
export function validateCandidatePng(input, expected) {
  if (!(input instanceof Uint8Array) || input.byteLength < 57 || input.byteLength > CANDIDATE_LIMITS.bytes) invalid()
  const bytes = Buffer.from(input) // only copy after the byte cap
  if (!bytes.subarray(0,8).equals(signature)) invalid()
  let width, height, channels, ended = false, idat = false
  const parts = []
  for (let p = 8; p < bytes.length;) {
    if (p + 12 > bytes.length) invalid()
    const n = bytes.readUInt32BE(p)
    if (n > bytes.length - p - 12) invalid()
    const typeBytes = bytes.subarray(p+4,p+8)
    if (!typeBytes.every(x => x >= 65 && x <= 90 || x >= 97 && x <= 122)) invalid()
    const type = typeBytes.toString('ascii')
    if (crc32(bytes.subarray(p+4,p+8+n)) !== bytes.readUInt32BE(p+8+n)) invalid()
    if (p === 8) {
      if (type !== 'IHDR' || n !== 13) invalid()
      width = bytes.readUInt32BE(p+8); height = bytes.readUInt32BE(p+12)
      channels = ({0:1,2:3,4:2,6:4})[bytes[p+17]]
      if (!width || !height || width > CANDIDATE_LIMITS.width || height > CANDIDATE_LIMITS.height
        || width * height > CANDIDATE_LIMITS.pixels || bytes[p+16] !== 8 || !channels
        || bytes[p+18] !== 0 || bytes[p+19] !== 0 || bytes[p+20] !== 0) invalid()
    } else if (type === 'IDAT') { idat = true; parts.push(bytes.subarray(p+8,p+8+n)) }
    else if (type === 'IEND') {
      if (n !== 0 || !idat || p+12 !== bytes.length) invalid()
      ended = true
    } else invalid()
    p += n+12
  }
  if (!ended || expected && (expected.mimeType !== 'image/png' || expected.width !== width || expected.height !== height)) invalid()
  const row = width * channels + 1, length = row * height
  if (length > CANDIDATE_LIMITS.scanlineBytes) invalid()
  try {
    const compressed = Buffer.concat(parts)
    const { buffer, engine } = inflateSync(compressed, { maxOutputLength: length, info: true })
    if (engine.bytesWritten !== compressed.length || buffer.length !== length) invalid()
    for (let p = 0; p < length; p += row) if (buffer[p] > 4) invalid()
  } catch { invalid() }
  return Object.freeze({ state: 'VALIDATED_BYTES_ONLY', mimeType: 'image/png', width, height,
    bytes, sha256: createHash('sha256').update(bytes).digest('hex') })
}

export function decodeCandidateBase64(value, expected) {
  if (typeof value !== 'string' || !value.length || value.length > CANDIDATE_LIMITS.base64Chars
    || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) invalid()
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) invalid()
  return validateCandidatePng(bytes, expected)
}
