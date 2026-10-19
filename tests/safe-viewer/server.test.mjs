import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { start } from './serve.mjs'
import { createSafeViewerService } from '../../server/safe-viewer/index.mjs'

const running = await start({ hostName: '127.0.0.1', runnerHostNames: ['127.0.0.2'] })
test.after(() => running.stop())

async function compile(body, origin = running.hostOrigin, contentType = 'application/json') {
  return fetch(`${running.hostOrigin}/api/safe-viewer/compile`, {
    method: 'POST',
    headers: { 'content-type': contentType, origin },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function requestOf(key) {
  const fixture = structuredClone(running.fixtures[key])
  return { protocol: 'blockcraft-safe-viewer/1', instance: fixture.instance, artifact: fixture.artifact }
}

function rawGet(url, host) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: { host },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('error', reject)
    request.end()
  })
}

test('valid artifact compiles, caches, and serves an immutable runner session', async () => {
  const first = await compile(requestOf('counter'))
  assert.equal(first.status, 200)
  const body = await first.json()
  assert.equal(body.cache, 'build')
  assert.match(body.bundleDigest, /^sha256:[0-9a-f]{64}$/)
  assert.match(body.runnerUrl, /^http:\/\/127\.0\.0\.2:\d+\/runner\?session=/)

  const second = await compile(requestOf('counter'))
  assert.equal(second.status, 200)
  assert.equal((await second.json()).cache, 'hit')

  const runner = await fetch(body.runnerUrl)
  assert.equal(runner.status, 200)
  const csp = runner.headers.get('content-security-policy')
  assert.match(csp, /sandbox allow-scripts/)
  assert.match(csp, /connect-src 'none'/)
  assert.match(csp, /frame-ancestors http:\/\/127\.0\.0\.1:\d+/)
  assert.equal(runner.headers.get('origin-agent-cluster'), '?1')
  assert.equal(runner.headers.get('access-control-allow-origin'), null)
  const html = await runner.text()
  assert.match(html, /\/runner\/bundle\/[0-9a-f]{64}\.js\?session=/)

  const bundle = await fetch(body.bundleUrl)
  assert.equal(bundle.status, 200)
  assert.equal(bundle.headers.get('access-control-allow-origin'), '*')
  const code = Buffer.from(await bundle.arrayBuffer())
  assert.equal(`sha256:${createHash('sha256').update(code).digest('hex')}`, body.bundleDigest)
  assert.ok(code.byteLength <= 524_288)
  assert.equal(bundle.headers.get('content-type'), 'application/javascript; charset=utf-8')
})

test('compile only accepts exact same-origin protocol requests', async () => {
  const wrongOrigin = await compile(requestOf('counter'), 'http://evil.test')
  assert.equal(wrongOrigin.status, 403)
  assert.equal((await wrongOrigin.json()).error.code, 'ORIGIN_REJECTED')

  const wrongType = await compile(requestOf('counter'), running.hostOrigin, 'text/plain')
  assert.equal(wrongType.status, 415)
  assert.equal((await wrongType.json()).error.code, 'CONTENT_TYPE_REJECTED')

  const wrongProtocol = await compile({ ...requestOf('counter'), protocol: 'custom-block/1' })
  assert.equal(wrongProtocol.status, 422)
  assert.equal((await wrongProtocol.json()).error.code, 'INVALID_PROTOCOL')

  const unknown = await compile({ ...requestOf('counter'), extra: true })
  assert.equal(unknown.status, 400)
  assert.equal((await unknown.json()).error.code, 'INVALID_REQUEST')
})

test('digest, import, source capability and bundle limits fail closed', async () => {
  const mismatched = requestOf('counter')
  mismatched.instance.versionDigest = `sha256:${'0'.repeat(64)}`
  const digest = await compile(mismatched)
  assert.equal(digest.status, 422)
  assert.equal((await digest.json()).error.code, 'DIGEST_MISMATCH')

  const illegal = await compile(requestOf('illegal-import'))
  assert.equal(illegal.status, 422)
  assert.equal((await illegal.json()).error.code, 'IMPORT_REJECTED')

  const staticAttack = await compile(requestOf('attack-static'))
  assert.equal(staticAttack.status, 422)
  assert.equal((await staticAttack.json()).error.code, 'SOURCE_CAPABILITY_REJECTED')

  const oversized = await compile(requestOf('bundle-limit'))
  assert.equal(oversized.status, 422)
  assert.equal((await oversized.json()).error.code, 'BUNDLE_LIMIT')
})

test('request bodies and runner sessions are bounded', async () => {
  const huge = await compile('x'.repeat(512 * 1024 + 1))
  assert.equal(huge.status, 413)
  assert.equal((await huge.json()).error.code, 'REQUEST_TOO_LARGE')

  const missing = await fetch(`${running.runnerOrigin}/runner?session=not-a-session`)
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'SESSION_EXPIRED')

  const wrongHost = await rawGet(`${running.runnerOrigin}/runner?session=not-a-session`, 'example.test')
  assert.equal(wrongHost.status, 403)
})

test('the runner refuses same-host deployments and the service defaults off', async () => {
  const service = createSafeViewerService({ enabled: false })
  assert.throws(() => service.setOrigins({ parentOrigin: 'http://same.test:1', runnerOrigin: 'http://same.test:2' }), { code: 'ORIGIN_REJECTED' })
  await assert.rejects(service.compile(requestOf('counter'), { origin: 'http://app.test' }), { code: 'VIEWER_DISABLED' })
  service.dispose()
})

test('compiler timeout is a bounded failure', async () => {
  const service = createSafeViewerService({ enabled: true, compileTimeoutMs: 1 })
  service.setOrigins({ parentOrigin: 'http://app.test', runnerOrigin: 'http://runner.test' })
  await assert.rejects(service.compile(requestOf('counter'), { origin: 'http://app.test' }), error => ['COMPILE_TIMEOUT', 'COMPILER_BUSY'].includes(error.code))
  service.dispose()
})
