import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createAppServer } from '../../server/index.mjs'

const galleryInput = () => ({
  requestId: 'gallery-request', baseRevision: 4, prompt: '配置作品图片',
  block: { id: 'gallery', name: '作品画廊', type: 'gallery', imageIds: [], layout: 'grid', interaction: 'preview' },
  assets: [{ id: 'cover', name: '项目封面', mimeType: 'image/png', altText: '封面' }],
})
const envelope = candidate => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(candidate) } }] })
const candidate = (input, commands, capabilityIds = []) => ({
  request: { requestId: input.requestId, baseRevision: input.baseRevision, commands }, capabilityIds,
})

async function fixture(t, makeCandidate) {
  let calls = 0
  const server = createAppServer({
    apiKey: 'offline-gallery-key',
    fieldPlanning: { enabled: true, resolveAccess: () => true },
    fetchImpl: async (_url, init) => {
      calls++
      const input = JSON.parse(JSON.parse(init.body).messages[1].content)
      return Response.json(envelope(makeCandidate(input)))
    },
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    calls: () => calls,
    post: (body = galleryInput(), headers = {}) => fetch(`${origin}/api/mochi-plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }),
    status: () => fetch(`${origin}/api/mochi-plan/status`).then(response => response.json()),
  }
}

test('gallery HTTP plan configures selected assets and exposes offline provenance', async t => {
  const f = await fixture(t, input => candidate(input, [{ type: 'configureGallery', blockId: 'gallery', imageIds: ['cover'], layout: 'grid' }]))
  assert.deepEqual(await f.status(), { enabled: true, reason: null, source: 'offline-fixture', model: 'deepseek-v4-flash' })
  const response = await f.post(); assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.source, 'offline-fixture')
  assert.deepEqual(result.candidate.request.commands, [{ type: 'configureGallery', blockId: 'gallery', imageIds: ['cover'], layout: 'grid' }])
  assert.equal(f.calls(), 1)
})

test('generation HTTP accepts an empty-resource gallery without any asset bytes', async t => {
  const spec = {
    version: 1, id: 'generated-gallery', name: '图片画廊', entities: [], relations: [],
    blocks: [{ id: 'gallery', name: '作品画廊', type: 'gallery', protocolVersion: 1, imageIds: [], layout: 'grid', interaction: 'preview' }],
  }
  let captured
  const server = createAppServer({
    apiKey: 'offline-generation-key', generationAccess: () => true,
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(init.body)
      return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(spec) } }] })
    },
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea: '展示项目图片' }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), spec)
  assert.match(captured.messages[0].content, /gallery/)
  assert.match(captured.messages[0].content, /不要输出 data URL/)
  assert.equal(captured.messages[1].content, '展示项目图片')
})

test('gallery HTTP plan permits add and remove only with the gallery capability and exact selection', async t => {
  const add = await fixture(t, input => candidate(input, [{ type: 'addBlock', block: {
    id: 'gallery-2', name: '第二画廊', type: 'gallery', protocolVersion: 1, imageIds: ['cover'], layout: 'grid', interaction: 'preview',
  } }], ['gallery']))
  assert.equal((await add.post()).status, 200)
  const remove = await fixture(t, input => candidate(input, [{ type: 'removeBlock', blockId: input.block.id }]))
  assert.equal((await remove.post()).status, 200)
})

for (const [name, mutate] of [
  ['unknown asset', input => ({ type: 'configureGallery', blockId: input.block.id, imageIds: ['missing'] })],
  ['other block', input => ({ type: 'removeBlock', blockId: 'other' })],
  ['asset mutation', input => ({ type: 'removeProjectAsset', assetId: 'cover' })],
]) test(`gallery HTTP rejects ${name} without a successful plan`, async t => {
  const f = await fixture(t, input => candidate(input, [mutate(input)]))
  const response = await f.post(); assert.equal(response.status, 502)
  assert.equal((await response.json()).error.code, 'AI_INVALID_RESPONSE')
  assert.equal(f.calls(), 1)
})

test('gallery HTTP rejects forged capabilities, external fields, and invalid input before provider', async t => {
  const f = await fixture(t, input => candidate(input, [{ type: 'configureGallery', blockId: input.block.id, imageIds: [] }], ['gallery']))
  const forged = { ...galleryInput(), records: { private: true } }
  assert.equal((await f.post(forged)).status, 400)
  assert.equal((await f.post(galleryInput(), { Origin: 'https://untrusted.invalid' })).status, 403)
  assert.equal(f.calls(), 0)
  const response = await f.post()
  assert.equal(response.status, 502)
  assert.equal((await response.json()).error.code, 'AI_INVALID_RESPONSE')
  assert.equal(f.calls(), 1)
})

for (const [name, mutate] of [
  ['asset bytes', input => { input.assets[0].dataUrl = 'data:image/png;base64,iVBORw0KGgo=' }],
  ['remote asset URL', input => { input.assets[0].url = 'https://untrusted.invalid/image.png' }],
  ['unknown image reference', input => { input.block.imageIds = ['missing'] }],
  ['duplicate asset ID', input => { input.assets.push({ ...input.assets[0] }) }],
  ['duplicate image reference', input => { input.block.imageIds = ['cover', 'cover'] }],
  ['unsupported asset type', input => { input.assets[0].mimeType = 'image/svg+xml' }],
]) test(`gallery HTTP rejects input ${name} before provider`, async t => {
  const f = await fixture(t, input => candidate(input, []))
  const input = galleryInput(); mutate(input)
  assert.equal((await f.post(input)).status, 400)
  assert.equal(f.calls(), 0)
})

test('gallery HTTP rejects missing add capability, duplicate remove, and post-remove configuration', async t => {
  for (const commands of [
    [{ type: 'addBlock', block: { id: 'gallery-2', name: '画廊', type: 'gallery', protocolVersion: 1, imageIds: [], layout: 'grid', interaction: 'preview' } }],
    [{ type: 'removeBlock', blockId: 'gallery' }, { type: 'removeBlock', blockId: 'gallery' }],
    [{ type: 'removeBlock', blockId: 'gallery' }, { type: 'configureGallery', blockId: 'gallery', imageIds: [] }],
  ]) {
    const f = await fixture(t, input => candidate(input, commands))
    const response = await f.post(); assert.equal(response.status, 502)
    assert.equal((await response.json()).error.code, 'AI_INVALID_RESPONSE')
    assert.equal(f.calls(), 1)
  }
})
