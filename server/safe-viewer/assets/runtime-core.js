import React from 'react'
import { createRoot } from 'react-dom/client'

const PROTOCOL = 'blockcraft-safe-viewer/1'
const SDK = '1.0.0'
const MAX_MESSAGE = 16_384
const MAX_DEPTH = 8
const MAX_NODES = 2_000

const config = {
  parentOrigin: document.querySelector('meta[name="blockcraft-parent-origin"]')?.getAttribute('content') ?? '',
  sessionId: document.querySelector('meta[name="blockcraft-session"]')?.getAttribute('content') ?? '',
  nonce: document.querySelector('meta[name="blockcraft-nonce"]')?.getAttribute('content') ?? '',
}

const native = {
  setTimeout: window.setTimeout.bind(window),
  clearTimeout: window.clearTimeout.bind(window),
  setInterval: window.setInterval.bind(window),
  clearInterval: window.clearInterval.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
}

const timeouts = new Set()
const intervals = new Set()
const animations = new Set()
let port = null
let root = null
let container = null
let disposed = false
let failed = false
let seq = 0

function blocked(name) {
  const error = new Error(`${name} is disabled in the safe viewer`)
  error.name = 'SafeViewerCapabilityError'
  return error
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function keys(value, required) {
  return isRecord(value) && Object.keys(value).length === required.length && required.every(key => Object.prototype.hasOwnProperty.call(value, key))
}

function text(value, max = 1_024) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function id(value) {
  return text(value, 128) && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value)
}

function assertJson(value) {
  let nodes = 0
  const stack = [[value, 0]]
  while (stack.length) {
    const [item, depth] = stack.pop()
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw blocked('message shape')
    if (item === null || typeof item === 'boolean') continue
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw blocked('message number')
      continue
    }
    if (typeof item === 'string') {
      if (item.length > 4_096) throw blocked('message string')
      continue
    }
    if (!Array.isArray(item) && !isRecord(item)) throw blocked('message object')
    for (const [key, child] of Object.entries(item)) {
      if (key.length > 128) throw blocked('message key')
      stack.push([child, depth + 1])
    }
  }
  return true
}

function send(type, payload = {}) {
  if (!port || disposed || !text(config.sessionId, 128) || !text(config.nonce, 128)) return
  try {
    seq++
    port.postMessage({ protocol: PROTOCOL, type, sessionId: config.sessionId, nonce: config.nonce, seq, ...payload })
  } catch {
    // The parent may already have removed the frame.
  }
}

function fail(code, error) {
  if (failed || disposed) return
  failed = true
  const message = error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 240) : 'Runtime failure'
  send('error', { code, message })
}

function defineWindow(name, value) {
  try {
    Object.defineProperty(window, name, { configurable: false, enumerable: false, writable: false, value })
  } catch {
    try { window[name] = value } catch { /* Browser may expose a non-configurable property. */ }
  }
}

function blockedFunction(name) {
  return function safeViewerBlockedCapability() { throw blocked(name) }
}

function blockGetter(name) {
  try {
    Object.defineProperty(window, name, {
      configurable: false,
      enumerable: false,
      get() { throw blocked(name) },
    })
  } catch { /* Opaque origin already protects the capability. */ }
}

function harden() {
  for (const name of [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'RTCPeerConnection',
    'RTCDataChannel', 'Worker', 'SharedWorker', 'BroadcastChannel', 'Notification',
    'WebAssembly', 'eval', 'Function', 'importScripts', 'postMessage', 'open', 'print', 'close',
  ]) defineWindow(name, blockedFunction(name))
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore']) blockGetter(name)
  try {
    Object.defineProperty(document, 'cookie', {
      configurable: false,
      get() { throw blocked('document.cookie') },
      set() { throw blocked('document.cookie') },
    })
  } catch { /* Opaque origin still prevents host cookie access. */ }
  for (const name of ['sendBeacon', 'serviceWorker', 'clipboard', 'geolocation', 'mediaDevices', 'getUserMedia']) {
    try {
      Object.defineProperty(navigator, name, {
        configurable: false,
        get() { throw blocked(`navigator.${name}`) },
      })
    } catch { /* Ignore non-configurable platform properties. */ }
  }
  for (const name of ['parent', 'top', 'opener', 'location']) blockGetter(name)

  const trackedTimeout = function safeViewerSetTimeout(callback, delay, ...args) {
    const handle = native.setTimeout(() => { timeouts.delete(handle); callback(...args) }, delay)
    timeouts.add(handle)
    return handle
  }
  const trackedInterval = function safeViewerSetInterval(callback, delay, ...args) {
    const handle = native.setInterval(callback, delay, ...args)
    intervals.add(handle)
    return handle
  }
  defineWindow('setTimeout', trackedTimeout)
  defineWindow('setInterval', trackedInterval)
  defineWindow('clearTimeout', function safeViewerClearTimeout(handle) { timeouts.delete(handle); native.clearTimeout(handle) })
  defineWindow('clearInterval', function safeViewerClearInterval(handle) { intervals.delete(handle); native.clearInterval(handle) })
  defineWindow('requestAnimationFrame', function safeViewerRequestAnimationFrame(callback) {
    const handle = native.requestAnimationFrame(time => { animations.delete(handle); callback(time) })
    animations.add(handle)
    return handle
  })
  defineWindow('cancelAnimationFrame', function safeViewerCancelAnimationFrame(handle) { animations.delete(handle); native.cancelAnimationFrame(handle) })
}

function cleanup() {
  if (disposed) return
  disposed = true
  try { root?.unmount() } catch { /* A failed render may already have torn down the root. */ }
  root = null
  for (const handle of timeouts) native.clearTimeout(handle)
  for (const handle of intervals) native.clearInterval(handle)
  for (const handle of animations) native.cancelAnimationFrame(handle)
  timeouts.clear(); intervals.clear(); animations.clear()
  try { port?.close() } catch { /* Port may already be closed. */ }
  port = null
  try { container?.replaceChildren() } catch { /* Container is inside the disposable frame. */ }
  container = null
}

function acceptInit(data) {
  if (!keys(data, ['protocol', 'type', 'sessionId', 'nonce', 'props'])) return false
  if (data.protocol !== PROTOCOL || data.type !== 'init') return false
  if (data.sessionId !== config.sessionId || data.nonce !== config.nonce) return false
  if (!isRecord(data.props)) return false
  try { assertJson(data.props) } catch { return false }
  if (new TextEncoder().encode(JSON.stringify(data.props)).byteLength > MAX_MESSAGE) return false
  return true
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { this.props.onError('RENDER_ERROR', error) }
  render() {
    return this.state.failed
      ? React.createElement('div', { role: 'alert', 'data-safe-viewer-error': 'render' }, '组件渲染失败')
      : this.props.children
  }
}

function ReadyOnMount({ onReady, children }) {
  React.useEffect(() => { onReady() }, [onReady])
  return children
}

async function start(data, messagePort, loadComponent) {
  if (!acceptInit(data)) return
  port = messagePort
  container = document.getElementById('root')
  if (!(container instanceof HTMLElement)) return fail('RUNTIME_MOUNT_FAILED', new Error('Missing viewer root'))
  port.onmessage = event => {
    const message = event.data
    if (keys(message, ['protocol', 'type', 'sessionId', 'nonce']) && message.protocol === PROTOCOL &&
      message.type === 'dispose' && message.sessionId === config.sessionId && message.nonce === config.nonce) cleanup()
  }
  window.addEventListener('error', event => fail('RUNTIME_UNCAUGHT', event.error instanceof Error ? event.error : new Error('window error')))
  window.addEventListener('unhandledrejection', event => fail('RUNTIME_UNCAUGHT', event.reason instanceof Error ? event.reason : new Error('unhandled rejection')))
  harden()
  root = createRoot(container, {
    onUncaughtError(error) { fail('RUNTIME_UNCAUGHT', error) },
    onCaughtError(error) { fail('RENDER_ERROR', error) },
  })
  try {
    const module = await loadComponent()
    const Component = module?.default
    if (typeof Component !== 'function' && (typeof Component !== 'object' || Component === null)) {
      throw new Error('Entry does not export a component')
    }
    const onReady = () => { if (!failed && !disposed) send('ready', { sdkVersion: SDK }) }
    root.render(React.createElement(ErrorBoundary, { onError: fail },
      React.createElement(ReadyOnMount, { onReady }, React.createElement(Component, data.props))))
  } catch (error) {
    fail('BUNDLE_LOAD_FAILED', error)
  }
}

function boot(loadComponent) {
  if (window.top === window) {
    document.body.textContent = '此页面只能在 BlockCraft 隔离查看器中使用。'
    return
  }
  if (!text(config.parentOrigin, 256) || !text(config.sessionId, 128) || !text(config.nonce, 128)) return
  let initialized = false
  const receive = event => {
    if (initialized) return
    if (event.source !== window.parent) return
    if (event.origin !== config.parentOrigin) return
    if (!keys(event.data, ['protocol', 'type', 'sessionId', 'nonce', 'props'])) return
    if (event.data.protocol !== PROTOCOL || event.data.type !== 'init') return
    if (event.data.sessionId !== config.sessionId || event.data.nonce !== config.nonce) return
    if (!event.ports || event.ports.length !== 1) return
    initialized = true
    window.removeEventListener('message', receive)
    start(event.data, event.ports[0], loadComponent).catch(error => fail('RUNTIME_START_FAILED', error))
  }
  window.addEventListener('message', receive)
  window.parent.postMessage({ protocol: PROTOCOL, type: 'boot', sessionId: config.sessionId, nonce: config.nonce }, config.parentOrigin)
}

export function mountViewer(loadComponent) {
  boot(loadComponent)
}
