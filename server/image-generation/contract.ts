/** image-generation/1: JSON wire contract. No provider credentials or permissions. */
export const IMAGE_PROTOCOL = 'image-generation/1' as const
export const IMAGE_PATH = '/api/image-generations'
export const IMAGE_LIMITS = Object.freeze({ requestBytes: 4096, responseBytes: 710000, pngBytes: 524288,
  width: 4096, height: 4096, pixels: 16777216, dataUrlChars: 699100, promptUnits: 500,
  promptBytes: 2000, requestTimeoutMs: 10000, jobDeadlineMs: 120000, retentionMs: 900000 })
export const IMAGE_ERRORS = Object.freeze({
  IMAGE_DISABLED: 503, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, INVALID_INPUT: 400,
  UNSUPPORTED_MEDIA: 415, PAYLOAD_TOO_LARGE: 413, IDEMPOTENCY_CONFLICT: 409,
  CAPACITY: 429, PROVIDER_FAILED: 502, INVALID_IMAGE: 502, TIMEOUT: 504,
  BUDGET_DENIED: 403, LEDGER_UNAVAILABLE: 503, BILLING_UNCERTAIN: 503, EXPIRED: 410,
} as const)
export type ImageCode = keyof typeof IMAGE_ERRORS
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNCERTAIN'
export interface ImageInput { version: typeof IMAGE_PROTOCOL; projectId: string; prompt: string }
export interface WireImage { kind: 'MOCK'; mimeType: 'image/png'; encoding: 'base64'; data: string; width: number; height: number }
export interface ImageJob { version: typeof IMAGE_PROTOCOL; kind: 'HTTP_MOCK'; id: string; status: JobStatus;
  charge: 'NONE' | 'UNCERTAIN'; expiresAt: number; image?: WireImage; error?: { code: ImageCode } }
export function validInput(value: unknown): value is ImageInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const x = value as Record<string, unknown>
  return Object.keys(x).length === 3 && x.version === IMAGE_PROTOCOL
    && typeof x.projectId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x.projectId)
    && typeof x.prompt === 'string' && !!x.prompt.trim() && x.prompt.length <= IMAGE_LIMITS.promptUnits
    && new TextEncoder().encode(x.prompt).length <= IMAGE_LIMITS.promptBytes && !/[\u0000-\u001f\u007f]/.test(x.prompt)
}
export function validKey(key: unknown): key is string { return typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key) }
export function validJob(value: unknown): value is ImageJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const x = value as ImageJob
  if (x.version !== IMAGE_PROTOCOL || x.kind !== 'HTTP_MOCK' || typeof x.id !== 'string'
    || !/^[a-f0-9-]{36}$/.test(x.id) || !Number.isSafeInteger(x.expiresAt)
    || !['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCERTAIN'].includes(x.status)
    || x.charge !== (x.status === 'UNCERTAIN' ? 'UNCERTAIN' : 'NONE')) return false
  if (x.status !== 'SUCCEEDED') return !x.image && (!x.error || Object.prototype.hasOwnProperty.call(IMAGE_ERRORS, x.error.code))
  const i = x.image
  return !x.error && !!i && i.kind === 'MOCK' && i.mimeType === 'image/png' && i.encoding === 'base64'
    && typeof i.data === 'string' && i.data.length <= Math.ceil(IMAGE_LIMITS.pngBytes / 3) * 4
    && i.data.length > 0 && i.data.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(i.data)
    && Number.isSafeInteger(i.width) && Number.isSafeInteger(i.height)
    && i.width > 0 && i.height > 0 && i.width <= IMAGE_LIMITS.width && i.height <= IMAGE_LIMITS.height
    && i.width * i.height <= IMAGE_LIMITS.pixels
}
