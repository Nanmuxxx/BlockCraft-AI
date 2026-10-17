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

export async function generateProject(idea: string, signal?: AbortSignal): Promise<ProjectState> {
  const input = idea.trim()
  if (!input || input.length > 4000) throw new Error('请输入 1–4000 字的软件创意。')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(abort, 45000)
  try {
    const response = await fetch('/api/ai/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idea: input }), signal: controller.signal,
    })
    const body: unknown = await response.json().catch(() => { throw new Error('服务未返回有效 JSON，请检查后端是否已启动。') })
    if (!response.ok) {
      const code = (body as { error?: { code?: string } } | null)?.error?.code
      throw new Error((code && errors[code]) || (response.status === 429 ? '请求过于频繁，请稍后重试。' : response.status === 504 ? 'AI 生成超时，请重试。' : `生成失败（HTTP ${response.status}），请稍后重试。`))
    }
    try { return initializeGeneratedProject(body) }
    catch { throw new Error('AI 返回的应用未通过 AppSpec 校验，请重试。') }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('生成已取消或超时，请重试。')
    if (error instanceof TypeError) throw new Error('无法连接生成服务，请检查后端是否已启动。')
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
