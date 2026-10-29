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
class HttpOperationSuperseded extends Error {
  readonly code = 'IMAGE_OPERATION_SUPERSEDED'
  constructor() { super('原操作已被核对或替代；未采用或重新提交。') }
}

/** Same-origin HTTP MOCK only. Local unresolved-operation latch is not a billing ledger.
 * Persist only opaque IDs, never prompt/image/credentials. Unknown outcomes stay locked.
 */
export function createHttpMockImageProvider(projectId: string, onStatus: (status: JobStatus) => void = () => {},
  options: { pollMs?: number; deadlineMs?: number; requestTimeoutMs?: number } = {}): HttpMockProvider {
  const storageKey = `blockcraft:image-review:1:${projectId}`
  // Web Locks provides same-origin serialization; localStorage alone is NOT a CAS.
  // Every mutation (including admission/clear) is synchronous inside this exclusive lock.
  // No network await holds the lock, so another tab can explicitly reconcile a lost task.
  const lockName = `blockcraft:image-review:1:${projectId}`
  let diagnostic: HttpReview | null = null
  const unavailable = (): HttpReview => diagnostic ?? { requestId: '存储或跨标签协调不可用，请人工核对', jobId: null, state: 'UNKNOWN' }
  const read = (): HttpReview | null => {
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return null
    const value = JSON.parse(raw) as HttpReview
    if (!value || !uuid(value.requestId) || !(value.jobId === null || uuid(value.jobId))
      || !['PENDING', 'UNKNOWN', 'UNCERTAIN'].includes(value.state)) throw Error('INVALID_REVIEW_STORAGE')
    return value
  }
  const getReview = (): HttpReview | null => {
    try {
      if (!navigator.locks?.request) return read() ?? unavailable()
      return read() ?? diagnostic
    } catch { return unavailable() }
  }
  const notify = () => window.dispatchEvent(new Event(reviewEvent))
  const remember = (value: HttpReview | null) => {
    // Only called under the Web Lock. Never erase a failed-write diagnostic automatically.
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey)
    } catch (error) { diagnostic = value ?? read() ?? unavailable(); throw error }
    notify()
  }
  const serialized = async <T,>(action: () => T): Promise<T> => {
    try {
      if (!navigator.locks?.request) throw Error('COORDINATION_UNAVAILABLE')
      return await navigator.locks.request(lockName, { mode: 'exclusive', signal: AbortSignal.timeout(2000) }, action)
    } catch (error) {
      if (error instanceof HttpReviewRequired || error instanceof HttpOperationSuperseded) throw error
      diagnostic = getReview() ?? unavailable(); notify()
      throw new HttpReviewRequired(diagnostic)
    }
  }
  const owned = (review: HttpReview, action: (current: HttpReview) => void) => serialized(() => {
    const current = read()
    if (!current || current.requestId !== review.requestId
      || (review.jobId !== null && current.jobId !== review.jobId)) throw new HttpOperationSuperseded()
    action(current)
  })
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
      const stored = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) listener() }
      window.addEventListener(reviewEvent, listener); window.addEventListener('storage', stored)
      return () => { window.removeEventListener(reviewEvent, listener); window.removeEventListener('storage', stored) }
    },
    async reconcile() {
      const review = getReview()
      if (!review) return true
      if (!review.jobId) return false
      try {
        const job = await request(`${IMAGE_PATH}/${review.jobId}`, new AbortController().signal)
        if (job.id !== review.jobId) return false
        if (job.status === 'UNCERTAIN') {
          await owned(review, current => remember({ ...current, state: 'UNCERTAIN' })); return false
        }
        if (job.charge !== 'NONE' || !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status)) return false
        await owned(review, () => { remember(null); diagnostic = null })
        return true // Authorized GET, matched job and atomic owner check. Never adopt/retry.
      } catch { return false }
    },
    async generate(prompt, signal) {
      // UUID creation AND reservation are inside one cross-tab admission critical section.
      let review = await serialized(() => {
        const prior = getReview(); if (prior) throw new HttpReviewRequired(prior)
        signal.throwIfAborted()
        const next: HttpReview = { requestId: crypto.randomUUID(), jobId: null, state: 'PENDING' }
        remember(next); return next
      })
      const lifetime = new AbortController(); let cancelSent = false, knownTerminal = false
      const uncertain = async (state: 'UNKNOWN' | 'UNCERTAIN' = 'UNKNOWN') => {
        await owned(review, current => {
          // A later network/abort callback must not downgrade a recorded UNCERTAIN.
          review = { ...current, state: current.state === 'UNCERTAIN' ? 'UNCERTAIN' : state }
          remember(review)
        })
        return new HttpReviewRequired(review)
      }
      const cancel = async () => {
        try {
          await owned(review, current => {
            if (!current.jobId || cancelSent) return
            cancelSent = true
            // Initiate only while ownership is held. The response has NO authority to clear.
            void request(`${IMAGE_PATH}/${current.jobId}/cancel`, new AbortController().signal, { method: 'POST' }).catch(() => {})
          })
        } catch { /* Superseded or unavailable: no cancel dispatch, no shared mutation. */ }
      }
      const abort = () => {
        lifetime.abort()
        void uncertain().catch(() => {}).finally(() => { void cancel() })
      }
      signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(abort, options.deadlineMs ?? IMAGE_LIMITS.jobDeadlineMs)
      try {
        if (signal.aborted) abort()
        lifetime.signal.throwIfAborted()
        const initial = await request(IMAGE_PATH, lifetime.signal, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': review.requestId },
          body: JSON.stringify({ version: IMAGE_PROTOCOL, projectId, prompt }) })
        await owned(review, current => { review = { ...current, jobId: initial.id }; remember(review) })
        lifetime.signal.throwIfAborted()
        // Even an immediate terminal create response must be verified by authorized status GET.
        let job = initial
        if (!['QUEUED', 'RUNNING'].includes(job.status)) job = await request(`${IMAGE_PATH}/${review.jobId}`, lifetime.signal)
        while (true) {
          lifetime.signal.throwIfAborted()
          if (job.id !== review.jobId) throw Error('INVALID_RESPONSE')
          await owned(review, () => onStatus(job.status))
          if (job.status === 'UNCERTAIN' || job.charge !== 'NONE') throw await uncertain('UNCERTAIN')
          if (job.status === 'SUCCEEDED') {
            const image = job.image!
            const dataUrl = await createMockImageAdapter({ async generate() { return { kind: 'MOCK', mimeType: image.mimeType,
              bytes: Uint8Array.from(atob(image.data), c => c.charCodeAt(0)), width: image.width, height: image.height } } }).generate(prompt, lifetime.signal)
            await owned(review, () => { lifetime.signal.throwIfAborted(); remember(null) })
            knownTerminal = true; return dataUrl
          }
          if (['FAILED', 'CANCELLED'].includes(job.status)) {
            await owned(review, () => { lifetime.signal.throwIfAborted(); remember(null) })
            knownTerminal = true; throw Error('HTTP Mock 任务未成功；原作品未更改。')
          }
          await new Promise<void>((resolve, reject) => {
            const done = () => { lifetime.signal.removeEventListener('abort', stop); resolve() }
            const wait = setTimeout(done, options.pollMs ?? 250)
            const stop = () => { clearTimeout(wait); lifetime.signal.removeEventListener('abort', stop); reject(Error('ABORTED')) }
            lifetime.signal.addEventListener('abort', stop, { once: true }); if (lifetime.signal.aborted) stop()
          })
          job = await request(`${IMAGE_PATH}/${review.jobId}`, lifetime.signal)
        }
      } catch (error) {
        if (error instanceof HttpReviewRequired || error instanceof HttpOperationSuperseded || knownTerminal) throw error
        const locked = await uncertain(); void cancel(); throw locked
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    },
  }
}
