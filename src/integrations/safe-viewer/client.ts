import type { CustomBlockInstance, SourceArtifact, VersionDigest } from '../../custom-block'

export const SAFE_VIEWER_PROTOCOL = 'blockcraft-safe-viewer/1'

export type SafeViewerStatus =
  | 'unavailable'
  | 'disabled'
  | 'compiling'
  | 'booting'
  | 'ready'
  | 'error'
  | 'disposed'

export interface SafeViewerSnapshot {
  status: SafeViewerStatus
  label: string
  message: string
  canRetry: boolean
  canDispose: boolean
  interactive: boolean
  errorCode?: string
}

export interface SafeViewerRequest {
  instance: CustomBlockInstance
  artifact: SourceArtifact
}

export interface SafeViewerCompileResponse {
  sessionId: string
  nonce: string
  runnerUrl: string
  bundleUrl: string
  bundleDigest: VersionDigest
  expiresAt: number
  cache: 'hit' | 'build'
}

export interface SafeViewerOptions {
  enabled?: boolean
  compileEndpoint: string
  runnerOrigin?: string
  runnerOrigins?: string[]
  retireEndpoint?: string
  bootTimeoutMs?: number
}

export interface SafeViewerDiagnostics {
  status: SafeViewerStatus
  sessionId: string | null
  nonce: string | null
  framePresent: boolean
  windowListenerAttached: boolean
  mounts: number
  acceptedMessages: number
  rejectedMessages: number
  cache: 'hit' | 'build' | null
  lastError: string | null
  lastRunnerUrl: string | null
}

const ui: Record<SafeViewerStatus, Omit<SafeViewerSnapshot, 'status' | 'errorCode'>> = Object.freeze({
  unavailable: { label: '运行暂不可用', message: '尚未提交可运行的隔离组件。', canRetry: false, canDispose: false, interactive: false },
  disabled: { label: '安全 Viewer 已关闭', message: '安全运行开关未启用，未加载或执行任何模型代码。', canRetry: false, canDispose: false, interactive: false },
  compiling: { label: '正在编译隔离组件', message: '仅在受限编译进程中构建，宿主不会执行源码。', canRetry: false, canDispose: true, interactive: false },
  booting: { label: '正在启动隔离环境', message: '正在等待独立源站 iframe 的安全握手。', canRetry: false, canDispose: true, interactive: false },
  ready: { label: '隔离环境运行中', message: '组件仅在跨源沙箱 iframe 内渲染，无法访问宿主认证信息。', canRetry: false, canDispose: true, interactive: true },
  error: { label: '隔离运行已停止', message: '安全运行失败，宿主未执行模型代码。', canRetry: true, canDispose: false, interactive: false },
  disposed: { label: '已卸载', message: '隔离 iframe、消息通道和计时器已清理。', canRetry: true, canDispose: false, interactive: false },
})

export function viewerUiState(status: SafeViewerStatus, errorCode?: string): SafeViewerSnapshot {
  return Object.freeze({ status, ...ui[status], ...(errorCode ? { errorCode } : {}) })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value: unknown, required: string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === required.length &&
    required.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function id(value: unknown): value is string {
  return boundedText(value, 128) && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value)
}

function digest(value: unknown): value is VersionDigest {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('runnerOrigin must be a bare http(s) origin')
  }
  return url.origin
}

function validateCompileResponse(value: unknown, runnerOrigins: Set<string>): SafeViewerCompileResponse {
  if (!exactKeys(value, ['sessionId', 'nonce', 'runnerUrl', 'bundleUrl', 'bundleDigest', 'expiresAt', 'cache'])) {
    throw new Error('INVALID_COMPILE_RESPONSE')
  }
  if (!boundedText(value.sessionId, 128) || !boundedText(value.nonce, 128)) throw new Error('INVALID_COMPILE_RESPONSE')
  if (!digest(value.bundleDigest)) throw new Error('INVALID_COMPILE_RESPONSE')
  if (!Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= Date.now()) throw new Error('INVALID_COMPILE_RESPONSE')
  if (value.cache !== 'hit' && value.cache !== 'build') throw new Error('INVALID_COMPILE_RESPONSE')
  const runner = new URL(value.runnerUrl as string)
  const bundle = new URL(value.bundleUrl as string)
  if (!runnerOrigins.has(runner.origin) || !runnerOrigins.has(bundle.origin)) throw new Error('RUNNER_ORIGIN_MISMATCH')
  if (runner.pathname !== '/runner' || [...runner.searchParams.keys()].length !== 1 ||
    runner.searchParams.get('session') !== value.sessionId) throw new Error('INVALID_COMPILE_RESPONSE')
  if (!new RegExp(`^/runner/bundle/${value.bundleDigest.slice(7)}\\.js$`).test(bundle.pathname)) throw new Error('INVALID_COMPILE_RESPONSE')
  if ([...bundle.searchParams.keys()].length !== 1 || bundle.searchParams.get('session') !== value.sessionId) throw new Error('INVALID_COMPILE_RESPONSE')
  return Object.freeze({
    sessionId: value.sessionId,
    nonce: value.nonce,
    runnerUrl: runner.href,
    bundleUrl: bundle.href,
    bundleDigest: value.bundleDigest,
    expiresAt: value.expiresAt as number,
    cache: value.cache,
  })
}

function messageBytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return Number.POSITIVE_INFINITY }
}

export function createSafeTsxViewer(options: SafeViewerOptions) {
  const enabled = options.enabled === true
  const runnerOrigins = new Set([
    ...(options.runnerOrigins ?? []),
    ...(options.runnerOrigin ? [options.runnerOrigin] : []),
  ].map(normalizeOrigin))
  if (runnerOrigins.size === 0) throw new Error('runnerOrigin or runnerOrigins is required')
  const bootTimeoutMs = Math.max(250, Math.min(30_000, options.bootTimeoutMs ?? 5_000))
  let snapshot = viewerUiState(enabled ? 'unavailable' : 'disabled')
  const listeners = new Set<() => void>()
  let frame: HTMLIFrameElement | null = null
  let port: MessagePort | null = null
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let compileAbort: AbortController | null = null
  let pending: { resolve: (state: SafeViewerSnapshot) => void } | null = null
  let lastRequest: SafeViewerRequest | null = null
  let lastContainer: HTMLElement | null = null
  let session: SafeViewerCompileResponse | null = null
  let expectedSeq = 0
  let handshakeStarted = false
  let disposed = false
  let listenerAttached = false
  let lastError: string | null = null
  let lastRunnerUrl: string | null = null
  let epoch = 0
  let mounts = 0
  let acceptedMessages = 0
  let rejectedMessages = 0
  const retiredSessions = new Set<string>()
  let retirePending: Promise<unknown> | null = null

  const publish = (next: SafeViewerSnapshot) => {
    snapshot = next
    for (const listener of listeners) {
      try { listener() } catch { /* A UI observer cannot break the viewer boundary. */ }
    }
  }
  const settle = () => {
    const current = pending
    pending = null
    current?.resolve(snapshot)
  }
  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = null
  }
  const removeWindowListener = () => {
    if (!listenerAttached) return
    window.removeEventListener('message', onWindowMessage)
    listenerAttached = false
  }
  const detachFrame = (sendDispose: boolean) => {
    clearWatchdog()
    removeWindowListener()
    const activePort = port
    port = null
    if (sendDispose && activePort && session) {
      try {
        activePort.postMessage({ protocol: SAFE_VIEWER_PROTOCOL, type: 'dispose', sessionId: session.sessionId, nonce: session.nonce })
      } catch { /* The frame may already be gone. */ }
    }
    try { activePort?.close() } catch { /* Port may already be closed. */ }
    frame?.remove()
    frame = null
    session = null
    expectedSeq = 0
    handshakeStarted = false
  }
  const stopWithError = (code: string, message?: string) => {
    if (disposed) return
    epoch++
    const retiring = code === 'RUNTIME_TIMEOUT' ? session : null
    lastError = code
    detachFrame(true)
    publish({ ...viewerUiState('error', code), ...(message ? { message } : {}) })
    settle()
    if (retiring && options.retireEndpoint && !retiredSessions.has(retiring.sessionId)) {
      retiredSessions.add(retiring.sessionId)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1_000)
      retirePending = fetch(options.retireEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol: SAFE_VIEWER_PROTOCOL, sessionId: retiring.sessionId }),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      }).finally(() => clearTimeout(timer)).catch(() => { /* Retirement is best effort; the origin is never reused by this client. */ })
    }
  }
  const validPortMessage = (value: unknown): value is Record<string, unknown> & {
    protocol: typeof SAFE_VIEWER_PROTOCOL; type: 'ready' | 'error'; sessionId: string; nonce: string; seq: number
  } => {
    if (!isRecord(value) || value.protocol !== SAFE_VIEWER_PROTOCOL) return false
    if (value.type !== 'ready' && value.type !== 'error') return false
    if (!session || value.sessionId !== session.sessionId || value.nonce !== session.nonce) return false
    if (!Number.isSafeInteger(value.seq) || (value.seq as number) <= 0) return false
    return true
  }

  function onPortMessage(event: MessageEvent) {
    if (!validPortMessage(event.data)) {
      rejectedMessages++
      stopWithError('PROTOCOL_REJECTED')
      return
    }
    if (event.data.seq !== expectedSeq + 1) {
      rejectedMessages++
      stopWithError('PROTOCOL_SEQUENCE_REJECTED')
      return
    }
    expectedSeq = event.data.seq
    acceptedMessages++
    if (event.data.type === 'ready') {
      const value = event.data
      if (!exactKeys(value, ['protocol', 'type', 'sessionId', 'nonce', 'seq', 'sdkVersion']) || value.sdkVersion !== '1.0.0') {
        rejectedMessages++
        stopWithError('PROTOCOL_REJECTED')
        return
      }
      if (snapshot.status !== 'booting' || !frame) {
        rejectedMessages++
        return
      }
      clearWatchdog()
      publish(viewerUiState('ready'))
      settle()
      return
    }
    const value = event.data
    if (!exactKeys(value, ['protocol', 'type', 'sessionId', 'nonce', 'seq', 'code', 'message']) ||
      !boundedText(value.code, 64) || !/^[A-Z_]{1,64}$/.test(value.code) || !boundedText(value.message, 512)) {
      rejectedMessages++
      stopWithError('PROTOCOL_REJECTED')
      return
    }
    stopWithError(value.code, '隔离组件已安全停止。')
  }

  function onWindowMessage(event: MessageEvent) {
    if (disposed || !frame) return
    if (event.source !== frame.contentWindow) {
      rejectedMessages++
      return
    }
    if (event.origin !== 'null') {
      rejectedMessages++
      return
    }
    if (handshakeStarted) {
      rejectedMessages++
      return
    }
    const value = event.data
    if (!exactKeys(value, ['protocol', 'type', 'sessionId', 'nonce']) ||
      value.protocol !== SAFE_VIEWER_PROTOCOL || value.type !== 'boot' ||
      !session || value.sessionId !== session.sessionId || value.nonce !== session.nonce ||
      messageBytes(value) > 16_384) {
      rejectedMessages++
      return
    }
    handshakeStarted = true
    acceptedMessages++
    const channel = new MessageChannel()
    port = channel.port1
    port.onmessage = onPortMessage
    try {
      frame.contentWindow?.postMessage({
        protocol: SAFE_VIEWER_PROTOCOL,
        type: 'init',
        sessionId: session.sessionId,
        nonce: session.nonce,
        props: lastRequest?.instance.props,
      }, '*', [channel.port2])
    } catch {
      stopWithError('HANDSHAKE_FAILED')
    }
  }

  async function compile(request: SafeViewerRequest) {
    if (!enabled) {
      publish(viewerUiState('disabled'))
      throw new Error('VIEWER_DISABLED')
    }
    const body = JSON.stringify({ protocol: SAFE_VIEWER_PROTOCOL, instance: request.instance, artifact: request.artifact })
    if (new TextEncoder().encode(body).byteLength > 512 * 1024) {
      throw new Error('REQUEST_TOO_LARGE')
    }
    const abort = new AbortController()
    compileAbort = abort
    publish(viewerUiState('compiling'))
    try {
      const response = await fetch(options.compileEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: abort.signal,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      })
      const text = await response.text()
      if (text.length > 64 * 1024) throw new Error('COMPILE_RESPONSE_LIMIT')
      let value: unknown
      try { value = JSON.parse(text) } catch { throw new Error('INVALID_COMPILE_RESPONSE') }
      if (!response.ok) {
        const code = isRecord(value) && isRecord(value.error) && boundedText(value.error.code, 64) ? value.error.code : 'COMPILE_FAILED'
        throw new Error(code)
      }
      return validateCompileResponse(value, runnerOrigins)
    } catch (error) {
      if (abort.signal.aborted) throw error
      const code = error instanceof Error && /^[A-Z_]{1,64}$/.test(error.message) ? error.message : 'COMPILE_FAILED'
      throw new Error(code)
    } finally {
      if (compileAbort === abort) compileAbort = null
    }
  }

  async function mount(request: SafeViewerRequest, host: HTMLElement): Promise<SafeViewerSnapshot> {
    if (!enabled) {
      publish(viewerUiState('disabled'))
      return snapshot
    }
    if (!id(request.instance.id) || !digest(request.instance.versionDigest) || !isRecord(request.instance.props)) {
      stopWithError('INVALID_REQUEST')
      return snapshot
    }
    if (retirePending) {
      await retirePending
      retirePending = null
    }
    const previous = pending
    previous?.resolve(snapshot)
    detachFrame(true)
    disposed = false
    const generation = ++epoch
    lastError = null
    lastRequest = request
    lastContainer = host
    mounts++
    publish(viewerUiState('compiling'))
    const result = new Promise<SafeViewerSnapshot>(resolve => { pending = { resolve } })
    let compiled: SafeViewerCompileResponse
    try {
      compiled = await compile(request)
    } catch (error) {
      const code = error instanceof Error && /^[A-Z_]{1,64}$/.test(error.message) ? error.message : 'COMPILE_FAILED'
      stopWithError(code)
      return snapshot
    }
    if (disposed || generation !== epoch || compileAbort?.signal.aborted) return snapshot
    session = compiled
    lastRunnerUrl = compiled.runnerUrl
    frame = document.createElement('iframe')
    frame.dataset.safeViewerFrame = ''
    frame.title = 'BlockCraft 安全隔离运行器'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('credentialless', '')
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.setAttribute('allow', 'camera \'none\'; microphone \'none\'; geolocation \'none\'; payment \'none\'; usb \'none\'; serial \'none\'; hid \'none\'; bluetooth \'none\'; clipboard-read \'none\'; clipboard-write \'none\'')
    frame.src = compiled.runnerUrl
    listenerAttached = true
    window.addEventListener('message', onWindowMessage)
    host.replaceChildren(frame)
    publish(viewerUiState('booting'))
    watchdog = setTimeout(() => stopWithError('RUNTIME_TIMEOUT'), bootTimeoutMs)
    return result
  }

  function dispose() {
    if (disposed) return
    epoch++
    disposed = true
    compileAbort?.abort()
    detachFrame(true)
    publish(viewerUiState('disposed'))
    settle()
  }

  async function restart() {
    if (!lastRequest || !lastContainer) return snapshot
    const request = lastRequest
    const host = lastContainer
    return mount(request, host)
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mount,
    dispose,
    restart,
    getDiagnostics: (): SafeViewerDiagnostics => ({
      status: snapshot.status,
      sessionId: session?.sessionId ?? null,
      nonce: session?.nonce ?? null,
      framePresent: Boolean(frame),
      windowListenerAttached: listenerAttached,
      mounts,
      acceptedMessages,
      rejectedMessages,
      cache: session?.cache ?? null,
      lastError,
      lastRunnerUrl,
    }),
  })
}

export type SafeTsxViewerController = ReturnType<typeof createSafeTsxViewer>
