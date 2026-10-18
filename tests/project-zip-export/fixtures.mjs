import { createRequire } from 'node:module'
import { protocol } from '../../server/custom-block/protocol.mjs'
import { trustedSample } from '../../tools/custom-block-compiler/trusted-samples.mjs'
const require = createRequire(import.meta.url)
export const { createReadingLogExample, createClubRegistrationExample, createAppRuntime } = require('../custom-block/fixtures.cjs')
export function builtin() { return { project: protocol.migrateProjectState(createClubRegistrationExample()), artifacts: [] } }
export async function mixed() {
  const input = builtin()
  for (const name of ['counter', 'temperature']) {
    const entry = await trustedSample(name)
    input.artifacts.push(entry)
    input.project.custom.instances.push({ id: name, definitionId: entry.artifact.manifest.definitionId, versionDigest: entry.versionDigest, props: { initial: name === 'counter' ? 7 : 20 } })
    input.project.custom.positions[name] = { x: name === 'counter' ? 0 : 1, y: .7 }
    input.project.renderOrder.push({ kind: 'custom', id: name })
  }
  input.project.base.blockPositions['registration-form'] = { x: .25, y: .1 }
  input.project.renderOrder = [input.project.renderOrder[4], ...input.project.renderOrder.slice(0, 4)]
  return input
}
export async function rehash(input, index = 0) {
  const entry = input.artifacts[index], old = entry.versionDigest
  entry.versionDigest = await protocol.computeVersionDigest(entry.artifact)
  for (const instance of input.project.custom.instances) if (instance.versionDigest === old) instance.versionDigest = entry.versionDigest
  return input
}
// Independent reader used only in tests; verifies headers and CRC, never extracts
// a supplied archive to disk or trusts the exporter's file listing.
export function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const result = new Map(), decoder = new TextDecoder('utf-8', { fatal: true })
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    if (view.getUint16(offset + 8, true) !== 0 || view.getUint16(offset + 6, true) !== 0x800) throw new Error('ZIP_HEADER')
    const size = view.getUint32(offset + 18, true), length = view.getUint16(offset + 26, true)
    if (size !== view.getUint32(offset + 22, true)) throw new Error('ZIP_SIZE')
    const path = decoder.decode(bytes.slice(offset + 30, offset + 30 + length))
    const data = bytes.slice(offset + 30 + length, offset + 30 + length + size)
    let crc = 0xffffffff
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1 }
    if (((~crc) >>> 0) !== view.getUint32(offset + 14, true)) throw new Error('ZIP_CRC')
    result.set(path, decoder.decode(data)); offset += 30 + length + size
  }
  const directory = offset
  for (const [path] of result) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP_CENTRAL')
    const length = view.getUint16(offset + 28, true)
    if (decoder.decode(bytes.slice(offset + 46, offset + 46 + length)) !== path) throw new Error('ZIP_CENTRAL_NAME')
    offset += 46 + length
  }
  if (view.getUint32(offset, true) !== 0x06054b50 || view.getUint16(offset + 10, true) !== result.size || view.getUint32(offset + 16, true) !== directory || view.getUint32(offset + 12, true) !== offset - directory || offset + 22 !== bytes.length) throw new Error('ZIP_END')
  return result
}
