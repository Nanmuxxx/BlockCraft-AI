import type { CustomProject } from '../../custom-block'
import { assertJson, check, cloneJson, CustomBlockError, revision } from '../../custom-block/json'
import type { RuntimeResult } from '../../model/appRuntime'

/** Identity is the authorization generation. Only the owner can issue it. */
export type WriteAuthorization = Readonly<{ readOnly: boolean }>
export interface ProjectRevisionOwner {
  getSnapshot: () => CustomProject
  getAuthorization: () => WriteAuthorization
  /** Notify on either project or authorization changes. */
  subscribe: (listener: () => void) => () => void
  compareAndSwap: (expected: CustomProject, next: CustomProject, authorization: WriteAuthorization) => RuntimeResult
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** Use as the sole v2 owner, never as a second store around an existing Runtime.
 * Trusted callers validate candidate artifacts before CAS. This boundary guards
 * authorization, JSON, snapshot identity and revision for ALL submitters.
 * persist must be synchronous and atomic (throw before storing on failure).
 */
export function createProjectRevisionOwner(initial: CustomProject, options: {
  readOnly?: boolean
  persist?: (next: CustomProject) => undefined
} = {}) {
  assertJson(initial); revision(initial.revision)
  check(options.readOnly === undefined || typeof options.readOnly === 'boolean', 'Invalid authorization')
  let snapshot = freeze(cloneJson(initial))
  let authorization: WriteAuthorization = Object.freeze({ readOnly: options.readOnly ?? false })
  let committing = false
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => { try { listener() } catch { /* Publication already succeeded. */ } })
  return {
    getSnapshot: () => snapshot,
    getAuthorization: () => authorization,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setReadOnly(readOnly: boolean) {
      check(!committing, 'Owner commit cannot be reentered', 'OWNER_BUSY')
      check(typeof readOnly === 'boolean', 'Invalid authorization')
      if (readOnly === authorization.readOnly) return
      authorization = Object.freeze({ readOnly })
      notify()
    },
    compareAndSwap(expected: CustomProject, next: CustomProject, captured: WriteAuthorization): RuntimeResult {
      if (committing) return { ok: false, error: { code: 'OWNER_BUSY', message: '宿主正在提交。' } }
      committing = true
      try {
        // Revocation and CAS are synchronous on this owner: no await or callback
        // can separate this authorization check from publication.
        check(!authorization.readOnly, '项目为只读，无法保存。', 'READ_ONLY')
        check(captured === authorization, '写入授权已变化，请重新操作。', 'AUTHORIZATION_CHANGED')
        check(expected === snapshot, '项目已变化，请重新操作。', 'REVISION_CONFLICT')
        revision(snapshot.revision)
        check(snapshot.revision < Number.MAX_SAFE_INTEGER, '项目版本号已用尽。', 'REVISION_EXHAUSTED')
        assertJson(next); revision(next.revision)
        check(next.revision === snapshot.revision + 1, 'Invalid next revision', 'REVISION_CONFLICT')
        freeze(next)
        options.persist?.(next)
        snapshot = next
      } catch (error) {
        return { ok: false, error: error instanceof CustomBlockError
          ? { code: error.code, message: error.message }
          : { code: 'HOST_UNAVAILABLE', message: '宿主保存暂不可用。' } }
      } finally { committing = false }
      const committedRevision = snapshot.revision
      notify()
      return { ok: true, duplicate: false, committedRevision }
    },
  } satisfies ProjectRevisionOwner & { setReadOnly: (readOnly: boolean) => void }
}
