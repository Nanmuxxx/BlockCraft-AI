import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { collectEnvironment, assessEnvironment, requireExecutionProvider } from '../../tools/custom-block-sandbox/environment.mjs'
import { probeMacos } from '../../tools/custom-block-sandbox/probe-macos.mjs'

const fakeLinux = {
  platform: 'linux', commands: { docker: '/usr/bin/docker' },
  dependencies: { react: '19.3.1', 'react-dom': '19.3.1', esbuild: '0.25.12', playwright: '1.0.0' },
}

test('real inventory is read-only data and never claims effective isolation', async () => {
  const inventory = await collectEnvironment()
  assert.equal(inventory.platform, process.platform)
  assert.equal(inventory.node, process.version)
  assert.equal(assessEnvironment(inventory).mayExecuteUntrustedCode, false)
})
test('macOS without a Linux boundary remains blocked even with sandbox-exec', () => {
  const report = assessEnvironment({ ...fakeLinux, platform: 'darwin', commands: { 'sandbox-exec': '/usr/bin/sandbox-exec' } })
  assert.ok(report.blockers.includes('NO_LINUX_EXECUTION_BOUNDARY'))
  assert.ok(report.blockers.includes('NO_CONTAINER_CLI'))
})
test('a synthetic inventory containing every tool still cannot authorize execution', () => {
  const report = assessEnvironment(fakeLinux)
  assert.equal(report.status, 'blocked')
  assert.equal(report.verifiedBuild, false)
  assert.equal(report.verifiedExecution, false)
  assert.deepEqual(report.runtimeWritePermissions, [])
  assert.ok(report.blockers.includes('ISOLATION_PROVIDER_NOT_IMPLEMENTED'))
  assert.ok(report.blockers.includes('RESOURCE_AND_EGRESS_ENFORCEMENT_UNVERIFIED'))
})
test('dependency names without the fixed versions cannot satisfy preflight', () => {
  const report = assessEnvironment({ ...fakeLinux, dependencies: { react: 'next', 'react-dom': '19.3.1', esbuild: 'latest' } })
  assert.ok(report.blockers.includes('PINNED_REACT_UNAVAILABLE'))
  assert.ok(report.blockers.includes('PINNED_ESBUILD_UNAVAILABLE'))
  assert.ok(report.blockers.includes('BROWSER_DRIVER_UNAVAILABLE'))
})
test('missing inventory fields never enable execution', () => {
  assert.equal(assessEnvironment({}).mayExecuteUntrustedCode, false)
})
test('caller supplied attestations, allow flags and source getters are never consumed', () => {
  let reads = 0
  const untrusted = { mayExecuteUntrustedCode: true, sandboxVerified: true, get source() { reads++; throw Error('must not load') } }
  assert.throws(() => requireExecutionProvider(untrusted), { code: 'ISOLATION_UNVERIFIED' })
  assert.equal(reads, 0)
  assert.equal(assessEnvironment({ ...fakeLinux, mayExecuteUntrustedCode: true, sandboxVerified: true }).mayExecuteUntrustedCode, false)
})
test('preflight exits blocked with structured results; no run argument exists', () => {
  try {
    execFileSync(process.execPath, ['tools/custom-block-sandbox/preflight.mjs'], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 })
    assert.fail('preflight must not exit successfully')
  } catch (error) {
    assert.equal(error.status, 2)
    const report = JSON.parse(error.stdout)
    assert.equal(report.assessment.status, 'blocked')
    assert.equal(report.macosProbe.status, 'not-run')
    assert.ok(report.measurements.controllerMaxRssKiB > 0)
  }
})
test('unknown options and attempted unsafe run options fail closed', () => {
  for (const flag of ['--allow-unsafe', '--run', '--source=anything', '--provider=local']) {
    assert.throws(() => execFileSync(process.execPath, ['tools/custom-block-sandbox/preflight.mjs', flag], { stdio: 'pipe', timeout: 5000 }), error => error.status === 64)
  }
})
test('trusted macOS probes use paired positive controls; they never authorize execution', { skip: process.platform !== 'darwin' }, async () => {
  const report = await probeMacos()
  assert.equal(report.productionIsolationVerified, false)
  assert.equal(report.loopbackNetwork.positiveControl, true)
  assert.equal(report.loopbackNetwork.denyObserved, true)
  assert.equal(report.selectedFile.positiveControl, true)
  assert.equal(report.selectedFile.denyObserved, true)
})
