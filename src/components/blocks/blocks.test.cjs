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
const { arrangeScene, boardSize, collides, detachStack, findSnap, joinStacks, settleScene, stackFor, translateStack, STACK_STEP } = require('./snap-layout.ts')

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

test('five bricks fit narrow, medium, and wide boards with clear spacing', () => {
  for (const width of [360, 700, 1180]) {
    const count = 5
    const ids = Array.from({ length: count }, (_, index) => `block-${index}`)
    const board = boardSize(width, count)
    const layout = arrangeScene(ids, board)
    assert.equal(Object.keys(layout).length, count)
    assert.ok(board.height >= count * STACK_STEP)
    assert.equal(collides(layout, ids, board), false)
  }
})

test('nearby upper or lower edges produce a snap preview; distant edges do not', () => {
  const board = boardSize(900, 5)
  const scene = { a: { x: 450, y: 300 }, b: { x: 450, y: 520 }, c: { x: 780, y: 300 }, d: { x: 180, y: 700 }, e: { x: 780, y: 700 } }
  const preview = findSnap(scene, ['b'], [], board)
  assert.equal(preview?.direction, 'below')
  assert.equal(preview?.merged.join(','), 'a,b')
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
  const moved = translateStack(preview.scene, ['a', 'b'], 70, 80, board)
  assert.equal(moved.b.x - moved.a.x, 0)
  assert.equal(moved.b.y - moved.a.y, STACK_STEP)
  assert.equal(collides(moved, ['a', 'b'], board), false)
  const detached = detachStack(moved, 'a', stacks, board)
  assert.deepEqual(detached.stacks, [])
  assert.deepEqual(detached.scene.a, moved.a)
  assert.deepEqual(detached.scene.b, moved.b)
  assert.equal(collides(detached.scene, Object.keys(detached.scene), board), false)
})

test('arrange removes all stacks and restores five separate, collision-free bricks', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']
  const board = boardSize(1180, ids.length)
  const stacked = { a: { x: 500, y: 240 }, b: { x: 500, y: 414 }, c: { x: 800, y: 240 }, d: { x: 200, y: 650 }, e: { x: 800, y: 650 } }
  const reset = arrangeScene(ids, board)
  assert.equal(collides(reset, ids, board), false)
  assert.equal(Object.values(reset).length, 5)
  assert.deepEqual(settleScene(ids, reset, [], board), reset)
  assert.equal(collides(stacked, ids, board), false)
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
