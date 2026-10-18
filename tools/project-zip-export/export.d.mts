import type { CustomProject, RegisteredArtifact } from '../../src/custom-block/types'

export interface ExportInput {
  /** Read-only snapshot from the sole owner, validated again by the exporter. */
  project: CustomProject
  /** Exact resolved Registry entries; no path, callback or latest-version lookup. */
  artifacts: RegisteredArtifact[]
}
export interface ZipLimits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; maxZipBytes: number }
export interface ExportOptions {
  filename?: string
  /** Positive integers; can lower but never raise shipped hard caps. */
  limits?: Partial<ZipLimits>
}
export interface ExportResult {
  filename: string
  bytes: Uint8Array
  files: { path: string; bytes: number }[]
}
export class ProjectExportError extends Error { constructor(code: string, reason?: string); readonly code: string; readonly reason?: string }
export const EXPORT_PROFILE: 'react-props-local-v1'
export const ZIP_LIMITS: Readonly<ZipLimits>
export const EXPORT_LIMITS: Readonly<{ maxArtifacts: number; maxArtifactSourceBytes: number; maxBlocks: number }>
export function exportProjectZip(input: ExportInput, options?: ExportOptions): Promise<ExportResult>
