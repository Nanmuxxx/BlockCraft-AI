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
const { createReadingLogExample, createClubRegistrationExample } = require('../../model/appSpecExamples.ts')
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

// The Inspector uses only local input hooks. Keep the real Runtime and invoke the
// controls' actual handlers, following the existing canvas harness style.
function inspectorHarness(getProps) {
  let values = []
  let cursor = 0
  let previousKey
  const fakeReact = Object.create(React)
  fakeReact.useState = initial => {
    const index = cursor++
    if (!(index in values)) values[index] = initial
    return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
  }
  const originalLoad = Module._load
  let Component
  Module._load = function (request, parent, isMain) {
    if (request === 'react' && parent?.filename?.endsWith('AppSpecInspector.tsx')) return fakeReact
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve('./AppSpecInspector.tsx')]
    Component = require('./AppSpecInspector.tsx').AppSpecInspector
  } finally { Module._load = originalLoad }
  const render = () => {
    const props = getProps()
    // AppSpecCanvas keys Inspector by selected instance, resetting only UI drafts.
    if (props.blockId !== previousKey) { values = []; previousKey = props.blockId }
    cursor = 0
    return Component(props)
  }
  const find = predicate => {
    const node = nodes(render()).find(predicate)
    assert.ok(node, 'expected Inspector control')
    return node
  }
  return {
    render,
    html: () => renderToStaticMarkup(render()),
    change(label, value) {
      const control = nodes(find(node => node.type === 'label' && nodes(node).some(child => child === label)))
        .find(node => ['input', 'select', 'textarea'].includes(node.type))
      assert.ok(control, `control: ${label}`)
      control.props.onChange({ currentTarget: { value, checked: value } })
    },
    toggle(name, checked) {
      find(node => node.type === 'input' && node.props['aria-label'] === `展示 ${name}`).props.onChange({ currentTarget: { checked } })
    },
    add() { find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }) },
  }
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (node === null || node === undefined || typeof node === 'boolean') return []
  return [node, ...(typeof node === 'object' ? nodes(node.props?.children) : [])]
}
function selectedInspector(runtime, blockId) {
  const canvas = mountHarness(runtime)
  if (blockId) canvas.render().onSelectModule(blockId)
  const inspector = inspectorHarness(() => canvas.renderTree().props.children[2].props)
  return { canvas, inspector }
}
function execute(runtime, commands, requestId = `external-${runtime.getSnapshot().revision}`) {
  return runtime.executeCommand({ requestId, baseRevision: runtime.getSnapshot().revision, commands })
}

test('Inspector empty state and selected form/list/metric display actual instance configuration', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  const { canvas, inspector } = selectedInspector(runtime)
  assert.match(inspector.html(), /请选择一块积木/)
  for (const [id, patterns] of [
    ['bookshelf', [/我的书架/, /list/, /书目/, /books/, /书名 · text · 必填/, /阅读状态 · select · 可选/]],
    ['reading-form', [/记录阅读/, /form/, /每日阅读/, /reading-sessions/, /日期 · date · 必填/]],
    ['reading-total', [/累计分钟/, /metric/, /聚合：sum/, /minutes/]],
  ]) {
    canvas.render().onSelectModule(id)
    const html = inspector.html()
    assert.match(html, new RegExp(id))
    for (const pattern of patterns) assert.match(html, pattern)
    assert.equal(html.includes('<fieldset>'), id !== 'reading-total')
  }
  canvas.unmount()
})

test('联系方式: add optional text, select in form, then list; preserve records, other blocks and layout', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  runtime.moveBlock('applicant-list', { x: 0.6, y: 0.7 })
  const before = structuredClone(runtime.getSnapshot())
  const requests = []
  const realExecute = runtime.executeCommand
  runtime.executeCommand = request => { requests.push(structuredClone(request)); return realExecute(request) }
  const { canvas, inspector } = selectedInspector(runtime, 'registration-form')
  inspector.add()
  const field = runtime.getSnapshot().spec.entities[0].fields.find(field => field.name === '联系方式')
  assert.deepEqual({ name: field.name, type: field.type, required: field.required }, { name: '联系方式', type: 'text', required: false })
  assert.match(inspector.html(), /实体字段已新增，请勾选/)
  assert.ok(!runtime.getSnapshot().spec.blocks[0].fieldIds.includes(field.id))
  inspector.toggle('联系方式', true)
  assert.equal(runtime.getSnapshot().spec.blocks[0].fieldIds.at(-1), field.id)
  assert.deepEqual(runtime.getSnapshot().spec.blocks[1], before.spec.blocks[1])
  canvas.render().onSelectModule('applicant-list')
  inspector.toggle('联系方式', true)
  assert.equal(runtime.getSnapshot().spec.blocks[1].fieldIds.at(-1), field.id)
  assert.deepEqual(runtime.getSnapshot().records, before.records)
  assert.deepEqual(runtime.getSnapshot().blockPositions, before.blockPositions)
  assert.deepEqual(runtime.getSnapshot().spec.relations, before.spec.relations)
  assert.deepEqual(runtime.getSnapshot().spec.blocks[2], before.spec.blocks[2])
  assert.deepEqual(requests.map(request => request.baseRevision), [1, 2, 3])
  assert.equal(new Set(requests.map(request => request.requestId)).size, 3)
  for (const request of requests) assert.match(request.requestId, /^[A-Za-z][A-Za-z0-9_-]{0,127}$/)
  assert.deepEqual(requests.map(request => request.commands[0].type), ['addField', 'configureBlockFields', 'configureBlockFields'])
  canvas.unmount()
})

test('select options reject empty/blank/duplicate entries and commit valid options through Runtime', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const { canvas, inspector } = selectedInspector(runtime, 'registration-form')
  inspector.change('字段名称', '联系偏好')
  inspector.change('字段类型', 'select')
  const before = runtime.getSnapshot()
  for (const invalid of ['', '邮件\n', '邮件\n  \n电话', '邮件\n邮件']) {
    inspector.change('选项（每行一个，不可为空或重复）', invalid)
    inspector.add()
    assert.strictEqual(runtime.getSnapshot(), before)
    assert.match(inspector.html(), /role="alert"/)
    assert.match(inspector.html(), /选项不能为空或重复/)
  }
  inspector.change('选项（每行一个，不可为空或重复）', ' 邮件\n电话 ')
  inspector.add()
  assert.deepEqual(runtime.getSnapshot().spec.entities[0].fields.at(-1).options, ['邮件', '电话'])
  assert.match(inspector.html(), /实体字段已新增/)
  assert.doesNotMatch(inspector.html(), /role="alert"/)
  canvas.unmount()
})

test('all scalar field types are accepted, and required flags reach schema validation', () => {
  for (const type of ['number', 'boolean', 'date']) {
    const runtime = createAppRuntime(createReadingLogExample())
    const { canvas, inspector } = selectedInspector(runtime, 'bookshelf')
    inspector.change('字段类型', type)
    inspector.add()
    assert.equal(runtime.getSnapshot().spec.entities[0].fields.at(-1).type, type)
    canvas.unmount()
  }
  const runtime = createAppRuntime(createClubRegistrationExample())
  const { canvas, inspector } = selectedInspector(runtime, 'registration-form')
  inspector.change('必填字段', true)
  const before = runtime.getSnapshot()
  inspector.add()
  assert.strictEqual(runtime.getSnapshot(), before)
  assert.match(inspector.html(), /role="alert"/)
  assert.match(inspector.html(), /VALIDATION: Form must expose all required fields/)
  assert.doesNotMatch(inspector.html(), /实体字段已新增/)
  canvas.unmount()
})

test('removing display fields preserves entity fields and records, respects required forms and nonempty lists', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const before = structuredClone(runtime.getSnapshot())
  const { canvas, inspector } = selectedInspector(runtime, 'registration-form')
  inspector.toggle('可参加面试', false)
  assert.deepEqual(runtime.getSnapshot().spec.blocks[0].fieldIds, ['applicant-name', 'department'])
  inspector.toggle('姓名', false)
  assert.match(inspector.html(), /表单必须展示全部必填字段/)
  assert.deepEqual(runtime.getSnapshot().spec.blocks[0].fieldIds, ['applicant-name', 'department'])
  canvas.render().onSelectModule('applicant-list')
  inspector.toggle('意向部门', false)
  const revision = runtime.getSnapshot().revision
  inspector.toggle('姓名', false)
  assert.equal(runtime.getSnapshot().revision, revision)
  assert.match(inspector.html(), /至少保留一个展示字段/)
  assert.deepEqual(runtime.getSnapshot().spec.entities, before.spec.entities)
  assert.deepEqual(runtime.getSnapshot().records, before.records)
  assert.deepEqual(runtime.getSnapshot().blockPositions, before.blockPositions)
  canvas.unmount()
})

test('same-kind blocks sharing one entity keep independent selections, configurations and input drafts', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  assert.equal(execute(runtime, [{ type: 'addBlock',
    block: { id: 'second-list', name: '第二名单', type: 'list', fieldIds: ['department'] },
    binding: { id: 'second-list-binding', type: 'dataBinding', blockId: 'second-list', entityId: 'applicants' },
  }]).ok, true)
  const { canvas, inspector } = selectedInspector(runtime, 'applicant-list')
  inspector.change('字段名称', '未提交草稿')
  inspector.toggle('可参加面试', true)
  assert.deepEqual(runtime.getSnapshot().spec.blocks.at(-1).fieldIds, ['department'])
  canvas.render().onSelectModule('second-list')
  assert.match(inspector.html(), /第二名单/)
  assert.doesNotMatch(inspector.html(), /未提交草稿/)
  const checks = nodes(inspector.render()).filter(node => node.type === 'input' && node.props['aria-label'])
  assert.deepEqual(checks.map(node => node.props.checked), [false, true, false])
  inspector.toggle('姓名', true)
  assert.deepEqual(runtime.getSnapshot().spec.blocks.at(-1).fieldIds, ['department', 'applicant-name'])
  assert.deepEqual(runtime.getSnapshot().spec.blocks[1].fieldIds, ['applicant-name', 'department', 'available'])
  canvas.render().onSelectModule('applicant-list')
  assert.match(inspector.html(), /报名名单/)
  assert.deepEqual(nodes(inspector.render()).filter(node => node.type === 'input' && node.props['aria-label']).map(node => node.props.checked), [true, true, true])
  canvas.unmount()
})

test('illegal commands and Runtime validation rejection show errors without publishing or false success', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const { canvas, inspector } = selectedInspector(runtime, 'registration-form')
  inspector.toggle('可参加面试', false)
  assert.match(inspector.html(), /展示字段已保存/)
  const before = runtime.getSnapshot()
  const realExecute = runtime.executeCommand
  runtime.executeCommand = request => realExecute({ ...request, commands: [{ type: 'eval' }] })
  inspector.toggle('可参加面试', true)
  assert.strictEqual(runtime.getSnapshot(), before)
  assert.match(inspector.html(), /VALIDATION: Unsupported command/)
  assert.doesNotMatch(inspector.html(), /展示字段已保存/)
  runtime.executeCommand = realExecute
  // Invalid programmatic input still encounters the real protocol validator.
  inspector.change('字段类型', 'script')
  inspector.add()
  assert.match(inspector.html(), /VALIDATION: Unsupported field type/)
  assert.strictEqual(runtime.getSnapshot(), before)
  canvas.unmount()
})

test('revision race reports conflict once; fresh user intent reads latest revision and configuration', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const { canvas, inspector } = selectedInspector(runtime, 'applicant-list')
  const realExecute = runtime.executeCommand
  let calls = 0
  runtime.executeCommand = request => {
    calls++
    runtime.moveBlock('applicant-list', { x: 0.6, y: 0.7 })
    return realExecute(request)
  }
  inspector.toggle('可参加面试', true)
  assert.equal(calls, 1, 'conflict must not blindly retry')
  assert.match(inspector.html(), /REVISION_CONFLICT: Stale baseRevision/)
  assert.doesNotMatch(inspector.html(), /展示字段已保存/)
  assert.deepEqual(runtime.getSnapshot().spec.blocks[1].fieldIds, ['applicant-name', 'department'])
  runtime.executeCommand = realExecute
  // Use a handler from before an external configuration update: payload must also be fresh.
  const staleHandler = nodes(inspector.render()).find(node => node.props?.['aria-label'] === '展示 可参加面试').props.onChange
  execute(runtime, [{ type: 'configureBlockFields', blockId: 'applicant-list', fieldIds: ['department'] }])
  staleHandler({ currentTarget: { checked: true } })
  assert.deepEqual(runtime.getSnapshot().spec.blocks[1].fieldIds, ['department', 'available'])
  assert.match(inspector.html(), /展示字段已保存/)
  assert.doesNotMatch(inspector.html(), /role="alert"/)
  canvas.unmount()
})

test('external commands refresh Inspector and canvas; deleting selected block invalidates selection', () => {
  const runtime = createAppRuntime(createClubRegistrationExample())
  const { canvas, inspector } = selectedInspector(runtime, 'applicant-list')
  const oldNotifications = canvas.notifications()
  execute(runtime, [{ type: 'addField', entityId: 'applicants', field: { id: 'external-contact', name: '外部联系方式', type: 'text', required: false } },
    { type: 'configureBlockFields', blockId: 'applicant-list', fieldIds: ['department', 'external-contact'] }])
  assert.equal(canvas.notifications(), oldNotifications + 1)
  assert.match(inspector.html(), /外部联系方式 · text · 可选/)
  assert.equal(nodes(inspector.render()).find(node => node.props?.['aria-label'] === '展示 外部联系方式').props.checked, true)
  execute(runtime, [{ type: 'removeBlock', blockId: 'applicant-list' }])
  assert.equal(canvas.render().selectedModuleId, null)
  assert.match(inspector.html(), /请选择一块积木/)
  assert.ok(!canvas.render().modules.some(module => module.id === 'applicant-list'))
  canvas.unmount()
})

test('missing or ambiguous bindings and missing entities display an explicit error without fallback', () => {
  const state = createClubRegistrationExample()
  for (const mutate of [
    state => { state.spec.relations = [] },
    state => { state.spec.entities = [] },
    state => { state.spec.relations.push({ ...state.spec.relations[0], id: 'duplicate-binding' }) },
  ]) {
    const invalid = structuredClone(state)
    mutate(invalid)
    // A real Runtime cannot hold invalid state; only this defensive display boundary needs a fixture.
    const inspector = inspectorHarness(() => ({ runtime: createAppRuntime(state), snapshot: invalid, blockId: 'registration-form' }))
    assert.match(inspector.html(), /role="alert"/)
    assert.match(inspector.html(), /绑定异常：/)
    assert.doesNotMatch(inspector.html(), /<form|<fieldset/)
  }
})

test('Phase 1 pointer lifecycle: collision and cancel never submit, valid dragging updates only target layout', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  const canvas = mountHarness(runtime)
  const values = []
  let cursor = 0
  const fakeReact = Object.create(React)
  fakeReact.useState = initial => {
    const index = cursor++
    if (!(index in values)) values[index] = initial
    return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
  }
  fakeReact.useRef = initial => {
    const index = cursor++
    if (!(index in values)) values[index] = { current: initial }
    return values[index]
  }
  fakeReact.useMemo = compute => compute()
  fakeReact.useEffect = () => {} // DOM resize/timers are outside this pointer transaction test.
  const originalLoad = Module._load
  let useSnapCanvas
  Module._load = function (request, parent, isMain) {
    if (request === 'react' && parent?.filename?.endsWith('useSnapCanvas.ts')) return fakeReact
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[require.resolve('../blocks/useSnapCanvas.ts')]
    useSnapCanvas = require('../blocks/useSnapCanvas.ts').useSnapCanvas
  } finally { Module._load = originalLoad }
  const moves = []
  function render() {
    cursor = 0
    const props = canvas.render()
    return useSnapCanvas({
      ids: props.modules.map(module => `module:${module.id}`),
      saved: Object.fromEntries(props.modules.map(module => [`module:${module.id}`, props.positions[module.id]])),
      localIds: [], disabled: false,
      onSelect: key => props.onSelectModule(key.replace('module:', '')),
      onMove: (key, position) => { moves.push(key); props.onMoveModule(key.replace('module:', ''), position) },
    })
  }
  let captured = false
  const currentTarget = {
    setPointerCapture() { captured = true },
    hasPointerCapture() { return captured },
    releasePointerCapture() { captured = false },
  }
  const event = point => ({ button: 0, pointerId: 1, clientX: point.x, clientY: point.y, currentTarget })
  const moving = 'module:reading-history'
  const initial = runtime.getSnapshot()
  let hook = render()
  let start = hook.scene[moving]
  const collision = hook.scene['module:bookshelf']
  hook.startDrag(event(start), moving)
  hook.updateDrag(event(collision))
  hook.finishDrag(event(collision))
  assert.equal(moves.length, 0)
  assert.strictEqual(runtime.getSnapshot(), initial)
  assert.match(render().message, /这里会挡住其他积木/)
  assert.equal(captured, false)

  hook = render()
  start = hook.scene[moving]
  const destination = { x: start.x - 50, y: start.y }
  hook.startDrag(event(start), moving)
  hook.updateDrag(event(destination))
  hook.finishDrag(event(destination), true)
  assert.equal(moves.length, 0)
  assert.strictEqual(runtime.getSnapshot(), initial)
  assert.equal(captured, false)

  hook = render()
  hook.startDrag(event(start), moving)
  hook.updateDrag(event(destination))
  hook.finishDrag(event(destination))
  assert.deepEqual(moves, [moving])
  assert.equal(runtime.getSnapshot().revision, initial.revision + 1)
  assert.deepEqual(runtime.getSnapshot().blockPositions['reading-history'], { x: destination.x / hook.board.width, y: destination.y / hook.board.height })
  assert.deepEqual(runtime.getSnapshot().records, initial.records)
  assert.deepEqual(runtime.getSnapshot().spec, initial.spec)
  assert.equal(canvas.render().selectedModuleId, 'reading-history')
  assert.equal(captured, false)
  canvas.unmount()
})
