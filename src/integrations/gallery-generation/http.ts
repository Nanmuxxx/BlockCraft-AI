import { IMAGE_PROTOCOL, IMAGE_PATH, IMAGE_LIMITS, validJob, type ImageJob, type JobStatus } from '../../../server/image-generation/contract.ts'
import { createMockImageAdapter } from './mock'
import type { ImageProvider } from './offline'

export interface HttpReview { requestId: string; jobId: string | null; state: 'PENDING' | 'UNKNOWN' | 'UNCERTAIN' }
export class HttpReviewRequired extends Error {
  readonly code = 'IMAGE_REVIEW_REQUIRED'
  constructor(readonly review: HttpReview) { super(httpReviewMessage(review)); this.name = 'HttpReviewRequired' }
}
export const httpReviewMessage = (review: HttpReview) =>
  `任务/费用状态未确认${review.state === 'UNCERTAIN' ? '（UNCERTAIN）' : ''}；核对前不要重新提交。任务 ID：${review.jobId ?? '未取得'}；请求 ID：${review.requestId}。原作品未更改。`
export interface HttpMockProvider extends ImageProvider {
  getReview(): HttpReview | null
  subscribeReview(listener: () => void): () => void
  reconcile(): Promise<boolean>
}
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9-]{36}$/.test(x)
const reviewEvent = 'blockcraft-image-review'

/** Same-origin HTTP MOCK only. Local unresolved-operation latch is not a billing ledger.
 * Persist only opaque IDs, never prompt/image/credentials. Unknown outcomes stay locked.
 */
export function createHttpMockImageProvider(projectId: string, onStatus: (status: JobStatus) => void = () => {},
  options: { pollMs?: number; deadlineMs?: number; requestTimeoutMs?: number } = {}): HttpMockProvider {
  const storageKey = `blockcraft:image-review:1:${projectId}`
  let fallback: HttpReview | null = null
  const getReview = (): HttpReview | null => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return fallback
      const value = JSON.parse(raw) as HttpReview
      if (!uuid(value.requestId) || !(value.jobId === null || uuid(value.jobId))
        || !['PENDING', 'UNKNOWN', 'UNCERTAIN'].includes(value.state)) throw Error()
      return value
    } catch { return fallback ?? { requestId: '无法读取，请人工核对', jobId: null, state: 'UNKNOWN' } }
  }
  const remember = (value: HttpReview | null) => {
    // Keep the conservative in-memory latch if storage is unavailable/full.
    if (value) fallback = value
    if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey)
    fallback = value
    window.dispatchEvent(new Event(reviewEvent))
  }
  const request = async (path: string, signal: AbortSignal, init: RequestInit = {}): Promise<ImageJob> => {
    const response = await fetch(path, { ...init, credentials: 'same-origin',
      signal: AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMs ?? IMAGE_LIMITS.requestTimeoutMs)]) })
    if (!response.headers.get('content-type')?.startsWith('application/json')) throw Error('INVALID_RESPONSE')
    const reader = response.body?.getReader(); if (!reader) throw Error('INVALID_RESPONSE')
    let size = 0; const parts: Uint8Array[] = []
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        size += value.length; if (size > IMAGE_LIMITS.responseBytes) throw Error('INVALID_RESPONSE')
        parts.push(value)
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size); let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.length }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!response.ok || !validJob(value)) throw Error('INVALID_RESPONSE')
    return value
  }
  return {
    getReview,
    subscribeReview(listener) {
      const stored = (event: StorageEvent) => { if (event.key === storageKey) listener() }
      window.addEventListener(reviewEvent, listener); window.addEventListener('storage', stored)
      return () => { window.removeEventListener(reviewEvent, listener); window.removeEventListener('storage', stored) }
    },
    async reconcile() {
      const review = getReview()
      if (!review) return true
      if (!review.jobId) return false // No lookup-by-key authority exists: do not invent a reset/replay.
      try {
        const job = await request(`${IMAGE_PATH}/${review.jobId}`, new AbortController().signal)
        if (job.id === review.jobId && job.status === 'UNCERTAIN') { remember({ ...review, state: 'UNCERTAIN' }); return false }
        if (job.id !== review.jobId || job.charge !== 'NONE' || !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status)) return false
        // Never clear a different operation observed from another controller/tab.
        if (getReview()?.requestId !== review.requestId) return false
        remember(null); return true // Explicit GET only; never adopt this result or create/retry.
      } catch { return false } // denied/expired/missing response is not proof of termination.
    },
    async generate(prompt, signal) {
      const prior = getReview(); if (prior) throw new HttpReviewRequired(prior)
      signal.throwIfAborted()
      let review: HttpReview = { requestId: crypto.randomUUID(), jobId: null, state: 'PENDING' }
      // This must succeed before POST. A failed local write cannot authorize another dispatch.
      try { remember(review) } catch { throw new HttpReviewRequired(getReview() ?? review) }
      const lifetime = new AbortController(); let cancelSent = false, knownTerminal = false
      const uncertain = (state: 'UNKNOWN' | 'UNCERTAIN' = 'UNKNOWN') => {
        review = { ...review, state }
        try { remember(review) } catch { /* fallback remains fail closed */ }
        return new HttpReviewRequired(review)
      }
      const cancel = async () => {
        if (!review.jobId || cancelSent) return
        cancelSent = true
        try { await request(`${IMAGE_PATH}/${review.jobId}/cancel`, new AbortController().signal, { method: 'POST' }) }
        catch { /* Keep latch even when cancel response is lost. Explicit reconciliation required. */ }
      }
      const abort = () => { lifetime.abort(); uncertain(); void cancel() }
      signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(abort, options.deadlineMs ?? IMAGE_LIMITS.jobDeadlineMs)
      try {
        if (signal.aborted) abort()
        const initial = await request(IMAGE_PATH, lifetime.signal, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': review.requestId },
          body: JSON.stringify({ version: IMAGE_PROTOCOL, projectId, prompt }) })
        review = { ...review, jobId: initial.id }; remember(review)
        if (lifetime.signal.aborted) throw uncertain()
        let job = initial
        while (true) {
          lifetime.signal.throwIfAborted(); onStatus(job.status)
          if (job.status === 'UNCERTAIN') throw uncertain('UNCERTAIN')
          if (job.status === 'SUCCEEDED') {
            const image = job.image!
            const dataUrl = await createMockImageAdapter({ async generate() { return { kind: 'MOCK', mimeType: image.mimeType,
              bytes: Uint8Array.from(atob(image.data), c => c.charCodeAt(0)), width: image.width, height: image.height } } }).generate(prompt, lifetime.signal)
            knownTerminal = true; remember(null); return dataUrl
          }
          if (['FAILED', 'CANCELLED'].includes(job.status)) {
            knownTerminal = true; remember(null); throw Error('HTTP Mock 任务未成功；原作品未更改。')
          }
          await new Promise<void>((resolve, reject) => {
            const done = () => { lifetime.signal.removeEventListener('abort', stop); resolve() }
            const wait = setTimeout(done, options.pollMs ?? 250)
            const stop = () => { clearTimeout(wait); lifetime.signal.removeEventListener('abort', stop); reject(Error('ABORTED')) }
            lifetime.signal.addEventListener('abort', stop, { once: true }); if (lifetime.signal.aborted) stop()
          })
          job = await request(`${IMAGE_PATH}/${review.jobId}`, lifetime.signal)
          if (job.id !== review.jobId) throw Error('INVALID_RESPONSE')
        }
      } catch (error) {
        if (error instanceof HttpReviewRequired) throw error // Preserve terminal UNCERTAIN and its safe IDs.
        if (knownTerminal) throw Error('HTTP Mock 任务未成功；原作品未更改。')
        const locked = uncertain(); void cancel(); throw locked
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    },
  }
}
