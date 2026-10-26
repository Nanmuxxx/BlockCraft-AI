import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../..')
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
const port = probe.address().port; await new Promise(r => probe.close(r))
const child = spawn(process.execPath, [resolve(root, 'server/index.mjs')], {
  cwd: '/tmp', env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), DEEPSEEK_API_KEY: '', PUBLIC_ORIGIN: '' }, stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', d => process.stdout.write(d)); child.stderr.on('data', d => process.stderr.write(d))
const base = `http://127.0.0.1:${port}`
const request = (path, init) => fetch(base + path, { ...init, signal: AbortSignal.timeout(3000), redirect: 'error' })
try {
  for (let i = 0; ; i++) {
    try { const r = await request('/api/health'); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { status: 'ok' }); break }
    catch (e) { if (i === 39) throw e; await new Promise(r => setTimeout(r, 100)) }
  }
  console.log('PASS health JSON; production CLI started from /tmp, clean environment/no credentials')
  const r = await request('/'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^text\/html/)
  const html = await r.text(); assert.match(html, /id="root"/)
  for (const path of ['/ai-create', '/app-renderer']) {
    const r = await request(path); assert.equal(r.status, 200); assert.equal(await r.text(), html)
  }
  console.log('PASS entry document and both SPA paths')
  for (const body of [{ idea: 'offline smoke' }, { idea: 'offline smoke', protocol: 'trusted-interactive/1' }]) {
    for (const headers of [{}, { Authorization: 'Bearer offline-invalid', Origin: base, 'X-Forwarded-For': '127.0.0.1' }]) {
      const r = await request('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
      assert.equal(r.status, 401); assert.match(r.headers.get('content-type'), /^application\/json/); assert.equal((await r.json()).error.code, 'UNAUTHORIZED')
    }
  }
  console.log('PASS anonymous/forged bearer v1 and trusted-interactive/1(v2) -> 401 JSON UNAUTHORIZED')
  console.log('PASS local source CLI smoke only; NOT a Docker or HTTPS test')
} finally {
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited
}
