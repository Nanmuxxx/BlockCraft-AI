/** Experimental server-only MOCK seam. No HTTP route, credentials or paid transport.
 * This is deliberately separate from the browser's offline ImageProvider.
 */
export type ImageErrorCode = 'IMAGE_DISABLED' | 'INVALID_INPUT' | 'CANCELLED' | 'SERVER_ONLY'

export class ImageProviderError extends Error {
  readonly code: ImageErrorCode
  constructor(code: ImageErrorCode) {
    super(code)
    this.name = 'ImageProviderError'
    this.code = code
  }
}

export interface ImageRequest { readonly prompt: string }
export interface MockImageResult {
  readonly kind: 'MOCK'
  readonly mimeType: 'image/png'
  readonly bytes: Uint8Array
  readonly width: 1
  readonly height: 1
}
/** No identity/budget claim is implied by calling a low-level fixture provider. */
export interface MockImageProvider {
  readonly kind: 'MOCK'
  generate(request: ImageRequest, context: { signal: AbortSignal }): Promise<MockImageResult>
}

function serverOnly() {
  if (typeof window !== 'undefined') throw new ImageProviderError('SERVER_ONLY')
}

// Fixed 1x1 PNG test fixture; never represents the prompt or a real model output.
const FIXTURE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

/** Explicit mock opt-in only. Unknown provider modes fail closed, never fall back. */
export function createImageProvider(options?: { mode: 'mock' }): MockImageProvider {
  serverOnly()
  if (!options || Object.keys(options).length !== 1 || options.mode !== 'mock') {
    throw new ImageProviderError('IMAGE_DISABLED')
  }
  return Object.freeze({
    kind: 'MOCK' as const,
    async generate(request: ImageRequest, context: { signal: AbortSignal }): Promise<MockImageResult> {
      serverOnly()
      if (!context || !(context.signal instanceof AbortSignal)) throw new ImageProviderError('INVALID_INPUT')
      const { signal } = context
      const checkCancelled = () => { if (signal.aborted) throw new ImageProviderError('CANCELLED') }
      checkCancelled()
      if (!request || typeof request !== 'object' || Array.isArray(request)
        || Object.keys(request).length !== 1 || !Object.hasOwn(request, 'prompt')
        || typeof request.prompt !== 'string' || !request.prompt.trim()
        || request.prompt.length > 500 || new TextEncoder().encode(request.prompt).byteLength > 2000
        || /[\u0000-\u001f\u007f]/.test(request.prompt)) {
        throw new ImageProviderError('INVALID_INPUT')
      }
      await Promise.resolve()
      checkCancelled()
      return Object.freeze({ kind: 'MOCK', mimeType: 'image/png',
        bytes: Uint8Array.from(atob(FIXTURE), c => c.charCodeAt(0)), width: 1, height: 1 })
    },
  })
}
