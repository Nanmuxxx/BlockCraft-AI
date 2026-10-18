import { createHash } from 'node:crypto'
import { protocol, json } from '../../server/custom-block/protocol.mjs'
import { PACKAGE_PINS, BUILD_PIN } from '../../server/custom-block/policy.mjs'
import { checkImports } from '../../server/custom-block/import-policy.mjs'

export function demand(value, code) {
  if (!value) { const error = new Error(code); error.code = code; throw error }
}
export const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
export const canonicalDigest = value => sha256(json.canonicalJson(value))

/** Structural/import admission only. Never a trust decision or sandbox. */
export async function validateBuildEntry(raw, reference) {
  const entry = await protocol.resolveArtifact({ resolve: async () => raw }, reference)
  demand(json.canonicalJson(entry.artifact.build) === json.canonicalJson(BUILD_PIN), 'BUILD_POLICY_MISMATCH')
  demand(Object.hasOwn(entry.artifact.dependencies, 'react'), 'REACT_REQUIRED')
  for (const [name, dep] of Object.entries(entry.artifact.dependencies)) {
    demand(json.canonicalJson(dep) === json.canonicalJson(PACKAGE_PINS[name]), 'DEPENDENCY_BYTES_MISMATCH')
  }
  demand(entry.artifact.manifest.requestedCapabilities.length === 0 && Object.keys(entry.artifact.manifest.events).length === 0, 'CAPABILITY_NOT_SUPPORTED')
  checkImports(entry.artifact)
  return entry
}

export function verifyBundle(receipt, bundle) {
  demand(receipt.contractVersion === 1 && receipt.status === 'compiled' && receipt.execution === 'denied', 'INVALID_RECEIPT')
  demand(Buffer.isBuffer(bundle) && bundle.length > 0 && bundle.length === receipt.bundleBytes && bundle.length <= BUILD_PIN.maxBundleBytes, 'BUNDLE_SIZE')
  demand(sha256(bundle) === receipt.bundleDigest, 'BUNDLE_DIGEST_MISMATCH')
  demand(receipt.sourceDigest === receipt.reference.versionDigest, 'SOURCE_DIGEST_MISMATCH')
  // This detects accidental corruption only; an unsigned receipt is not run authority.
  return true
}
