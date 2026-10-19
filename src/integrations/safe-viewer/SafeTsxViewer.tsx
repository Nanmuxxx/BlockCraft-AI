import { useEffect, useRef, useState } from 'react'
import type { SafeViewerOptions, SafeViewerRequest, SafeViewerSnapshot } from './client'
import { createSafeTsxViewer, viewerUiState } from './client'

/** Experimental module. It is intentionally not imported by the production C mode. */
export function SafeTsxViewer({ request, options, title = '自定义积木' }: {
  request?: SafeViewerRequest
  options: SafeViewerOptions
  title?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<SafeViewerSnapshot>(() => viewerUiState(options.enabled ? 'unavailable' : 'disabled'))
  const [controller, setController] = useState<ReturnType<typeof createSafeTsxViewer> | null>(null)
  const runnerOriginsKey = options.runnerOrigins?.join('|') ?? ''
  useEffect(() => {
    const next = createSafeTsxViewer(options)
    setController(next)
    const unsubscribe = next.subscribe(() => setState(next.getSnapshot()))
    setState(next.getSnapshot())
    return () => { unsubscribe(); next.dispose(); setController(null) }
  }, [options.enabled, options.compileEndpoint, options.runnerOrigin, runnerOriginsKey, options.retireEndpoint, options.bootTimeoutMs])
  useEffect(() => {
    if (!controller || !request || !host.current) return
    void controller.mount(request, host.current)
  }, [controller, request])
  return <section data-safe-viewer-status={state.status} data-safe-viewer-error={state.errorCode} aria-label={title}>
    <header><strong>{title}</strong><span>{state.label}</span></header>
    <p role="status">{state.message}{state.errorCode ? `（${state.errorCode}）` : ''}</p>
    <div ref={host} data-safe-viewer-host style={{ minHeight: 120 }} />
    {controller && (state.canDispose || state.canRetry) ? <div>
      {state.canRetry ? <button type="button" onClick={() => { void controller.restart() }}>重新加载隔离运行器</button> : null}
      {state.canDispose ? <button type="button" onClick={() => controller.dispose()}>关闭隔离运行器</button> : null}
    </div> : null}
  </section>
}
