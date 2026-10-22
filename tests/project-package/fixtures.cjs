const { deflateSync } = require('node:zlib')
const { api, createClubRegistrationExample, createAppRuntime } = require('../custom-block/fixtures.cjs')

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, body) {
  const content = Buffer.concat([Buffer.from(type), body])
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4)
  length.writeUInt32BE(body.length); checksum.writeUInt32BE(crc32(content))
  return Buffer.concat([length, content, checksum])
}
// A real 2x2 RGBA PNG with valid chunk checksums and zlib scanlines. No network,
// image generator, API key, or external image decoder is needed to build it.
const header = Buffer.alloc(13)
header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6
const pngBytes = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
  chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]))),
  chunk('IEND', Buffer.alloc(0)),
])
function makeGalleryState() {
  const state = createClubRegistrationExample()
  state.revision = 7
  state.spec.version = 2
  state.spec.name = '项目包离线验收'
  state.spec.blocks.push(
    { id: 'package-gallery', name: '项目图片', type: 'gallery', protocolVersion: 1, imageIds: ['fixture-png'], layout: 'grid', interaction: 'preview' },
    { id: 'package-timer', name: '离线计时器', type: 'pomodoro', protocolVersion: 1, durationSeconds: 120 },
  )
  state.assets = { 'fixture-png': { id: 'fixture-png', name: '固定像素.png', altText: '红绿蓝白四像素', mimeType: 'image/png', dataUrl: `data:image/png;base64,${pngBytes.toString('base64')}` } }
  state.timers = { 'package-timer': { remainingMs: 61000, startedAt: null } }
  state.blockPositions = { 'registration-form': { x: .1, y: .2 }, 'package-gallery': { x: .6, y: .3 } }
  state.records.applicants[0].values['applicant-name'] = 'ZIP 保留记录'
  return state
}
function makeGalleryProject() {
  const project = api.migrateProjectState(makeGalleryState())
  project.renderOrder = ['package-gallery', 'registration-form', 'applicant-list', 'package-timer', 'applicant-total'].map(id => ({ kind: 'builtin', id }))
  return project
}
function createLegacyFixture() {
  const state = createClubRegistrationExample()
  state.revision = 3
  state.spec.name = '旧版离线项目'
  state.records.applicants[0].values['applicant-name'] = '旧项目保留记录'
  return state
}
function makeGalleryRuntime() {
  const project = makeGalleryProject()
  return createAppRuntime({ revision: project.revision, ...project.base }, [], project)
}
module.exports = { pngBytes, makeGalleryState, makeGalleryProject, makeGalleryRuntime, createLegacyFixture }
