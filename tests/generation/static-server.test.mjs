import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { once } from 'node:events'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { createAppServer } from '../../server/index.mjs'

test('combined server retains static pages/assets and rejects API/path traversal', async t => {
  const staticDir = await mkdtemp(path.join(os.tmpdir(), 'blockcraft-static-'))
  await mkdir(path.join(staticDir, 'assets'))
  await writeFile(path.join(staticDir, 'index.html'), '<h1>BlockCraft</h1>')
  await writeFile(path.join(staticDir, 'assets', 'app.js'), 'export const ok = true')
  t.after(() => rm(staticDir, { recursive: true, force: true }))
  const server = createAppServer({ apiKey: '', staticDir })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await fetch(`${base}/ai-create`)
  assert.equal(page.status, 200)
  assert.equal(await page.text(), '<h1>BlockCraft</h1>')
  const asset = await fetch(`${base}/assets/app.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type'), /javascript/)
  assert.equal(await asset.text(), 'export const ok = true')
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404)
  const traversalStatus = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/%2fsecret`, response => {
      response.resume()
      resolve(response.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(traversalStatus, 400)
})
