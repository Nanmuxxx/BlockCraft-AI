import type { ProjectState } from '../../model/appSpec'
import { assertAppSpec, assertProjectState } from '../../model/appSpecValidation'

/** AI responses remain data; only the existing renderer interprets this protocol. */
export function initializeGeneratedProject(value: unknown): ProjectState {
  assertAppSpec(value)
  const spec = structuredClone(value)
  const rows = Math.max(1, Math.ceil(spec.blocks.length / 3))
  const state: ProjectState = {
    revision: 0,
    spec,
    records: Object.fromEntries(spec.entities.map(entity => [entity.id, []])),
    blockPositions: Object.fromEntries(spec.blocks.map((block, index) => [block.id, {
      x: ((index % 3) + 0.5) / 3,
      y: (Math.floor(index / 3) + 0.5) / rows,
    }])),
  }
  assertProjectState(state)
  return state
}

const errors: Record<string, string> = {
  AI_NOT_CONFIGURED: '后端尚未配置 AI 服务，请完成服务端配置后重试。',
}

// A response is data, never executable source. Bound bytes before JSON parsing.
const RESPONSE_BYTES = 128 * 1024
const CANCELLED = '生成已取消或超时，请重试。'

/** Abort also wins against transports/readers that settle after cancellation. */
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([operation, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}

async function readGenerationResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > RESPONSE_BYTES) throw new Error('生成响应过大，请重试。')
  if (!response.body) throw new Error('服务未返回有效 JSON，请检查后端是否已启动。')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let content = '', size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      size += value.byteLength
      if (size > RESPONSE_BYTES) throw new Error('生成响应过大，请重试。')
      content += decoder.decode(value, { stream: true })
    }
    signal.throwIfAborted()
    content += decoder.decode()
    try { return JSON.parse(content) as unknown }
    catch { throw new Error('服务未返回有效 JSON，请检查后端是否已启动。') }
  } finally {
    // Do not await a remote producer's cancellation; it cannot retain ownership.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function requestGeneration(idea: string, signal?: AbortSignal, interactive = false): Promise<unknown> {
  const input = idea.trim()
  if (!input || input.length > 4000) throw new Error('请输入 1–4000 字的软件创意。')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(abort, 45000)
  try {
    controller.signal.throwIfAborted()
    const response = await abortable(fetch('/api/ai/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', redirect: 'error',
      body: JSON.stringify({ idea: input, ...(interactive ? { protocol: 'trusted-interactive/1' } : {}) }), signal: controller.signal,
    }), controller.signal)
    const body = await readGenerationResponse(response, controller.signal)
    controller.signal.throwIfAborted()
    if (!response.ok) {
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code
      if (interactive) {
        const safeCode = typeof code === 'string' && ['AI_DISABLED', 'AI_NOT_CONFIGURED', 'AI_INVALID_SPEC', 'AI_TIMEOUT', 'AI_UNAVAILABLE', 'UNAUTHORIZED', 'BUDGET_EXHAUSTED'].includes(code) ? `（${code}）` : ''
        throw new Error(`可信交互生成未成功${safeCode}；当前部署需可信会话、Tech Lead 批准及费用预算。`)
      }
      throw new Error((typeof code === 'string' && Object.prototype.hasOwnProperty.call(errors, code) && errors[code]) || (response.status === 429 ? '请求过于频繁，请稍后重试。' : response.status === 504 ? 'AI 生成超时，请重试。' : `生成失败（HTTP ${response.status}），请稍后重试。`))
    }
    return body
  } catch (error) {
    if (controller.signal.aborted) throw new Error(CANCELLED)
    if (error instanceof TypeError) throw new Error('无法连接生成服务，请检查后端是否已启动。')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}

export async function generateProject(idea: string, signal?: AbortSignal): Promise<ProjectState> {
  const body = await requestGeneration(idea, signal)
  signal?.throwIfAborted()
  try {
    const state = initializeGeneratedProject(body)
    if (state.spec.version !== 1) throw new Error('Legacy generation requires v1')
    return state
  } catch { throw new Error('AI 返回的应用未通过 AppSpec 校验，请重试。') }
}

export interface InteractiveGeneration { state: ProjectState; source: 'deepseek' | 'offline-fixture'; model: string }
/** Opt-in extension; legacy v1 generation response and UI path stay available. */
export async function generateInteractiveProject(idea: string, signal?: AbortSignal): Promise<InteractiveGeneration> {
  const value = await requestGeneration(idea, signal, true)
  signal?.throwIfAborted()
  const exactKeys = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
  // Shape checks precede narrowing; provenance is server metadata, not execution authority.
  const reply = value as { protocol?: unknown; spec?: unknown; provenance?: { source?: unknown; model?: unknown } } | null
  if (!exactKeys(reply, ['protocol', 'spec', 'provenance']) || !exactKeys(reply?.provenance, ['source', 'model']) || reply?.protocol !== 'trusted-interactive/1' || !['deepseek', 'offline-fixture'].includes(reply?.provenance?.source as string) || (typeof reply?.provenance?.model !== 'string' || !reply.provenance.model.trim() || reply.provenance.model.length > 200)) throw new Error('生成来源校验失败。')
  const state = initializeGeneratedProject(reply.spec)
  if (state.spec.version !== 2 || state.spec.blocks.length !== 1 || state.spec.blocks[0].type !== 'pomodoro' || state.spec.entities.length || state.spec.relations.length) throw new Error('可信番茄钟配置校验失败。')
  return { state, source: reply.provenance.source as InteractiveGeneration['source'], model: reply.provenance.model }
}
