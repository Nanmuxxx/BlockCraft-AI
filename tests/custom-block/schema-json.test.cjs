const test = require('node:test')
const assert = require('node:assert/strict')
const { api, objectSchema } = require('./fixtures.cjs')

test('restricted schema validates scalars/nesting/optional fields without mutation or coercion', () => {
  const schema = objectSchema({
    title: { type: 'string', title: '标题', minLength: 1, maxLength: 10, enum: ['中文', 'hello'] },
    enabled: { type: 'boolean', enum: [true, false] },
    count: { type: 'integer', minimum: 0, maximum: 2 },
    ratio: { type: 'number', minimum: .1, maximum: .9 },
    nested: objectSchema({ optional: { type: 'string', maxLength: 0 } }),
  })
  schema.properties.nested.required = []
  const value = { title: '中文', enabled: true, count: 0, ratio: .5, nested: {} }
  const before = JSON.stringify({ schema, value })
  api.assertObjectSchema(schema); api.assertSchemaValue(schema, value)
  assert.equal(JSON.stringify({ schema, value }), before)
  for (const invalid of [ { ...value, count: '0' }, { ...value, count: 1.5 }, { ...value, ratio: NaN }, { ...value, extra: 1 }, { ...value, title: 'no' }, { ...value, nested: { extra: true } }, { ...value, enabled: null } ]) assert.throws(() => api.assertSchemaValue(schema, invalid))
})
const badSchemas = [
  null, {}, { type: 'array' }, { type: 'null' }, { type: 'function' }, { type: 'string' },
  { type: 'string', maxLength: -1 }, { type: 'string', maxLength: 4097 }, { type: 'string', maxLength: 4, minLength: 5 },
  { type: 'string', maxLength: 4, enum: [] }, { type: 'string', maxLength: 4, enum: ['a', 'a'] }, { type: 'string', maxLength: 4, enum: [1] },
  { type: 'integer', minimum: .5 }, { type: 'number', minimum: 2, maximum: 1 }, { type: 'number', maximum: Infinity },
  { type: 'boolean', enum: ['true'] }, { type: 'boolean', title: '' }, { type: 'boolean', minimum: 0 },
  { ...objectSchema({}), additionalProperties: true }, { ...objectSchema({}), additionalProperties: { type: 'boolean' } },
  { ...objectSchema({}), required: ['unknown'] }, { ...objectSchema({ a: { type: 'boolean' } }), required: ['a', 'a'] },
]
for (const key of ['$ref', '$schema', 'default', 'oneOf', 'anyOf', 'pattern', 'format', 'validate', 'unknown']) badSchemas.push({ type: 'string', maxLength: 4, [key]: 'unsupported' })
for (const [index, schema] of badSchemas.entries()) test(`Schema rejects unsupported/malformed vocabulary ${index + 1}`, () => assert.throws(() => api.assertRestrictedSchema(schema)))
test('Schema property/enum/string/depth/node limits accept boundary and reject overflow', () => {
  const props = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`f${i}`, { type: 'boolean' }]))
  api.assertObjectSchema(objectSchema(props))
  assert.throws(() => api.assertObjectSchema(objectSchema({ ...props, overflow: { type: 'boolean' } })))
  const s = { type: 'string', maxLength: 4096, enum: Array.from({ length: 32 }, (_, i) => String(i)) }
  api.assertRestrictedSchema(s); api.assertSchemaValue({ type: 'string', maxLength: 4096 }, 'x'.repeat(4096))
  s.enum.push('overflow'); assert.throws(() => api.assertRestrictedSchema(s))
  assert.throws(() => api.assertSchemaValue({ type: 'string', maxLength: 4096 }, 'x'.repeat(4097)))
  let deep = { type: 'boolean' }
  for (let i = 0; i < 8; i++) deep = objectSchema({ child: deep })
  api.assertRestrictedSchema(deep)
  assert.throws(() => api.assertRestrictedSchema(objectSchema({ child: deep })))
  // Root + 8 branches + 247 leaves = 256 Schema nodes.
  const branch = count => objectSchema(Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, { type: 'boolean' }])))
  const tree = objectSchema(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`b${i}`, branch(i === 7 ? 30 : 31)])))
  api.assertRestrictedSchema(tree)
  tree.properties.b7.properties.overflow = { type: 'boolean' }
  assert.throws(() => api.assertRestrictedSchema(tree), { code: 'LIMIT' })
})
test('JSON accepts finite plain data and rejects values JSON.stringify would silently change', () => {
  api.assertJson({ text: '中文😀', bool: true, zero: -0, null: null, array: [1, false, {}] })
  const cycle = {}; cycle.self = cycle
  const hidden = {}; Object.defineProperty(hidden, 'x', { value: 1 })
  const extended = [1]; extended.extra = 1
  const symbol = { [Symbol('hidden')]: 1 }
  for (const invalid of [undefined, () => 1, 1n, Symbol(), NaN, Infinity, -Infinity, new Date(), new Map(), new Set(), /a/, new Number(1), new Uint8Array(2), cycle, hidden, extended, symbol, Array(2), [undefined], { a: undefined }, Object.create({ inherited: 1 }), JSON.parse('{"__proto__":{}}'), { constructor: 1 }, { prototype: 1 }]) assert.throws(() => api.assertJson(invalid))
  let calls = 0
  const getter = {}; Object.defineProperty(getter, 'value', { enumerable: true, get() { calls++; throw Error('read') } })
  const toJSON = { toJSON() { calls++; return {} } }
  assert.throws(() => api.assertJson(getter)); assert.throws(() => api.assertJson(toJSON)); assert.equal(calls, 0)
})
test('all JSON budget dimensions are inclusive and independent', () => {
  const withLimit = (key, limit, pass, fail) => {
    const limits = { ...api.JSON_LIMITS, [key]: limit }
    api.assertJson(pass, limits); assert.throws(() => api.assertJson(fail, limits), { code: 'LIMIT' })
  }
  withLimit('maxDepth', 2, [[0]], [[[0]]])
  withLimit('maxNodes', 3, [0, 1], [0, 1, 2])
  withLimit('maxKeys', 2, { a: 0, b: 0 }, { a: 0, b: 0, c: 0 })
  withLimit('maxArrayLength', 2, [0, 1], [0, 1, 2])
  withLimit('maxStringLength', 2, '😀', '😀a')
  withLimit('maxTextLength', 4, { a: '123' }, { a: '1234' })
  withLimit('maxBytes', 6, 'éé', 'ééa')
})
test('production JSON boundaries constrain broad, deep and multibyte inputs', () => {
  let atDepth = 0
  for (let i = 0; i < api.JSON_LIMITS.maxDepth; i++) atDepth = [atDepth]
  api.assertJson(atDepth); assert.throws(() => api.assertJson([atDepth]), { code: 'LIMIT' })
  api.assertJson('x'.repeat(api.JSON_LIMITS.maxStringLength))
  assert.throws(() => api.assertJson('x'.repeat(api.JSON_LIMITS.maxStringLength + 1)), { code: 'LIMIT' })
  api.assertJson(Array(api.JSON_LIMITS.maxArrayLength).fill(0))
  assert.throws(() => api.assertJson(Array(api.JSON_LIMITS.maxArrayLength + 1).fill(0)), { code: 'LIMIT' })
  const broad = Object.fromEntries(Array.from({ length: api.JSON_LIMITS.maxKeys }, (_, i) => [`k${i}`, 0]))
  api.assertJson(broad); broad.overflow = 0; assert.throws(() => api.assertJson(broad), { code: 'LIMIT' })
})

test('project JSON permits large asset data only at three exact paths and preserves descriptor and aggregate limits', () => {
  const dataUrl = 'x'.repeat(699_100)
  for (const value of [
    { assets: { photo: { dataUrl } } },
    { base: { assets: { photo: { dataUrl } } } },
    { project: { base: { assets: { photo: { dataUrl } } } } },
  ]) {
    api.assertProjectJson(value)
    assert.throws(() => api.assertJson(value), { code: 'LIMIT' })
  }
  for (const value of [
    { dataUrl }, { custom: { assets: { photo: { dataUrl } } } },
    { project: { assets: { photo: { dataUrl } } } },
    { assets: { photo: { name: dataUrl } } },
    { sources: { 'main.tsx': dataUrl } },
    { assets: { photo: { dataUrl: `${dataUrl}x` } } },
    { assets: { one: { dataUrl }, two: { dataUrl }, three: { dataUrl } } },
  ]) assert.throws(() => api.assertProjectJson(value), { code: 'LIMIT' })
  let calls = 0
  const photo = {}; Object.defineProperty(photo, 'dataUrl', { enumerable: true, get() { calls++; return dataUrl } })
  assert.throws(() => api.assertProjectJson({ assets: { photo } }), /Accessor/)
  assert.equal(calls, 0)
})
