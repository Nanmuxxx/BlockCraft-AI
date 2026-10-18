/** Offline acceptance harness ONLY. Not imported by app/server; never loads .env. */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createMochiHandler } from '../../server/mochi-ai/http.mjs'
import { createMochiService } from '../../server/mochi-ai/service.mjs'
import { createDeepSeekProvider } from '../../server/mochi-ai/provider.mjs'
import { advice, envelope, grant, access } from './fixtures.mjs'
export async function startBrowserHarness() {
  let calls = 0, failure = false, disabled = false
  const captures = []
  const provider = createDeepSeekProvider({ apiKey: 'OFFLINE-FIXTURE-NOT-A-KEY', model: 'offline-fixture', fetchImpl: async (_url, init) => {
    calls++; const input = JSON.parse(JSON.parse(init.body).messages[1].content); captures.push(input)
    if (failure) return new Response('offline failure', { status: 503 })
    return envelope(input.kind === 'proactive' ? { message: '新增了日期字段。可以再明确一下活动地点，让参与者更好安排。', suggestions: [{ ...advice().suggestions[0], text: '要不要补充活动地点？', reason: '时间和地点一起展示，更方便参与者安排出行。', priority: 'high' }] } : advice())
  } })
  const service = createMochiService({ provider, enabled: true, approval: grant(Date.now()) })
  const disabledService = createMochiService({ provider })
  let handler
  const files = new Map([
    ['/', new URL('./harness.html', import.meta.url)],
    ['/client.mjs', new URL('../../src/integrations/mochi-ai/client.mjs', import.meta.url)],
    ['/protocol.mjs', new URL('../../src/integrations/mochi-ai/protocol.mjs', import.meta.url)],
    ['/fixtures.mjs', new URL('./fixtures.mjs', import.meta.url)],
    ['/mochi.png', new URL('../../src/assets/mochi.png', import.meta.url)],
  ])
  const server = createServer(async (req,res) => {
    if (req.url === '/__evidence') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ offline: true, realApiCalls: 0, fixtureCalls: calls, captures, usage: service.usage() })); return
    }
    if (req.method === 'POST' && ['/__fail','/__disable'].includes(req.url)) {
      if (req.url === '/__fail') failure = true; else disabled = true
      res.end('{}'); return
    }
    if (await handler(req,res)) return
    const file = files.get(req.url)
    if (!file) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': req.url.endsWith('.png') ? 'image/png' : req.url.endsWith('.mjs') ? 'text/javascript' : 'text/html; charset=utf-8' })
    res.end(await readFile(file))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const active = createMochiHandler({ service, allowedOrigin: origin, resolveAccess: () => access })
  const inactive = createMochiHandler({ service: disabledService, allowedOrigin: origin, resolveAccess: () => access })
  handler = (req,res) => (disabled ? inactive : active)(req,res)
  return { server, origin }
}
if (process.argv[1] && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(process.argv[1]).href) {
  const { origin } = await startBrowserHarness(); console.info(`OFFLINE Mochi acceptance: ${origin}`)
}
