// Run: node --test src/components/blocks/blocks.test.cjs
// Transpile in memory; do not change the project compiler or dependency setup.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
  }).outputText, filename)
}
require.extensions['.css'] = () => {}
const { BlockCanvas } = require('../BlockCanvas.tsx')
const { VISUAL_EXAMPLES } = require('./examples.ts')
const { combination, hasRelation } = require('./rules.ts')
const { arrangeScene, boardSize, collides, detachStack, findSnap, joinStacks, settleScene, stackFor, translateStack, CARD_HEIGHT, STACK_STEP } = require('./snap-layout.ts')

// Test-only oracle: inspect every pair, including members of the same stack.
// Centers and body dimensions match BlockCanvas; decorative studs/shadows are excluded.
function inspectScene(scene, expectedIds, board) {
  assert.equal(new Set(expectedIds).size, expectedIds.length, 'expected IDs must be unique')
  const actualIds = Object.keys(scene)
  assert.equal(actualIds.length, expectedIds.length, 'scene ID count')
  assert.deepEqual([...actualIds].sort(), [...expectedIds].sort(), 'scene ID set')
  assert.ok(Number.isFinite(board.cardWidth) && board.cardWidth > 0, 'finite positive card width')
  const rectangles = expectedIds.map((id) => {
    const point = scene[id]
    assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y), `finite coordinates: ${id}`)
    return { id, center: { ...point }, left: point.x - board.cardWidth / 2, right: point.x + board.cardWidth / 2,
      top: point.y - CARD_HEIGHT / 2, bottom: point.y + CARD_HEIGHT / 2 }
  })
  const bodyOverlaps = []
  const clearanceViolations = []
  for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
    const a = rectangles[i]
    const b = rectangles[j]
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    // Expanding each body by 2px gives the existing strict 4px clearance rule.
    // Zero body overlap is edge contact; zero expanded overlap is a legal 4px gap.
    const clearanceOverlapX = overlapX + 4
    const clearanceOverlapY = overlapY + 4
    const conflict = { ids: [a.id, b.id], rectangles: [a, b], overlapX, overlapY, clearanceOverlapX, clearanceOverlapY }
    if (overlapX > 0 && overlapY > 0) bodyOverlaps.push(conflict)
    if (clearanceOverlapX > 0 && clearanceOverlapY > 0) clearanceViolations.push(conflict)
  }
  return { bodyOverlaps, clearanceViolations }
}

function assertSceneLayout(scene, expectedIds, board) {
  const { bodyOverlaps, clearanceViolations } = inspectScene(scene, expectedIds, board)
  assert.equal(bodyOverlaps.length, 0, `body rectangle overlaps: ${JSON.stringify(bodyOverlaps)}`)
  assert.equal(clearanceViolations.length, 0, `4px clearance violations: ${JSON.stringify(clearanceViolations)}`)
}

// Inputs supplied by the future requirement generator, not a pretend generator.
const todo = { id: 'personal-todos', kind: 'tasks', name: '购物待办' }
const course = { id: 'semester-plan', kind: 'courses', name: '本学期课程' }
const studyTask = { id: 'course-homework', kind: 'tasks', name: '课后学习任务' }
const stats = { id: 'study-progress', kind: 'stats', name: '学习进度' }
const baseProps = { positions: {}, selectedModuleId: null, onSelectModule() {}, onMoveModule() {} }
const render = (modules, extra = {}) => renderToStaticMarkup(React.createElement(BlockCanvas, { ...baseProps, modules, ...extra }))

test('different supplied idea plans render one vs three named modules with arbitrary IDs', () => {
  const first = render([todo])
  const second = render([course, studyTask, stats])
  assert.match(first, /我的功能 · 1 块积木/)
  assert.match(first, /购物待办/)
  assert.doesNotMatch(first, /本学期课程/)
  assert.match(second, /我的功能 · 3 块积木/)
  for (const module of [course, studyTask, stats]) assert.ok(second.includes(module.name))
})

test('the workshop example set renders five readable bricks without changing module kinds', () => {
  const html = render([todo, course, stats], { examples: VISUAL_EXAMPLES })
  assert.match(html, /我的功能 · 5 块积木/)
  assert.match(html, /提醒通知/)
  assert.match(html, /学习目标/)
  assert.match(html, /展示积木 · 暂无业务功能/)
})

test('recipes normalize order and reject self, unsupported pairs and unavailable behavior', () => {
  assert.deepEqual(combination(studyTask, course, ['course-tasks']), { recipe: 'course-tasks', sourceId: course.id, targetId: studyTask.id })
  assert.deepEqual(combination(stats, studyTask, ['task-stats']), { recipe: 'task-stats', sourceId: studyTask.id, targetId: stats.id })
  assert.equal(combination(course, course, ['course-tasks']), null)
  assert.equal(combination(course, stats, ['course-tasks', 'task-stats']), null)
  assert.equal(combination(course, studyTask, []), null)
})

test('duplicate detection uses both endpoints and recipe', () => {
  const candidate = combination(course, studyTask, ['course-tasks'])
  const relations = [{ id: 'link-1', ...candidate }]
  assert.equal(hasRelation(relations, candidate), true)
  assert.equal(hasRelation(relations, { ...candidate, targetId: todo.id }), false)
  assert.equal(hasRelation([], candidate), false)
})

for (const { name, point, overlapX, overlapY, body, clearance } of [
  { name: 'complete overlap', point: { x: 300, y: 300 }, overlapX: 208, overlapY: 198, body: true, clearance: true },
  { name: 'partial overlap', point: { x: 400, y: 350 }, overlapX: 108, overlapY: 148, body: true, clearance: true },
  { name: 'normal separation', point: { x: 600, y: 300 }, overlapX: -92, overlapY: 198, body: false, clearance: false },
  { name: 'horizontal edge contact', point: { x: 508, y: 300 }, overlapX: 0, overlapY: 198, body: false, clearance: true },
  { name: 'vertical edge contact', point: { x: 300, y: 498 }, overlapX: 208, overlapY: 0, body: false, clearance: true },
  { name: 'horizontal 3px gap', point: { x: 511, y: 300 }, overlapX: -3, overlapY: 198, body: false, clearance: true },
  { name: 'horizontal 4px gap', point: { x: 512, y: 300 }, overlapX: -4, overlapY: 198, body: false, clearance: false },
]) {
  test(`independent scene assertions distinguish body overlap and clearance: ${name}`, () => {
    const board = boardSize(900, 2)
    const scene = { a: { x: 300, y: 300 }, b: point }
    const ids = ['a', 'b']
    const report = inspectScene(scene, ids, board)
    assert.equal(report.bodyOverlaps.length, Number(body))
    assert.equal(report.clearanceViolations.length, Number(clearance))
    if (clearance) {
      const conflict = report.clearanceViolations[0]
      assert.deepEqual(conflict.ids, ids)
      assert.equal(conflict.overlapX, overlapX)
      assert.equal(conflict.overlapY, overlapY)
      assert.equal(conflict.clearanceOverlapX, overlapX + 4)
      assert.equal(conflict.clearanceOverlapY, overlapY + 4)
      assert.throws(() => assertSceneLayout(scene, ids, board), (error) => {
        assert.equal(error.code, 'ERR_ASSERTION')
        assert.match(error.message, body ? /body rectangle overlaps/ : /4px clearance violations/)
        assert.ok(error.message.includes('"ids":["a","b"]'))
        return true
      })
    } else {
      assertSceneLayout(scene, ids, board)
    }
  })
}

test('independent scene assertions identify only the overlapping pair among three bricks', () => {
  const board = boardSize(900, 3)
  const scene = { a: { x: 300, y: 300 }, b: { x: 400, y: 350 }, c: { x: 740, y: 700 } }
  const report = inspectScene(scene, ['a', 'b', 'c'], board)
  assert.deepEqual(report.bodyOverlaps.map(({ ids }) => ids), [['a', 'b']])
  assert.deepEqual(report.clearanceViolations.map(({ ids }) => ids), [['a', 'b']])
  assert.throws(() => assertSceneLayout(scene, ['a', 'b', 'c'], board), /body rectangle overlaps/)
})

test('independent scene assertions reject missing, extra, replaced IDs and invalid coordinates', () => {
  const board = boardSize(900, 2)
  const a = { x: 300, y: 300 }
  const b = { x: 600, y: 300 }
  for (const [scene, ids, message] of [
    [{ a }, ['a', 'b'], /scene ID count/],
    [{ a, b }, ['a'], /scene ID count/],
    [{ a, c: b }, ['a', 'b'], /scene ID set/],
    [{ a, b }, ['a', 'a'], /expected IDs must be unique/],
    [{ a: { x: NaN, y: 300 } }, ['a'], /finite coordinates: a/],
    [{ a: { x: 300, y: Infinity } }, ['a'], /finite coordinates: a/],
    [{ a: { x: -Infinity, y: 300 } }, ['a'], /finite coordinates: a/],
    [{ a: { x: '300', y: 300 } }, ['a'], /finite coordinates: a/],
    [{ a: undefined }, ['a'], /finite coordinates: a/],
  ]) assert.throws(() => assertSceneLayout(scene, ids, board), message)
})

test('five bricks fit narrow, medium, and wide boards with clear spacing', () => {
  for (const width of [360, 700, 1180]) {
    const count = 5
    const ids = Array.from({ length: count }, (_, index) => `block-${index}`)
    const board = boardSize(width, count)
    const layout = arrangeScene(ids, board)
    assert.equal(Object.keys(layout).length, count)
    assert.ok(board.height >= count * STACK_STEP)
    assert.equal(collides(layout, ids, board), false)
    assertSceneLayout(layout, ids, board)
  }
})

test('nearby upper or lower edges produce a snap preview; distant edges do not', () => {
  const board = boardSize(900, 5)
  const scene = { a: { x: 450, y: 300 }, b: { x: 450, y: 520 }, c: { x: 780, y: 300 }, d: { x: 180, y: 700 }, e: { x: 780, y: 700 } }
  const preview = findSnap(scene, ['b'], [], board)
  assert.equal(preview?.direction, 'below')
  assert.equal(preview?.merged.join(','), 'a,b')
  assertSceneLayout(preview.scene, ['a', 'b', 'c', 'd', 'e'], board)
  assert.equal(findSnap({ ...scene, b: { x: 200, y: 400 } }, ['b'], [], board), null)
})

test('snapping joins a group, whole group moves without changing spacing, and detach makes separate bricks', () => {
  const board = boardSize(900, 5)
  const scene = { a: { x: 450, y: 300 }, b: { x: 450, y: 474 }, c: { x: 780, y: 300 }, d: { x: 180, y: 700 }, e: { x: 780, y: 700 } }
  const preview = findSnap({ ...scene, b: { x: 455, y: 473 } }, ['b'], [], board)
  assert.ok(preview)
  const stacks = joinStacks([], preview)
  assert.deepEqual(stackFor('a', stacks), ['a', 'b'])
  assert.equal(preview.scene.b.y - preview.scene.a.y, STACK_STEP)
  const ids = ['a', 'b', 'c', 'd', 'e']
  assertSceneLayout(preview.scene, ids, board)
  const moved = translateStack(preview.scene, ['a', 'b'], 70, 80, board)
  assert.equal(moved.b.x - moved.a.x, 0)
  assert.equal(moved.b.y - moved.a.y, STACK_STEP)
  assert.equal(collides(moved, ['a', 'b'], board), false)
  assertSceneLayout(moved, ids, board)
  const detached = detachStack(moved, 'a', stacks, board)
  assert.deepEqual(detached.stacks, [])
  assert.deepEqual(detached.scene.a, moved.a)
  assert.deepEqual(detached.scene.b, moved.b)
  assert.equal(collides(detached.scene, Object.keys(detached.scene), board), false)
  assertSceneLayout(detached.scene, ids, board)
})

test('arrange removes all stacks and restores five separate, collision-free bricks', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']
  const board = boardSize(1180, ids.length)
  const stacked = { a: { x: 500, y: 240 }, b: { x: 500, y: 414 }, c: { x: 800, y: 240 }, d: { x: 200, y: 650 }, e: { x: 800, y: 650 } }
  const reset = arrangeScene(ids, board)
  assert.equal(collides(reset, ids, board), false)
  assert.equal(Object.values(reset).length, 5)
  assert.deepEqual(settleScene(ids, reset, [], board), reset)
  assertSceneLayout(reset, ids, board)
  assertSceneLayout(settleScene(ids, reset, [], board), ids, board)
  // All IDs are moving, so the existing group-vs-outsiders check excludes every pair.
  assert.equal(collides(stacked, ids, board), false)
  const report = inspectScene(stacked, ids, board)
  assert.deepEqual(report.bodyOverlaps.map(({ ids }) => ids), [['a', 'b']])
  assert.deepEqual(report.clearanceViolations.map(({ ids }) => ids), [['a', 'b']])
  assert.equal(report.bodyOverlaps[0].overlapX, 208)
  assert.equal(report.bodyOverlaps[0].overlapY, 24)
  assert.throws(() => assertSceneLayout(stacked, ids, board), /body rectangle overlaps/)
})

test('an unsupported feature is explained rather than rendered as a usable brick', () => {
  const html = render([{ id: 'reminder', name: '上课提醒', kind: 'reminders' }])
  assert.match(html, /尚未提供可运行功能，未加入画布/)
  assert.match(html, /我的功能 · 0 块积木/)
  assert.doesNotMatch(html, /class="block-canvas__block /)
})

test('known kinds are also rejected when the connected preview does not advertise them', () => {
  const html = render([todo, course], {
    builder: { availableFeatures: ['tasks'], availableRecipes: [], relations: [], canUndo: false, onEdit() {}, onUndo() {} },
  })
  assert.match(html, /我的功能 · 1 块积木/)
  assert.match(html, /「本学期课程」尚未提供可运行功能/)
})

test('selection and saved relations come from external props; legacy mode does not claim new behavior', () => {
  assert.match(render([todo]), /添加、配置和组合功能尚未开放/)
  const html = render([studyTask, stats], {
    selectedModuleId: studyTask.id,
    builder: { availableFeatures: ['tasks', 'stats'], availableRecipes: ['task-stats'], relations: [{ id: 'rel-1', recipe: 'task-stats', sourceId: studyTask.id, targetId: stats.id }], canUndo: true, onEdit() {}, onUndo() {}, feedback: '组合已保存' },
  })
  assert.match(html, /is-selected/)
  assert.match(html, /搭在一起的功能 · 1/)
  assert.match(html, /组合已保存/)
  assert.match(html, /取消组合/)
})

const { toAppCanvasModules } = require('./app-canvas.ts')
const { createAppRuntime } = require('../../model/appRuntime.ts')
const { createReadingLogExample } = require('../../model/appSpecExamples.ts')
const appBuilder = { availableTypes: ['list', 'form', 'metric'], canUndo: false, onEdit() {}, onUndo() {} }

test('AppSpec canvas renders all three kinds and independent instances with stable IDs', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  const modules = toAppCanvasModules(runtime.getSnapshot())
  assert.equal(modules.filter(module => module.kind === 'list').length, 2)
  const html = render(modules, { appBuilder, selectedModuleId: 'bookshelf' })
  assert.match(html, /我的功能 · 4 块积木/)
  for (const module of modules) assert.ok(html.includes(`data-block-key="module:${module.id}"`))
  assert.match(html, /配置字段/)
  assert.match(html, /移除积木/)
  assert.doesNotMatch(html, /功能设置|组合功能|搭在一起的功能/)
  assert.match(html, /拼接只调整布局/)
  assert.equal(combination(modules[0], modules[1], ['course-tasks', 'task-stats']), null)
})

test('generic capability filtering, metric configure guard and feedback are explicit', () => {
  const modules = toAppCanvasModules(createReadingLogExample())
  const html = render(modules, { appBuilder: { ...appBuilder, availableTypes: ['metric'], feedback: '版本冲突，请重试' }, selectedModuleId: 'reading-total' })
  assert.match(html, /我的功能 · 1 块积木/)
  assert.match(html, /尚未提供可运行功能/)
  assert.match(html, /disabled="">配置字段/)
  assert.match(html, /版本冲突，请重试/)
  assert.doesNotMatch(html, /功能设置/)
  // No builder is needed for a controlled, read-only generic canvas.
  assert.match(render(modules), /我的功能 · 4 块积木/)
})

test('B module projection follows command add/remove/undo while C records stay intact', () => {
  const runtime = createAppRuntime(createReadingLogExample())
  const command = commands => runtime.executeCommand({ requestId: `edit-${runtime.getSnapshot().revision}`, baseRevision: runtime.getSnapshot().revision, commands })
  const records = runtime.getSnapshot().records
  assert.equal(command([{ type: 'addBlock', block: { id: 'second-bookshelf', type: 'list', name: '第二书架', fieldIds: ['book-title'] }, binding: { id: 'second-binding', type: 'dataBinding', blockId: 'second-bookshelf', entityId: 'books' } }]).ok, true)
  assert.match(render(toAppCanvasModules(runtime.getSnapshot()), { appBuilder }), /我的功能 · 5 块积木/)
  assert.equal(command([{ type: 'removeBlock', blockId: 'bookshelf' }]).ok, true)
  const html = render(toAppCanvasModules(runtime.getSnapshot()), { appBuilder })
  assert.doesNotMatch(html, /data-block-key="module:bookshelf"/)
  assert.match(html, /data-block-key="module:second-bookshelf"/)
  assert.equal(command([{ type: 'undo' }]).ok, true)
  assert.match(render(toAppCanvasModules(runtime.getSnapshot()), { appBuilder }), /data-block-key="module:bookshelf"/)
  assert.deepEqual(runtime.getSnapshot().records, records)
})
