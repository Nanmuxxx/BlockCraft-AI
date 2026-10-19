/** Bound a transport await even when an injected/failed transport ignores abort.
 * Attach both handlers so a late rejection is consumed; each await removes its
 * own listener. Cancellation never retries or authorizes another model call.
 */
export function abortable(operation, signal) {
  if (signal.aborted) {
    void Promise.resolve(operation).catch(() => {})
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(operation).then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
    if (signal.aborted) abort()
  })
}
