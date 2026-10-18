const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)
const api = require('../../src/custom-block/index.ts')
const { createReadingLogExample, createClubRegistrationExample } = require('../../src/model/appSpecExamples.ts')
const { createAppRuntime } = require('../../src/model/appRuntime.ts')
const { assertProjectState } = require('../../src/model/appSpecValidation.ts')
const copy = value => structuredClone(value)
const objectSchema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const integrity = `sha512-${'A'.repeat(86)}==`
function artifact() {
  return {
    artifactVersion: 1,
    manifest: {
      protocolVersion: 1, definitionId: 'test-countdown', name: '倒计时协议测试', sdkVersion: '1.0.0', entry: 'src/Counter.tsx',
      propsSchema: objectSchema({ durationSeconds: { type: 'integer', minimum: 1, maximum: 86400 } }),
      stateSchema: objectSchema({ remainingSeconds: { type: 'integer', minimum: 0, maximum: 86400 }, status: { type: 'string', maxLength: 16, enum: ['idle', 'running', 'paused', 'done'] } }),
      events: { completed: objectSchema({ durationSeconds: { type: 'integer', minimum: 1 } }) },
      requestedCapabilities: [{ kind: 'state.write' }],
    },
    // Intentionally inert, not a functioning countdown or evidence of AI generation.
    sources: { 'src/Counter.tsx': 'throw new Error("fixture must never execute")' },
    dependencies: { react: { version: '19.3.1', integrity } },
    build: { profile: 'react-isolated-v1', toolchain: { name: 'esbuild', version: '0.25.12', integrity }, target: 'es2020', format: 'esm', maxBundleBytes: 524288 },
  }
}
async function setup() {
  const source = artifact()
  const versionDigest = await api.computeVersionDigest(source)
  const entry = { versionDigest, artifact: source }
  const reference = { definitionId: source.manifest.definitionId, versionDigest }
  const registry = { async resolve(ref) { return ref.definitionId === reference.definitionId && ref.versionDigest === reference.versionDigest ? entry : undefined } }
  const project = api.migrateProjectState(createReadingLogExample())
  project.custom.instances.push({ id: 'countdown-1', ...reference, props: { durationSeconds: 600 } })
  project.custom.positions['countdown-1'] = { x: .2, y: .4 }
  project.custom.states['countdown-1'] = { versionDigest, stateRevision: 0, value: { remainingSeconds: 600, status: 'idle' } }
  project.renderOrder.push({ kind: 'custom', id: 'countdown-1' })
  const message = {
    protocol: 'custom-block/1', channelId: 'channel-1', sessionId: 'session-1', instanceId: 'countdown-1', versionDigest,
    seq: 1, requestId: 'request-1', type: 'ready', payload: { sdkVersion: '1.0.0' },
  }
  return { source, versionDigest, entry, reference, registry, project, message }
}
module.exports = { api, copy, objectSchema, integrity, artifact, setup, createReadingLogExample, createClubRegistrationExample, createAppRuntime, assertProjectState }
