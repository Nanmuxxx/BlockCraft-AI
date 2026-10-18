import { performance } from 'node:perf_hooks'
import { assessEnvironment, collectEnvironment } from './environment.mjs'
import { probeMacos } from './probe-macos.mjs'

const args = process.argv.slice(2)
if (args.some(arg => arg !== '--probe-macos') || new Set(args).size !== args.length) {
  console.error('Usage: node tools/custom-block-sandbox/preflight.mjs [--probe-macos]')
  process.exitCode = 64
} else {
  const start = performance.now()
  const cpu = process.cpuUsage()
  const inventory = await collectEnvironment()
  const report = {
    reportVersion: 1, inventory, assessment: assessEnvironment(inventory),
    macosProbe: args.includes('--probe-macos') ? await probeMacos() : { status: 'not-run' },
    measurements: {
      elapsedMs: Math.round(performance.now() - start),
      controllerCpuMicroseconds: process.cpuUsage(cpu),
      controllerMaxRssKiB: process.resourceUsage().maxRSS,
      scope: 'Trusted diagnostic controller only; excludes child processes, component build and browser execution.',
    },
  }
  console.log(JSON.stringify(report, null, 2))
  // Nonzero is intentional: no untrusted execution was admitted.
  process.exitCode = 2
}
