import type { ImageProvider } from './offline'

/** Browser-local test contract mirrors the proposed byte envelope only.
 * No import from server/, HTTP transport, credentials or live fallback.
 */
export interface MockImageSource {
  generate(request: { prompt: string }, context: { signal: AbortSignal }): Promise<unknown>
}

export function createMockImageAdapter(source: MockImageSource): ImageProvider {
  return {
    async generate(prompt, signal) {
      signal.throwIfAborted()
      if (!prompt.trim() || prompt.length > 500) throw new Error('请输入 1–500 字的图片描述。')
      const value = await source.generate({ prompt }, { signal })
      signal.throwIfAborted()
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mock 图片响应无效。')
      const image = value as Record<string, unknown>
      if (Object.keys(image).length !== 5 || !Object.keys(image).every(key => ['kind', 'mimeType', 'bytes', 'width', 'height'].includes(key))
        || image.kind !== 'MOCK' || image.mimeType !== 'image/png' || !(image.bytes instanceof Uint8Array)
        || image.bytes.byteLength < 33 || image.bytes.byteLength > 512 * 1024
        || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
        || (image.width as number) < 1 || (image.height as number) < 1
        || (image.width as number) * (image.height as number) > 16_777_216) throw new Error('Mock 候选必须是限额内的静态 PNG。')
      // Copy before converting: the source never retains ownership of candidate bytes.
      const bytes = new Uint8Array(image.bytes)
      const header = new DataView(bytes.buffer)
      if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
        || header.getUint32(16) !== image.width || header.getUint32(20) !== image.height) throw new Error('Mock 图片尺寸或签名不一致。')
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const dataUrl = `data:image/png;base64,${btoa(binary)}`
      if (dataUrl.length > 699100) throw new Error('Mock 图片超过候选大小限制。')
      // Full PNG structure and native decoding remain mandatory in the controller.
      return dataUrl
    },
  }
}

// Fixed test image, deliberately independent of the user's description.
const FIXTURE = 'iVBORw0KGgoAAAANSUhEUgAAAUAAAADwCAIAAAD+Tyo8AAAEC0lEQVR42u3dwUlDQRSF4RRmLdYguEkPFpGiLMCt2IQKgSAuJCbz5s2594O/gXfmfsuQw+v7h6TQDiaQAJYEsCSAJYAlASwJYEkASwBLAlgSwBLAkgCWBLAkgCWAJQEsCWBJAEsASwJYEsASwJIAlgSwJIAlgCUBLAlgSQBLAEsCWLq3z7fjNQEs5bktKRlgdaRbhjHA6ku3AGOARW+wYYBFb7BhgEVvsGGARW+wYYBFb7BhgEVvsGGARW+wYYAFMMBSOb0RhgEWwABLFfWubxhgAQywBDDA0mp6FzcMsAAGWAIYYAlggAUwwBLAAEsAAyyAAQZYAAMsAQywBDDAAhhgCWCAJb9GAlgCGGABDLDU2vDi+wAsgAGWKhpefxyABTDAUjnDEcsALIb9O6FUyHDQJgCL4VS9AIvhYL0Ai+FgvQCL4WC9AAvjY/QCAKsv4wLfDrDaSa70yQBLAEsCWBLAEsCSAJYEsCSAJYAlASwJYAlgSQBLAlgSwBLAkgCWBLAkgCWAJQEsCWAJYEkASwJYEsASwJIAlgSwJIAlgCUBLAlgCWBJAEsCWBLAEsC1ejq9nHMHAjiS7s9cgwCOpIuxAI6ni7EAjqeLsQCOp4uxAI6ni7FWB/zw/PgduhgrGPAldDFWMOBQydPoYqwMwCmMd6GLsTIAryx5d7oYa8fOMK8FvBTjpehirF3o3gJ4d8nL0sVYM93eC3i+5Ai6GGuO22GAJzCOo4uxJtAdCXgjydF0MdZ2brcCPEpyGboYawu3mwO+mXFJuhhrON0ZgP8luTxdjDXK7WzAf0tuRRdjbgc2G/Avxm3pYoxuMOBL9GLMbTBgjDFGNx4wyRhzWwEwyRhzWwEwxhijGw+YZIy5rQCYZIy5rQAYY4zRjQdMMsbN3RYBjDFdbenWAUwyad3c1gTcXDJ4fdwWB4yxytOtD7izZCZru+0FuK1kRKu6bQoYY3SL1RFwT8nclqw14IaSuQUYY4zRBZhkjLkFGGOMe9IFmOR4xo4TYJLzGDtFgDGOZOz8ACY5j7FjA5jkPMZOC2CMIxk7J4BJzmPseADGOJKxgwGY5DzGzgNgkvMYOwaAMY5k7AAAJjmPsecGmOQ8xh4XYIwjGXtQgEnOy/MBrDzJHgtgRTL2QAArT7LnAFiRjD0BwMqTbHCAlSfZvAArkrFJAVaeZAMCrDzJ5gJYkYxNBLDyJBsEYEUyNgLAkgCWBLAEsCSAJQEsCWAJYEkASwJYEsASwJIAlgSwBLAkgCUBLAlgCWBJAEsCWBLAEsCSAJYEsASwJIAlASwJYAlgSQBLAlgCWBLAkgCWBLAEsCSAJQEsCWAJYEkASwJYAlgSwJIAlgSwBLAkgCUBLAlgCWBJAEsCWOrWF8TiQWX1Bi1jAAAAAElFTkSuQmCC'
export const fixedMockImageSource: MockImageSource = {
  async generate(_request, { signal }) {
    signal.throwIfAborted()
    await Promise.resolve()
    signal.throwIfAborted()
    return { kind: 'MOCK', mimeType: 'image/png', width: 320, height: 240,
      bytes: Uint8Array.from(atob(FIXTURE), char => char.charCodeAt(0)) }
  },
}
export const mockImageProvider = createMockImageAdapter(fixedMockImageSource)
