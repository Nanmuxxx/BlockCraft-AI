import { createDeepSeekProvider } from './provider.mjs'
import { createMochiService } from './service.mjs'
import { createMochiHandler } from './http.mjs'
/** Explicit integration seam only. Default permissions/approval leave production disabled. */
export function createMochiIntegration({ apiKey, model, fetchImpl, timeoutMs, enabled = false, approval, resolveAccess, allowedOrigin, reserveBudget, provider: injectedProvider, authorizeContext, unifiedManagedBudget = false } = {}) {
  const provider = injectedProvider ?? createDeepSeekProvider({ apiKey, model, fetchImpl, timeoutMs })
  const service = createMochiService({ provider, enabled, approval, reserveBudget, authorizeContext, unifiedManagedBudget })
  return { handle: createMochiHandler({ service, resolveAccess, allowedOrigin }), usage: service.usage }
}
