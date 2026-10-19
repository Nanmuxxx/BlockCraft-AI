import { createSafeTsxViewer } from '/client.js'

localStorage.setItem('host-token', 'HOST_AUTH_SECRET')
document.cookie = 'host_cookie=HOST_COOKIE_SECRET; SameSite=Strict; Path=/'

const fixtures = await fetch('/fixtures.json', { cache: 'no-store' }).then(response => {
  if (!response.ok) throw new Error('fixtures failed')
  return response.json()
})
const runtimeConfig = await fetch('/api/safe-viewer/config', { cache: 'no-store' }).then(response => {
  if (!response.ok) throw new Error('viewer config failed')
  return response.json()
})
const bootTimeout = Number(new URLSearchParams(location.search).get('bootTimeout') ?? 5000)
const controller = createSafeTsxViewer({
  enabled: true,
  compileEndpoint: '/api/safe-viewer/compile',
  runnerOrigins: runtimeConfig.runnerOrigins,
  retireEndpoint: '/api/safe-viewer/retire',
  bootTimeoutMs: bootTimeout,
})
const host = document.getElementById('viewer-host')
const status = document.querySelector('[data-testid="viewer-status"]')
const message = document.getElementById('viewer-message')
const diagnostics = document.querySelector('[data-testid="diagnostics"]')
const ping = document.querySelector('[data-testid="host-ping"]')
let pingCount = 0
let lastSnapshot = null

function render(snapshot) {
  lastSnapshot = snapshot
  status.textContent = snapshot.label
  status.dataset.status = snapshot.status
  message.textContent = `${snapshot.message}${snapshot.errorCode ? `（${snapshot.errorCode}）` : ''}`
  diagnostics.textContent = JSON.stringify(controller.getDiagnostics())
}

controller.subscribe(() => render(controller.getSnapshot()))
render(controller.getSnapshot())

document.getElementById('ping').addEventListener('click', () => {
  ping.textContent = String(++pingCount)
})
for (const button of document.querySelectorAll('[data-fixture]')) {
  button.addEventListener('click', () => {
    const value = fixtures[button.dataset.fixture]
    if (value) void controller.mount(value, host)
  })
}
document.getElementById('dispose').addEventListener('click', () => controller.dispose())
document.getElementById('restart').addEventListener('click', () => { void controller.restart() })

window.__safeViewerTest = Object.freeze({
  controller,
  fixtures,
  mount: key => controller.mount(fixtures[key], host),
  dispose: () => controller.dispose(),
  restart: () => controller.restart(),
  state: () => controller.getSnapshot(),
  lastSnapshot: () => lastSnapshot,
  diagnostics: () => controller.getDiagnostics(),
  forge(value) { window.postMessage(value, '*') },
  hostSecrets() {
    return {
      dom: document.getElementById('host-secret').textContent,
      storage: localStorage.getItem('host-token'),
      cookie: document.cookie,
      ping: pingCount,
    }
  },
  async compileRaw(body) {
    const response = await fetch('/api/safe-viewer/compile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  },
  async stats() {
    const response = await fetch('/api/safe-viewer/stats', { cache: 'no-store' })
    return response.json()
  },
})
