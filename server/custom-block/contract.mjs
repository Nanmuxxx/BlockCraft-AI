import { protocol, json, ensure, guarded, validateRequest, LIMITS } from './protocol.mjs'
import { PACKAGE_PINS, BUILD_PIN } from './policy.mjs'
import { checkImports } from './import-policy.mjs'

export function buildMessages(rawRequest) {
  const request = validateRequest(rawRequest)
  return [
    { role: 'system', content: `Create new React/TypeScript component SOURCE for the user's requirement. Do not output AppSpec, builtin blocks, templates, markdown, explanations, tools or executable instructions to the host.
Return exactly one JSON object with exactly: contractVersion (1), manifest, sources (path:text), dependencies (array of package names).
manifest has exactly: protocolVersion:1, definitionId:${JSON.stringify(request.definitionId)}, name (1..120 chars), sdkVersion:"1.0.0", entry (relative .tsx/.ts path in sources), propsSchema, stateSchema, events:{}, requestedCapabilities:[].
Both schemas must be objects {type:"object",properties:{...},required:[...],additionalProperties:false}. Nested schema types allowed: object, string (maxLength<=4096 required), number, integer, boolean. Optional annotations: title; scalar constraints: enum, minLength, minimum, maximum where applicable. No arrays, null, defaults, $ref, other JSON Schema vocabulary or unknown keys.
Use React controlled props and local state; do not access host state, DOM outside your root, storage, cookies, credentials or network. Default export a component in entry. No capability requests or events in this initial generation contract.
Only .ts/.tsx sources, at most ${LIMITS.sourceFiles} files, ${LIMITS.sourceFileBytes} UTF-8 bytes each and 262144 bytes total. No declarations, CSS, JSON, assets, package files or build scripts. Every file must be reachable from entry by static imports/reexports. Only static literal imports of exact react, react/jsx-runtime, react-dom, react-dom/client or unambiguous in-artifact relative modules; no dynamic import, require, eval, Function, workers, WebAssembly or import attributes. Declare react and any other imported package in dependencies; only ${Object.keys(PACKAGE_PINS).join(', ')} allowed. Host fixes versions, integrity and toolchain. Source remains untrusted and pending-build. Follow user behavior requirements by writing actual logic; do not substitute known business templates.` },
    { role: 'user', content: request.requirement },
  ]
}

/** Validate unknown model data using the real Phase 1A validator and digest. */
export async function admitOutput(rawRequest, outputText) {
  const request = validateRequest(rawRequest)
  ensure(typeof outputText === 'string' && Buffer.byteLength(outputText) <= LIMITS.outputBytes, 'OUTPUT_LIMIT')
  const artifact = guarded('INVALID_OUTPUT', () => {
    const output = JSON.parse(outputText)
    protocol.assertJson(output)
    json.object(output); json.keys(output, ['contractVersion', 'manifest', 'sources', 'dependencies'])
    ensure(output.contractVersion === 1, 'OUTPUT_VERSION')
    ensure(Array.isArray(output.dependencies) && output.dependencies.includes('react') && new Set(output.dependencies).size === output.dependencies.length, 'DEPENDENCIES_REJECTED')
    ensure(output.dependencies.every(name => typeof name === 'string' && Object.hasOwn(PACKAGE_PINS, name)), 'DEPENDENCIES_REJECTED')
    const artifact = {
      artifactVersion: 1, manifest: output.manifest, sources: output.sources,
      dependencies: Object.fromEntries(output.dependencies.sort().map(name => [name, structuredClone(PACKAGE_PINS[name])])),
      build: structuredClone(BUILD_PIN),
    }
    protocol.assertSourceArtifact(artifact)
    ensure(artifact.manifest.definitionId === request.definitionId, 'DEFINITION_MISMATCH')
    ensure(artifact.manifest.requestedCapabilities.length === 0 && Object.keys(artifact.manifest.events).length === 0, 'CAPABILITIES_REJECTED')
    checkImports(artifact)
    return artifact
  })
  return { versionDigest: await protocol.computeVersionDigest(artifact), artifact }
}

export async function validatePendingEntry(raw) {
  protocol.assertJson(raw)
  return protocol.resolveArtifact({ resolve: async () => raw }, {
    definitionId: raw?.artifact?.manifest?.definitionId, versionDigest: raw?.versionDigest,
  })
}
