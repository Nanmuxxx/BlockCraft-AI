const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename)
const { landing, route, safe } = require('../../src/components/mochi-ai/motion/geometry.ts')

test('narrow mobile gutter stays adjacent and follows scroll without grid jumps', () => {
  const bounds = { x: 25, y: 8, width: 340, height: 884 }
  const block = { x: 91, y: 350, width: 208, height: 198 }
  const before = landing(block, bounds, [block])
  assert.ok(safe(before, bounds, [block]))
  const shifted = { ...block, y: block.y - 85 }
  const after = landing(shifted, bounds, [shifted], before.side)
  assert.equal(after.x, before.x)
  assert.equal(after.y, before.y - 85)
})

test('route carries the whole hitbox around controls in a narrow gutter', () => {
  const bounds = { x: 25, y: 8, width: 340, height: 884 }
  const obstacle = { x: 91, y: 127, width: 208, height: 198 }
  const path = route({ x: 166, y: 47 }, { x: 25, y: 400 }, bounds, [obstacle])
  assert.ok(path && path.length > 2)
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i]
    for (let t = 0; t <= 1; t += .005) {
      assert.ok(safe({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, bounds, [obstacle]))
    }
  }
})

test('blocked or undersized surfaces have no landing or route through content', () => {
  const bounds = { x: 0, y: 0, width: 400, height: 300 }
  const wall = { x: 180, y: 0, width: 40, height: 300 }
  assert.equal(route({ x: 10, y: 100 }, { x: 300, y: 100 }, bounds, [wall]), null)
  assert.equal(landing(wall, bounds, [bounds]), null)
  assert.equal(landing(wall, { x: 0, y: 0, width: 30, height: 30 }, []), null)
})
