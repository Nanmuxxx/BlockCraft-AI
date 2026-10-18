import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { protocol } from '../../server/custom-block/protocol.mjs'
import { PACKAGE_PINS, BUILD_PIN } from '../../server/custom-block/policy.mjs'

const fixtureRoot = new URL('../../tests/custom-block-compiler/fixtures/', import.meta.url)
const files = Object.freeze({
  'Counter.tsx': '48d763725c9291a75f31a265fd5d5820b7361307cf6ab6fe926cbf84f0c42dfd',
  'Temperature.tsx': '3705ab5b4743d90025fa9b42d6f17ef72fc7ee02928929321cd76cfa04687ab9',
  'convert.ts': '9a5935036afd962d43819b93d78d826b6da965595bd298300540acd36a4702dc',
})
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
export async function trustedSample(name) {
  if (!['counter', 'temperature'].includes(name)) throw new Error('UNKNOWN_TRUSTED_SAMPLE')
  const entry = name === 'counter' ? 'Counter.tsx' : 'Temperature.tsx'
  const sources = {}
  for (const file of name === 'counter' ? [entry] : [entry, 'convert.ts']) {
    const bytes = await readFile(new URL(file, fixtureRoot))
    if (createHash('sha256').update(bytes).digest('hex') !== files[file]) throw new Error('TRUSTED_FIXTURE_CHANGED')
    sources[file] = bytes.toString('utf8')
  }
  const artifact = {
    artifactVersion: 1,
    manifest: { protocolVersion: 1, definitionId: `trusted-${name}`, name: `Developer ${name}`,
      sdkVersion: '1.0.0', entry, propsSchema: schema({ initial: { type: 'number' } }),
      stateSchema: schema({}), events: {}, requestedCapabilities: [] },
    sources, dependencies: structuredClone(PACKAGE_PINS), build: structuredClone(BUILD_PIN),
  }
  return { versionDigest: await protocol.computeVersionDigest(artifact), artifact }
}

// This catalogue is repository-controlled, never derived from provenance.kind or caller flags.
export async function trustedReference(reference) {
  for (const name of ['counter', 'temperature']) {
    const entry = await trustedSample(name)
    if (reference.definitionId === entry.artifact.manifest.definitionId && reference.versionDigest === entry.versionDigest) return entry
  }
  return undefined
}
