// FUTURE explicit CLI entry; no import-time network, no .env loader, no HTTP server.
import { pathToFileURL } from 'node:url'
import { createDeepSeekProvider } from './provider.mjs'
import { createPendingStore } from './store.mjs'
import { createGenerator } from './generator.mjs'
import { ensure } from './protocol.mjs'

export async function runLiveGeneration(env = process.env) {
  // Both gates must be supplied by the human operator after separate authorization.
  ensure(env.BLOCKCRAFT_CUSTOM_BLOCK_ENABLED === '1', 'EXPERIMENT_DISABLED')
  ensure(env.BLOCKCRAFT_CUSTOM_BLOCK_ALLOW_PAID === 'I_HAVE_EXPLICIT_AUTHORIZATION', 'PAID_API_DISABLED')
  const provider = createDeepSeekProvider({ allowPaid: true, apiKey: env.DEEPSEEK_API_KEY })
  const store = createPendingStore(env.BLOCKCRAFT_CUSTOM_BLOCK_STORE || new URL('./pending-artifacts/', import.meta.url).pathname)
  const generator = createGenerator({ enabled: true, provider, store })
  return generator.generate({
    contractVersion: 1, requestId: env.BLOCKCRAFT_CUSTOM_BLOCK_REQUEST_ID,
    definitionId: env.BLOCKCRAFT_CUSTOM_BLOCK_DEFINITION_ID, requirement: env.BLOCKCRAFT_CUSTOM_BLOCK_REQUIREMENT,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(await runLiveGeneration()) + '\n') }
  catch (error) {
    // Never print upstream bodies, request content, API keys, stack or filesystem paths.
    const code = /^[A-Z_]{1,64}$/.test(error.code || '') ? error.code : 'GENERATION_FAILED'
    process.stderr.write(JSON.stringify({ code }) + '\n'); process.exitCode = 1
  }
}
