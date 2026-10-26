import type { ProjectState } from '../../model/appSpec'

export interface ImageProvider {
  /** This seam is offline-only. No text gateway, keys or automatic live fallback. */
  generate: (prompt: string, signal: AbortSignal) => Promise<string>
}

export const offlineImageProvider: ImageProvider = {
  async generate(prompt, signal) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error('已取消离线生成。')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 250)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    signal.throwIfAborted()
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 240
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器暂不能创建离线插图。')
    let seed = 0
    for (const char of prompt) seed = (seed * 31 + char.charCodeAt(0)) >>> 0
    const hue = seed % 360
    ctx.fillStyle = `hsl(${hue} 38% 88%)`; ctx.fillRect(0, 0, 320, 240)
    ctx.fillStyle = '#fff4c2'; ctx.beginPath(); ctx.arc(240, 62, 26, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = `hsl(${(hue + 50) % 360} 25% 55%)`
    ctx.beginPath(); ctx.moveTo(0, 170); ctx.lineTo(90, 78); ctx.lineTo(204, 190); ctx.lineTo(320, 124); ctx.lineTo(320, 240); ctx.lineTo(0, 240); ctx.fill()
    ctx.fillStyle = `hsl(${(hue + 80) % 360} 28% 35%)`
    ctx.beginPath(); ctx.moveTo(0, 210); ctx.lineTo(178, 125); ctx.lineTo(320, 218); ctx.lineTo(320, 240); ctx.lineTo(0, 240); ctx.fill()
    return canvas.toDataURL('image/png')
  },
}

export function createGalleryPractice(): ProjectState {
  return { revision: 0, spec: { version: 1, id: 'gallery-practice', name: '我的图库练习', entities: [], relations: [],
    blocks: [{ id: 'practice-gallery', type: 'gallery', name: '我的图片', protocolVersion: 1, imageIds: [], layout: 'grid', interaction: 'preview' }] },
    records: {}, blockPositions: {} }
}
