const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createAppRuntime, createClubRegistrationExample, copy } = require('../custom-block/fixtures.cjs')
require.extensions['.tsx'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }, fileName: filename }).outputText, filename)
require.extensions['.css'] = () => {}
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { GeneratedArtifactPreview } = require('../../src/integrations/custom-block-bc/CustomBlockImport.tsx')
const { createGeneratedArtifactUI } = require('../../src/integrations/generated-artifact/ui.ts')
const record = require('../generated-artifact/fixtures/pomodoro.pending.json')
const ref = { definitionId: record.entry.artifact.manifest.definitionId, versionDigest: record.entry.versionDigest }
const file = () => ({ instance: { id: 'offline-pomodoro', ...ref, props: { initialMinutes: 25, title: '离线真实制品' } }, artifact: copy(record.entry) })
const envelope = () => ({ importFile: file(), provenance: copy(record.provenance), status: 'pending-build', validation: 'source-admitted', build: 'not-attempted', execution: 'denied' })
const input = value => { const text = JSON.stringify(value); return { size: Buffer.byteLength(text), text: async () => text } }
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r }), resolve: () => resolve() } }
function setup(wrap = x => x) {
  const runtime = createAppRuntime(createClubRegistrationExample()), owner = runtime.customProject
  return { runtime, owner, ui: createGeneratedArtifactUI(wrap(owner)) }
}
globalThis.fetch = () => { throw Error('NETWORK_FORBIDDEN') }

test('real pending fixture: read + preview + cancel do not write; confirmed install only appends once', async () => {
  let calls = 0
  const f = setup(owner => ({ ...owner, install(...args) { calls++; return owner.install(...args) } }))
  const before = f.owner.getSnapshot()
  await f.ui.readFile(input(envelope())); assert.equal(f.ui.getSnapshot().phase, 'loaded')
  await f.ui.prepare(); assert.equal(f.ui.getSnapshot().phase, 'preview')
  assert.equal(f.owner.getSnapshot(), before); assert.equal(await f.owner.registry.resolve(ref), undefined)
  f.ui.cancel(); assert.equal(f.owner.getSnapshot(), before); assert.equal(calls, 0)
  await f.ui.readFile(input(envelope())); await f.ui.prepare()
  await Promise.all([f.ui.confirm(), f.ui.confirm()]); await f.ui.confirm()
  assert.equal(calls, 1); assert.equal(f.ui.getSnapshot().phase, 'installed')
  const expected = copy(before); expected.revision++; expected.custom.instances.push(file().instance)
  expected.custom.positions['offline-pomodoro'] = { x: .1, y: .7 }; expected.renderOrder.push({ kind: 'custom', id: 'offline-pomodoro' })
  assert.deepEqual(f.owner.getSnapshot(), expected)
  assert.deepEqual(await f.owner.registry.resolve(ref), record.entry)
  f.ui.dispose()
})

test('preview component shows exact identity/props/source and status; no source HTML or runtime', async () => {
  const f = setup(); const e = envelope(); e.importFile.instance.props.title = '<script>bad()</script>'
  await f.ui.readFile(input(e)); await f.ui.prepare()
  const html = renderToStaticMarkup(React.createElement(GeneratedArtifactPreview, { state: f.ui.getSnapshot(), readOnly: false, action() {} }))
  for (const text of ['中文番茄钟', ref.versionDigest, 'initialMinutes', '25', '文件声明来源', 'deepseek', 'pending-build', '暂不可运行', '确认添加', '取消添加']) assert.ok(html.includes(text), text)
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('setInterval')); assert.ok(!html.includes('<iframe'))
  const readonly = renderToStaticMarkup(React.createElement(GeneratedArtifactPreview, { state: f.ui.getSnapshot(), readOnly: true, action() {} }))
  assert.match(readonly, /disabled=""/)
  f.ui.dispose()
})

test('corrupt version, malformed envelope/JSON, executable status, props and existing ID all fail closed', async () => {
  for (const change of [e => e.importFile.instance.versionDigest = 'sha256:' + '0'.repeat(64), e => e.status = 'runnable', e => e.extra = true, e => e.importFile.instance.props.initialMinutes = 0, e => e.importFile.instance.id = 'registration-form']) {
    const f = setup(), before = f.owner.getSnapshot(), e = envelope(); change(e)
    await f.ui.readFile(input(e)); if (f.ui.getSnapshot().phase === 'loaded') await f.ui.prepare()
    assert.equal(f.ui.getSnapshot().phase, 'error'); assert.equal(f.owner.getSnapshot(), before); assert.equal(await f.owner.registry.resolve(ref), undefined)
    f.ui.dispose()
  }
  const f = setup(); await f.ui.readFile({ size: 1, text: async () => '{' }); assert.equal(f.ui.getSnapshot().phase, 'error')
  await f.ui.readFile({ size: 4_000_001, text() { throw Error('must not read') } }); assert.equal(f.ui.getSnapshot().phase, 'error'); f.ui.dispose()
})

test('late reads, cancellation and superseding requests never revive a preview', async () => {
  const f = setup(), gate = deferred()
  const a = f.ui.readFile({ size: 1, text: async () => { await gate.promise; return JSON.stringify(file()) } })
  f.ui.cancel(); gate.resolve(); await a; assert.equal(f.ui.getSnapshot().phase, 'idle')
  const g = deferred(), slow = f.ui.readFile({ size: 1, text: async () => { await g.promise; return '{' } })
  await f.ui.readFile(input(envelope())); g.resolve(); await slow
  assert.equal(f.ui.getSnapshot().phase, 'loaded'); f.ui.dispose()
})

test('owner revision and authorization changes invalidate loaded/preview candidates', async () => {
  for (const phase of ['loaded', 'preview']) for (const mutation of ['revision', 'permission']) {
    const f = setup(); await f.ui.readFile(input(file())); if (phase === 'preview') await f.ui.prepare()
    if (mutation === 'permission') f.owner.setReadOnly(true)
    else { const old = f.owner.getSnapshot(), next = copy(old); next.revision++; assert.equal(f.owner.compareAndSwap(old, next, f.owner.getAuthorization()).ok, true) }
    const before = f.owner.getSnapshot(); assert.equal(f.ui.getSnapshot().phase, 'error')
    await assert.rejects(f.ui.confirm()); assert.equal(f.owner.getSnapshot(), before); assert.equal(await f.owner.registry.resolve(ref), undefined)
    f.ui.dispose()
  }
})

test('confirmation locks parent switch/unmount synchronously before setter; double confirm invokes install once', async () => {
  const gate = deferred(); let calls = 0
  const f = setup(owner => ({ ...owner, async install(...args) { calls++; await gate.promise; return owner.install(...args) } }))
  await f.ui.readFile(input(file())); await f.ui.prepare()
  const confirm = f.ui.confirm(); assert.equal(f.ui.isConfirming(), true)
  let project = 'old', mounted = true
  const replace = () => { f.ui.beforeContextChange(); project = 'new' }
  const unmount = () => { f.ui.dispose(); mounted = false }
  assert.throws(replace, { code: 'CONFIRM_BUSY' }); assert.equal(project, 'old')
  assert.throws(unmount, { code: 'CONFIRM_BUSY' }); assert.equal(mounted, true)
  assert.throws(() => f.ui.cancel(), { code: 'CONFIRM_BUSY' })
  await f.ui.confirm(); assert.equal(calls, 1)
  gate.resolve(); await confirm; assert.equal(f.ui.getSnapshot().phase, 'installed')
  replace(); unmount(); assert.equal(project, 'new'); assert.equal(mounted, false)
})

test('concurrent commit or revoked authorization during install rejects without registry publication', async () => {
  for (const kind of ['revision', 'permission']) {
    const gate = deferred(), f = setup(owner => ({ ...owner, async install(...args) { await gate.promise; return owner.install(...args) } }))
    await f.ui.readFile(input(file())); await f.ui.prepare(); const pending = f.ui.confirm()
    if (kind === 'permission') f.owner.setReadOnly(true)
    else { const old = f.owner.getSnapshot(), next = copy(old); next.revision++; f.owner.compareAndSwap(old, next, f.owner.getAuthorization()) }
    const before = f.owner.getSnapshot(); gate.resolve(); await pending
    assert.equal(f.ui.getSnapshot().phase, 'error'); assert.equal(f.owner.getSnapshot(), before); assert.equal(await f.owner.registry.resolve(ref), undefined); f.ui.dispose()
  }
})

test('context change while prepare awaits discards result; disposal and StrictMode empty replay clean subscriptions', async () => {
  let listeners = 0
  const f = setup(owner => ({ ...owner, subscribe(fn) { listeners++; const off = owner.subscribe(fn); return () => { listeners--; off() } } }))
  assert.equal(listeners, 0); f.ui.dispose(); f.ui.activate()
  await f.ui.readFile(input(file())); assert.equal(listeners, 2)
  const before = f.owner.getSnapshot(), pending = f.ui.prepare(); f.ui.beforeContextChange(); await pending
  assert.equal(f.ui.getSnapshot().phase, 'idle'); assert.equal(f.owner.getSnapshot(), before)
  f.ui.dispose(); assert.equal(listeners, 0); await assert.rejects(f.ui.readFile(input(file())), { code: 'INSTALLER_DISPOSED' })
})

test('unexpected session exception remains error; no success receipt or automatic retry', async () => {
  let calls = 0
  const f = setup(owner => ({ ...owner, async install() { calls++; throw Error('host failed') } }))
  await f.ui.readFile(input(file())); await f.ui.prepare(); await f.ui.confirm()
  assert.equal(f.ui.getSnapshot().phase, 'error'); await assert.rejects(f.ui.confirm()); assert.equal(calls, 1); assert.equal(f.owner.getSnapshot().custom.instances.length, 0); f.ui.dispose()
})

for (const cause of ['cancel', 'replace', 'dispose', 'revision', 'permission']) {
  test(`stalled file read settles promptly after ${cause}; late rejection cannot overwrite new input`, { timeout: 1000 }, async () => {
    const f = setup(); let rejectRead
    const pending = f.ui.readFile({ size: 1, text: () => new Promise((_, reject) => { rejectRead = reject }) })
    await Promise.resolve()
    if (cause === 'cancel') f.ui.cancel()
    if (cause === 'replace') f.ui.beforeContextChange()
    if (cause === 'dispose') f.ui.dispose()
    if (cause === 'permission') f.owner.setReadOnly(true)
    if (cause === 'revision') {
      const before = f.owner.getSnapshot(), next = copy(before); next.revision++
      f.owner.compareAndSwap(before, next, f.owner.getAuthorization())
    }
    await pending
    if (cause === 'dispose') f.ui.activate()
    if (cause === 'permission') f.owner.setReadOnly(false)
    await f.ui.readFile(input(envelope()))
    rejectRead(Error('late read failure')); await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.ui.getSnapshot().phase, 'loaded')
    assert.equal(f.owner.getSnapshot().custom.instances.length, 0)
    f.ui.dispose()
  })
}

test('a superseding file read settles the stalled caller without losing its own draft', { timeout: 1000 }, async () => {
  const f = setup()
  const pending = f.ui.readFile({ size: 1, text: () => new Promise(() => {}) })
  await f.ui.readFile(input(envelope())); await pending
  assert.equal(f.ui.getSnapshot().phase, 'loaded'); f.ui.dispose()
})

for (const phase of ['idle', 'reading']) {
  test(`subscriber reentry during ${phase} publication keeps the newer read`, async () => {
    const f = setup(); let newer, armed = true, staleReads = 0
    const off = f.ui.subscribe(() => {
      if (!armed || f.ui.getSnapshot().phase !== phase) return
      armed = false
      newer = f.ui.readFile(input(envelope()))
    })
    await f.ui.readFile({ size: 1, text: async () => { staleReads++; return '{' } })
    await newer
    assert.equal(staleReads, 0)
    assert.equal(f.ui.getSnapshot().phase, 'loaded')
    off(); f.ui.dispose()
  })
}

test('native file bytes use strict UTF-8 before accepting names or props; text fallback cannot mask corruption', async () => {
  const f = setup(); let textCalls = 0
  const bytes = Buffer.from(JSON.stringify(envelope()))
  const offset = bytes.indexOf(Buffer.from('离线真实制品'))
  assert.ok(offset >= 0); bytes[offset] = 0xff
  await f.ui.readFile({ size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer, text: async () => { textCalls++; return bytes.toString('utf8') } })
  assert.equal(f.ui.getSnapshot().phase, 'error'); assert.equal(textCalls, 0)
  assert.equal(f.owner.getSnapshot().custom.instances.length, 0)
  const valid = Buffer.from(JSON.stringify(envelope()))
  await f.ui.readFile({ size: valid.length, arrayBuffer: async () => Uint8Array.from(valid).buffer, text: async () => { throw Error('must use bytes') } })
  assert.equal(f.ui.getSnapshot().phase, 'loaded'); await f.ui.prepare()
  assert.equal(f.ui.getSnapshot().phase, 'preview'); f.ui.dispose()
})

test('file byte bounds reject invalid declarations and oversized byte buffers', async () => {
  const f = setup(); let reads = 0
  for (const size of [-1, NaN, Infinity, 0.5, 4_000_001]) {
    await f.ui.readFile({ size, text: async () => { reads++; return '{}' } })
    assert.equal(f.ui.getSnapshot().phase, 'error')
  }
  assert.equal(reads, 0)
  await f.ui.readFile({ size: 1, arrayBuffer: async () => new ArrayBuffer(4_000_001), text: async () => '{}' })
  assert.equal(f.ui.getSnapshot().phase, 'error'); assert.match(f.ui.getSnapshot().message, /过大/)
  f.ui.dispose()
})

test('native byte read cancellation also retires without waiting for the File promise', { timeout: 1000 }, async () => {
  const f = setup()
  const pending = f.ui.readFile({ size: 1, arrayBuffer: () => new Promise(() => {}), text: async () => { throw Error('fallback forbidden') } })
  f.ui.cancel(); await pending
  assert.equal(f.ui.getSnapshot().phase, 'idle'); f.ui.dispose()
})
