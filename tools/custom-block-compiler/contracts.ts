import type { ArtifactReference, SourceArtifact } from '../../src/custom-block/types'

/** Trusted server/controller boundary. No source text, tool options, npm or trust flags. */
export interface BuildRequest {
  contractVersion: 1
  reference: ArtifactReference
}
export interface PackageEvidence {
  name: string
  version: string
  integrity: string
  archiveSha256: string
  treeSha256: string
  fileCount: number
}
export interface BuildReceipt {
  contractVersion: 1
  status: 'compiled'
  execution: 'denied'
  reference: ArtifactReference
  /** Equals versionDigest: canonical complete SourceArtifact, not only source text. */
  sourceDigest: string
  /** SHA-256 of canonical sources map. */
  sourcesDigest: string
  bundleDigest: string
  bundleBytes: number
  profile: SourceArtifact['build']
  toolchain: {
    name: 'esbuild'; version: '0.25.12'; node: 'v24.22.0'
    parser: 'typescript@5.9.3'; sdk: '1.0.0'; binaryDigest: string; driverDigest: string
  }
  supply: { lockDigest: string; binaryDigest: string; platform: string; packages: PackageEvidence[] }
  packageInputs: Record<string, string>
  bootstrapDigest: string
  isolation: { build: 'trusted-fixture-subprocess-only'; execution: 'unverified' }
  provenance: 'repository-developer-fixture'
}
export interface BuildStatus {
  contractVersion: 1
  jobId: string
  reference: ArtifactReference
  status: 'checking' | 'compiling' | 'compiled' | 'blocked' | 'failed'
  execution: 'denied'
  code?: 'ISOLATION_UNVERIFIED' | 'BUILD_REJECTED'
  receipt?: BuildReceipt
}
export interface ViewerRequest {
  contractVersion: 1
  jobId: string
  instanceId: string
  reference: ArtifactReference
}
/** No viewer URL, token, executable module URL or runnable state exists in this phase. */
export interface ViewerBlocked {
  contractVersion: 1
  status: 'blocked'
  code: 'ISOLATION_UNVERIFIED'
  execution: 'denied'
  instanceId: string
  reference: ArtifactReference
}
export interface BuildService {
  /** Resolves when completed. Poll status(jobId) from another trusted request if needed. */
  build(request: BuildRequest): Promise<BuildStatus>
  status(jobId: string): BuildStatus | null
  /** Private audit only. The caller must never serve/load these bytes as a viewer. */
  inspectCompiled(jobId: string): { receipt: BuildReceipt; bundle: Uint8Array } | null
  createViewer(request: ViewerRequest): ViewerBlocked
}
