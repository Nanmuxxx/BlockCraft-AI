import type { ArtifactReference, ArtifactRegistry, JsonValue, RegisteredArtifact, SourceArtifact, VersionDigest } from './types'
import { assertJson, canonicalJson, check, cloneJson, digest, id, keys, object } from './json'
import { assertObjectSchema } from './schema'

/** A data admission policy only; this phase installs/builds/runs none of these packages. */
export const ARTIFACT_POLICY = Object.freeze({
  dependencies: Object.freeze({ react: '19.3.1', 'react-dom': '19.3.1' }),
  toolchainVersion: '0.25.12', maxSourceFiles: 32, maxSourceBytes: 262_144, maxBundleBytes: 524_288,
})
const encoder = new TextEncoder()
function path(input: unknown): asserts input is string {
  check(typeof input === 'string' && input.length <= 200 && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:tsx?|jsx?|css|json)$/.test(input), 'Invalid source path')
}
function integrity(input: unknown) {
  // SHA-512 SRI: exactly 64 bytes, canonical base64 padding bits.
  check(typeof input === 'string' && /^sha512-[A-Za-z0-9+/]{85}[AQgw]==$/.test(input), 'Invalid dependency integrity')
}
export function assertSourceArtifact(input: unknown): asserts input is SourceArtifact {
  assertJson(input); object(input); keys(input, ['artifactVersion', 'manifest', 'sources', 'dependencies', 'build'])
  check(input.artifactVersion === 1, 'Unknown artifact version')
  const m = input.manifest
  object(m); keys(m, ['protocolVersion', 'definitionId', 'name', 'sdkVersion', 'entry', 'propsSchema', 'stateSchema', 'events', 'requestedCapabilities'])
  check(m.protocolVersion === 1 && m.sdkVersion === '1.0.0', 'Unsupported manifest/SDK version')
  id(m.definitionId); check(typeof m.name === 'string' && m.name.trim().length > 0 && m.name.length <= 120, 'Invalid manifest name')
  path(m.entry); check(/\.[jt]sx?$/.test(m.entry), 'Entry must be JavaScript/TypeScript source')
  assertObjectSchema(m.propsSchema); assertObjectSchema(m.stateSchema)
  object(m.events); check(Object.keys(m.events).length <= 16, 'Event count limit', 'LIMIT')
  for (const [eventId, schema] of Object.entries(m.events)) { id(eventId); assertObjectSchema(schema) }
  check(Array.isArray(m.requestedCapabilities) && m.requestedCapabilities.length <= 16, 'Capability count limit')
  const requests = new Set<string>()
  for (const cap of m.requestedCapabilities) {
    object(cap)
    if (cap.kind === 'state.write') keys(cap, ['kind'])
    else { keys(cap, ['kind', 'entityId']); check(cap.kind === 'records.create', 'Unknown capability'); id(cap.entityId) }
    const key = canonicalJson(cap as JsonValue); check(!requests.has(key), 'Duplicate capability'); requests.add(key)
  }
  object(input.sources)
  const paths = Object.keys(input.sources)
  check(paths.length > 0 && paths.length <= ARTIFACT_POLICY.maxSourceFiles, 'Source file count limit')
  check(Object.prototype.hasOwnProperty.call(input.sources, m.entry), 'Missing entry source')
  let sourceBytes = 0
  const folded = new Set<string>()
  for (const [name, source] of Object.entries(input.sources)) {
    path(name); check(typeof source === 'string', 'Source must be text')
    check(!folded.has(name.toLowerCase()), 'Case-ambiguous source path'); folded.add(name.toLowerCase())
    check(!paths.some(other => other.startsWith(`${name}/`)), 'File/directory path conflict')
    sourceBytes += encoder.encode(source).byteLength
  }
  check(sourceBytes <= ARTIFACT_POLICY.maxSourceBytes, 'Source byte limit', 'LIMIT')
  object(input.dependencies)
  for (const [name, dep] of Object.entries(input.dependencies)) {
    check(Object.prototype.hasOwnProperty.call(ARTIFACT_POLICY.dependencies, name), 'Dependency outside allowlist')
    object(dep); keys(dep, ['version', 'integrity'])
    check(dep.version === ARTIFACT_POLICY.dependencies[name as keyof typeof ARTIFACT_POLICY.dependencies], 'Dependency version outside allowlist')
    integrity(dep.integrity)
  }
  const b = input.build
  object(b); keys(b, ['profile', 'toolchain', 'target', 'format', 'maxBundleBytes'])
  check(b.profile === 'react-isolated-v1' && b.target === 'es2020' && b.format === 'esm', 'Unsupported build profile')
  check(Number.isSafeInteger(b.maxBundleBytes) && (b.maxBundleBytes as number) > 0 && (b.maxBundleBytes as number) <= ARTIFACT_POLICY.maxBundleBytes, 'Invalid bundle byte budget')
  object(b.toolchain); keys(b.toolchain, ['name', 'version', 'integrity'])
  check(b.toolchain.name === 'esbuild' && b.toolchain.version === ARTIFACT_POLICY.toolchainVersion, 'Unsupported toolchain')
  integrity(b.toolchain.integrity)
}
/** Hash inputs, not their claimed digest. No dependency fetch, build, import or eval. */
export async function computeVersionDigest(input: unknown): Promise<VersionDigest> {
  assertSourceArtifact(input)
  const bytes = encoder.encode(`blockcraft:source-artifact:v1\n${canonicalJson(input as unknown as JsonValue)}`)
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`
}
export function assertArtifactReference(input: unknown): asserts input is ArtifactReference {
  assertJson(input); object(input); keys(input, ['definitionId', 'versionDigest']); id(input.definitionId); digest(input.versionDigest)
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
/** Registry results are untrusted; copy before await and recompute the content hash. */
export async function resolveArtifact(registry: ArtifactRegistry, reference: ArtifactReference): Promise<RegisteredArtifact> {
  assertArtifactReference(reference)
  const ref = Object.freeze(cloneJson(reference))
  const raw = await registry.resolve(ref)
  check(raw !== undefined && raw !== null, 'Missing artifact version', 'VERSION_MISSING')
  assertJson(raw)
  const entry = cloneJson(raw)
  object(entry); keys(entry, ['versionDigest', 'artifact']); digest(entry.versionDigest); assertSourceArtifact(entry.artifact)
  check(entry.versionDigest === ref.versionDigest && entry.artifact.manifest.definitionId === ref.definitionId, 'Registry reference mismatch', 'DIGEST_MISMATCH')
  check(await computeVersionDigest(entry.artifact) === ref.versionDigest, 'Artifact content digest mismatch', 'DIGEST_MISMATCH')
  return freeze(entry as unknown as RegisteredArtifact)
}
