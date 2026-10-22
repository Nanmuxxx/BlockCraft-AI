import { ProjectPackageError } from './errors'
import type { ProjectAsset } from '../../model/appSpec'

/** Call after the mainline resource/data-URL validator. */
export async function assertProjectImagesDecodable(assets?: Record<string, ProjectAsset>): Promise<void> {
  for (const asset of Object.values(assets ?? {})) {
    const bytes = Uint8Array.from(atob(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1)), char => char.charCodeAt(0))
    await assertImageDecodable(bytes, asset.mimeType)
  }
}

/** Browser-native decode gate; non-browser callers retain signature/hash validation. */
export async function assertImageDecodable(bytes: Uint8Array, mimeType: string): Promise<void> {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType })
  try {
    if (typeof globalThis.createImageBitmap === 'function') {
      // Request a small result and release its backing allocation immediately.
      const bitmap = await globalThis.createImageBitmap(blob, { resizeWidth: 1, resizeHeight: 1 })
      try {
        if (bitmap.width < 1 || bitmap.height < 1) throw new Error()
      } finally { bitmap.close() }
    } else if (typeof globalThis.Image === 'function') {
      const url = URL.createObjectURL(blob)
      try {
        await new Promise<void>((resolve, reject) => {
          const image = new Image()
          image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve() : reject()
          image.onerror = () => reject()
          image.src = url
        })
      } finally { URL.revokeObjectURL(url) }
    }
  } catch { throw new ProjectPackageError('RESOURCE_INVALID') }
}
