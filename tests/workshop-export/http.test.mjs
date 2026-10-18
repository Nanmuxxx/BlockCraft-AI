import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createLocalExportHandler, MAX_BODY_BYTES } from '../../server/project-export/local-http.mjs'
import { builtin, mixed, rehash, unzip } from '../project-zip-export/fixtures.mjs'

async function server(t) {
  let handler
  const app = http.createServer((req, res) => handler(req, res))
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${app.address().port}`
  handler = createLocalExportHandler({ token: 'test-capability', origin })
  t.after(() => { app.closeAllConnections(); return new Promise(resolve => app.close(resolve)) })
  const headers = { Origin: origin, Authorization: 'Bearer test-capability', 'Content-Type': 'application/json' }
  return { origin, post: (input, overrides = {}) => new Promise((resolve, reject) => {
    const req = http.request(`${origin}/api/local-project-export`, { method: 'POST', headers: { ...headers, ...overrides } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })))
    })
    req.on('error', reject)
    req.end(typeof input === 'string' ? input : JSON.stringify(input))
  }) }
}

test('local capability + exact Origin/Host required; errors contain no project data or ZIP', async t => {
  const { post, origin } = await server(t)
  for (const headers of [{ Authorization: '' }, { Authorization: 'Bearer incorrect' }, { Origin: 'https://evil.example' }, { Origin: '' }, { Host: 'evil.example' }]) {
    const response = await post(builtin(), headers)
    assert.equal(response.status, 403)
    assert.doesNotMatch(response.headers.get('Content-Type') ?? '', /zip/)
    assert.doesNotMatch(await response.text(), /registration|姓名|PK/)
  }
  assert.equal((await fetch(`${origin}/api/local-project-export`, { method: 'OPTIONS' })).status, 403)
})

test('reject malformed, oversized and unsupported media requests', async t => {
  const { post } = await server(t)
  assert.equal((await post('{')).status, 400)
  assert.equal((await post(builtin(), { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await post('x'.repeat(MAX_BODY_BYTES + 1))).status, 413)
})

test('real HTTP returns complete builtins and exact CustomBlock sources, retaining no previous project', async t => {
  const { post } = await server(t)
  const first = mixed()
  const response = await post(await first)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'application/zip')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const files = unzip(new Uint8Array(await response.arrayBuffer()))
  assert.equal(files.size, 17)
  assert(files.has('src/components/custom/a0/src/Counter.tsx') || [...files.keys()].some(p => p.endsWith('Counter.tsx')))
  const second = await post(builtin())
  const otherFiles = unzip(new Uint8Array(await second.arrayBuffer()))
  assert.equal(otherFiles.size, 14)
  assert(![...otherFiles.keys()].some(p => p.includes('/custom/')))
})

test('missing, tampered and unsupported protocol artifacts reject the WHOLE response', async t => {
  const { post } = await server(t)
  const missing = await mixed(); missing.artifacts.pop()
  const tampered = await mixed(); tampered.artifacts[0].artifact.sources['Counter.tsx'] += '\n// changed'
  const unsupported = await mixed()
  unsupported.artifacts[0].artifact.manifest.events = { changed: { type: 'object', properties: {}, required: [], additionalProperties: false } }
  await rehash(unsupported)
  for (const [input, code] of [[missing, 'VERSION_MISSING'], [tampered, 'DIGEST_MISMATCH'], [unsupported, 'UNSUPPORTED_PROTOCOL']]) {
    const response = await post(input)
    assert.equal(response.status, 422)
    assert.deepEqual(await response.json(), { code })
  }
})
