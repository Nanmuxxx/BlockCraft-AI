import { useEffect } from 'react'
import type { GeneratedArtifactUI } from './ui'

/** Resource cleanup is NOT a switch gate. Parents must gate their state setter.
 * All current document navigation links and browser unload are intercepted here.
 */
export function useInstallLifecycle(installation: GeneratedArtifactUI) {
  useEffect(() => {
    installation.activate()
    const navigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download')) return
      try { installation.beforeContextChange() }
      catch { event.preventDefault(); event.stopImmediatePropagation() }
    }
    const unload = (event: BeforeUnloadEvent) => {
      if (installation.isConfirming()) { event.preventDefault(); event.returnValue = '' }
      else installation.beforeContextChange()
    }
    document.addEventListener('click', navigation, true)
    window.addEventListener('beforeunload', unload)
    return () => {
      document.removeEventListener('click', navigation, true)
      window.removeEventListener('beforeunload', unload)
      // A forced external root.unmount cannot be cancelled by React cleanup.
      // Known production setters/nav have already passed the synchronous gate.
      if (!installation.isConfirming()) installation.dispose()
      else {
        const unsubscribe = installation.subscribe(() => {
          if (!installation.isConfirming()) { unsubscribe(); installation.dispose() }
        })
      }
    }
  }, [installation])
}
