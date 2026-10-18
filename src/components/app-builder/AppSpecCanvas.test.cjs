// Run: node --test src/components/app-builder/AppSpecCanvas.test.cjs
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename)
}
require.extensions['.css'] = () => {}

const { createAppRuntime } = require('../../model/appRuntime.ts')
const { createReadingLogExample } = require('../../model/appSpecExamples.ts')
const { AppSpecCanvas } = require('./AppSpecCanvas.tsx')

test('renders all app block kinds and distinct instances of the same kind', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  const html = renderToStaticMarkup(React.createElement(AppSpecCanvas, { runtime }))
  for (const [id, name] of [
    ['bookshelf', '我的书架'], ['reading-history', '阅读流水'],
    ['reading-form', '记录阅读'], ['reading-total', '累计分钟'],
  ]) {
    assert.match(html, new RegExp(`data-block-key="module:${id}"`))
    assert.match(html, new RegExp(name))
  }
  assert.match(html, /我的功能 · 4 块积木/)
})

// A small hook harness checks the host-to-canvas contract without a DOM dependency.
function mountHarness(runtime) {
  const values = []
  let cursor = 0
  let notifications = 0
  let unsubscribe
  const fakeReact = Object.create(React)
  fakeReact.useState = initial => {
    const index = cursor++
    if (!(index in values)) values[index] = initial
    return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
  }
  fakeReact.useSyncExternalStore = (subscribe, getSnapshot) => {
    if (!unsubscribe) unsubscribe = subscribe(() => notifications++)
    return getSnapshot()
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (parent?.filename?.endsWith('AppSpecCanvas.tsx')) {
      if (request === 'react') return fakeReact
      if (request === '../BlockCanvas') return { BlockCanvas: () => null, toAppCanvasModules: require('../blocks/app-canvas.ts').toAppCanvasModules }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  let Component
  try {
    delete require.cache[require.resolve('./AppSpecCanvas.tsx')]
    Component = require('./AppSpecCanvas.tsx').AppSpecCanvas
  } finally {
    Module._load = originalLoad
  }
  return {
    render() {
      cursor = 0
      const wrapper = Component({ runtime })
      return wrapper.props.children[0].props
    },
    renderTree() {
      cursor = 0
      return Component({ runtime })
    },
    notifications: () => notifications,
    unmount: () => unsubscribe(),
  }
}

test('selection, moves and external updates use instance IDs and the runtime snapshot', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  const harness = mountHarness(runtime)
  let canvas = harness.render()
  assert.deepEqual(canvas.modules.filter(module => module.kind === 'list').map(module => module.id), ['bookshelf', 'reading-history'])
  canvas.onSelectModule('reading-history')
  canvas = harness.render()
  assert.equal(canvas.selectedModuleId, 'reading-history')
  canvas.onSelectModule('bookshelf')
  assert.equal(harness.render().selectedModuleId, 'bookshelf')

  const move = runtime.moveBlock
  const calls = []
  runtime.moveBlock = (id, position) => { calls.push({ id, position }); return move(id, position) }
  const position = { x: 0.25, y: 0.35 }
  canvas.onMoveModule('bookshelf', position)
  assert.deepEqual(calls, [{ id: 'bookshelf', position }])
  assert.equal(harness.notifications(), 1)
  assert.deepEqual(harness.render().positions.bookshelf, position)

  assert.equal(move('reading-history', { x: 0.75, y: 0.65 }).ok, true)
  assert.equal(harness.notifications(), 2)
  assert.deepEqual(harness.render().positions['reading-history'], { x: 0.75, y: 0.65 })
  const revision = runtime.getSnapshot().revision
  assert.equal(runtime.executeCommand({
    requestId: 'add-second-metric',
    baseRevision: revision,
    commands: [{
      type: 'addBlock',
      block: { id: 'reading-average', name: '平均分钟', type: 'metric', aggregation: 'average', fieldId: 'minutes' },
      binding: { id: 'average-binding', type: 'dataBinding', blockId: 'reading-average', entityId: 'reading-sessions' },
    }],
  }).ok, true)
  assert.equal(harness.notifications(), 3)
  assert.ok(harness.render().modules.some(module => module.id === 'reading-average' && module.kind === 'metric'))
  harness.unmount()
  move('bookshelf', { x: 0.3, y: 0.4 })
  assert.equal(harness.notifications(), 3)
})

test('failed move displays the runtime error and leaves the snapshot unchanged', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  const harness = mountHarness(runtime)
  const before = runtime.getSnapshot()
  harness.render().onMoveModule('bookshelf', { x: -1, y: 0 })
  assert.strictEqual(runtime.getSnapshot(), before)
  assert.equal(harness.notifications(), 0)
  const alert = harness.renderTree().props.children[1]
  assert.equal(alert.props.role, 'alert')
  assert.equal(alert.props.children, 'Position outside [0,1]')
  assert.match(harness.renderTree().props.className, /has-move-error/)
  harness.renderTree().props.onPointerDownCapture()
  assert.equal(harness.renderTree().props.children[1], '')
  harness.render().onMoveModule('bookshelf', { x: 0.2, y: 0.3 })
  assert.equal(harness.renderTree().props.children[1], '')
  harness.unmount()
})
