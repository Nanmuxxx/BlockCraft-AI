import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { issuerFixture } from './studio-issuer-fixture.mjs'

const command = "import { startStudioServer } from './server/studio-launcher.mjs'; startStudioServer({host:'0.0.0.0',port:PORT}).catch(()=>{console.error('STUDIO_START_REFUSED');process.exitCode=1})"
const fakeKey = 'synthetic-studio-command-smoke-fake-key'
const evidenceDir = join(import.meta.dirname, 'studio-command-evidence')
const egressPreload = `import { appendFileSync } from 'node:fs'\nglobalThis.fetch = (...args) => { appendFileSync(process.env.QA_UPSTREAM_MARKER, 'call\\n'); throw new Error('QA_UPSTREAM_DISABLED') }\n`

function selectedPort() {
  try {
    execFileSync('lsof', ['-nP', '-iTCP:7860', '-sTCP:LISTEN'], { stdio: 'ignore' })
  } catch {
    return { port: 7860, substituted: false }
  }
  const probe = spawn(process.execPath, ['-e', "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"], { stdio: ['ignore', 'pipe', 'ignore'] })
  return new Promise((resolve, reject) => {
    let output = ''
    probe.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
    probe.once('error', reject)
    probe.once('exit', code => code === 0 ? resolve({ port: Number(output.trim()), substituted: true }) : reject(new Error('PORT_PROBE_FAILED')))
  })
}

function runChild(fixture, port) {
  const marker = join(fixture.dir, 'upstream-calls.txt')
  const preload = join(fixture.dir, 'egress-guard.mjs')
  writeFileSync(preload, egressPreload, { mode: 0o600 })
  const code = command.replace('PORT', String(port))
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      STUDIO_APPROVAL_PATH: fixture.path,
      PUBLIC_ORIGIN: fixture.approval.publicOrigin,
      DEEPSEEK_API_KEY: fakeKey,
      QA_UPSTREAM_MARKER: marker,
      NODE_OPTIONS: `--import=${preload}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  return { child, marker, get output() { return stdout + stderr }, get stdout() { return stdout }, get stderr() { return stderr } }
}

async function waitForHealth(run, port) {
  for (let i = 0; i < 80; i++) {
    if (run.child.exitCode !== null) throw new Error(`SERVER_EXITED:${run.child.exitCode}:${run.output}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(300) })
      if (response.status === 200 && (await response.json()).status === 'ok') return
    } catch {}
    await delay(100)
  }
  throw new Error('HEALTH_TIMEOUT')
}

async function stop(run) {
  if (run.child.exitCode !== null) return
  run.child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => run.child.once('exit', resolve)), delay(5000).then(() => { run.child.kill('SIGKILL') })])
}

function assertNoSensitiveOutput(run, fixture) {
  for (const value of [fixture.dir, fakeKey, fixture.credential, fixture.approval.approval.reference]) {
    assert.equal(run.output.includes(value), false, 'startup output must not disclose synthetic path, key, credential, or approval reference')
  }
}

const portChoice = await selectedPort()
const happy = await issuerFixture({ origin: 'https://studio-command.test' })
const results = []
let happyRun
try {
  happyRun = runChild(happy, portChoice.port)
  await waitForHealth(happyRun, portChoice.port)
  const listener = execFileSync('lsof', ['-nP', '-a', '-p', String(happyRun.child.pid), `-iTCP:${portChoice.port}`], { encoding: 'utf8' })
  assert.match(listener, new RegExp(`(?:\\*|0\\.0\\.0\\.0):${portChoice.port}\\s+\\(LISTEN\\)`))
  const anonymous = await fetch(`http://127.0.0.1:${portChoice.port}/api/ai/generate`, {
    method: 'POST', headers: { Origin: happy.approval.publicOrigin, 'Content-Type': 'application/json', 'Idempotency-Key': 'anonymous-smoke-key-00000000000001' },
    body: JSON.stringify({ idea: 'synthetic anonymous request' }),
  })
  assert.equal(anonymous.status, 401)
  assert.equal(existsSync(happyRun.marker), false, 'anonymous request must not enter provider fetch')
  assertNoSensitiveOutput(happyRun, happy)
  results.push({ scenario: 'synthetic-preexisting-state-start-health-anonymous', status: 'PASS', port: portChoice.port, substitutedPort: portChoice.substituted, bind: '0.0.0.0', health: 200, anonymous: 401, upstreamCalls: 0 })
} finally {
  await stop(happyRun)
  await happy.cleanup()
}

for (const scenario of ['missing-approval', 'malformed-approval', 'missing-ledger']) {
  const fixture = await issuerFixture({ origin: 'https://studio-command.test' })
  if (scenario === 'missing-approval') rmSync(fixture.path)
  if (scenario === 'malformed-approval') writeFileSync(fixture.path, '{ malformed synthetic approval', { mode: 0o600 })
  if (scenario === 'missing-ledger') rmSync(fixture.ledgerPath)
  const run = runChild(fixture, portChoice.port)
  try {
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { run.child.kill('SIGKILL'); reject(new Error(`${scenario}: startup did not refuse`)) }, 5000)
      run.child.once('error', reject)
      run.child.once('exit', code => { clearTimeout(timer); resolve(code) })
    })
    assert.notEqual(exitCode, 0)
    assert.equal(run.stdout, '')
    assert.equal(run.stderr.trim(), 'STUDIO_START_REFUSED')
    assertNoSensitiveOutput(run, fixture)
    assert.equal(existsSync(run.marker), false)
    results.push({ scenario, status: 'PASS', exitCode, output: 'STUDIO_START_REFUSED', upstreamCalls: 0 })
  } finally {
    await stop(run)
    await fixture.cleanup()
  }
}

mkdirSync(evidenceDir, { recursive: true })
writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify({
  result: 'Studio command Mock startup smoke PASS',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
  startupCommand: `node --input-type=module -e "import { startStudioServer } from './server/studio-launcher.mjs'; startStudioServer({host:'0.0.0.0',port:${portChoice.port}}).catch(()=>{console.error('STUDIO_START_REFUSED');process.exitCode=1})"`,
  realCalls: 0,
  realStateOrKey: false,
  scenarios: results,
}, null, 2) + '\n')
console.log(JSON.stringify({ result: 'Studio command Mock startup smoke PASS', scenarios: results }))
