import type { JsonValue, ObjectSchema, RestrictedSchema } from './types'
import { assertJson, check, id, keys, object } from './json'

export const SCHEMA_LIMITS = Object.freeze({ maxDepth: 8, maxNodes: 256, maxProperties: 32, maxEnum: 32, maxStringLength: 4096 })
/** Deliberately smaller than JSON Schema. Unknown vocabulary fails closed. No defaults. */
export function assertRestrictedSchema(input: unknown): asserts input is RestrictedSchema {
  assertJson(input)
  let nodes = 0
  function visit(s: unknown, depth: number) {
    check(++nodes <= SCHEMA_LIMITS.maxNodes && depth <= SCHEMA_LIMITS.maxDepth, 'Schema complexity limit', 'LIMIT')
    object(s)
    if (s.type === 'object') {
      keys(s, ['type', 'properties', 'required', 'additionalProperties'], ['title'])
      check(s.additionalProperties === false, 'Objects must reject additional properties')
      object(s.properties)
      const names = Object.keys(s.properties)
      check(names.length <= SCHEMA_LIMITS.maxProperties, 'Schema property limit', 'LIMIT')
      names.forEach(id)
      check(Array.isArray(s.required) && s.required.length <= names.length, 'Invalid required list')
      check(new Set(s.required).size === s.required.length, 'Duplicate required property')
      s.required.forEach(key => { id(key); check(names.includes(key), 'Unknown required property') })
      Object.values(s.properties).forEach(child => visit(child, depth + 1))
    } else {
      check(['string', 'number', 'integer', 'boolean'].includes(s.type as string), 'Unsupported Schema type')
      if (s.type === 'string') {
        keys(s, ['type', 'maxLength'], ['title', 'minLength', 'enum'])
        check(Number.isSafeInteger(s.maxLength) && (s.maxLength as number) >= 0 && (s.maxLength as number) <= SCHEMA_LIMITS.maxStringLength, 'Invalid maxLength')
        if (s.minLength !== undefined) check(Number.isSafeInteger(s.minLength) && (s.minLength as number) >= 0 && (s.minLength as number) <= (s.maxLength as number), 'Invalid minLength')
      } else if (s.type === 'boolean') keys(s, ['type'], ['title', 'enum'])
      else {
        keys(s, ['type'], ['title', 'minimum', 'maximum', 'enum'])
        for (const key of ['minimum', 'maximum']) if (s[key] !== undefined) check(typeof s[key] === 'number' && Number.isFinite(s[key]) && (s.type !== 'integer' || Number.isSafeInteger(s[key])), 'Invalid numeric bound')
        if (s.minimum !== undefined && s.maximum !== undefined) check((s.minimum as number) <= (s.maximum as number), 'Inverted bounds')
      }
      if (s.enum !== undefined) {
        check(Array.isArray(s.enum) && s.enum.length > 0 && s.enum.length <= SCHEMA_LIMITS.maxEnum, 'Invalid enum')
        check(new Set(s.enum).size === s.enum.length, 'Duplicate enum value')
        for (const value of s.enum) checkScalar(s as RestrictedSchema, value)
      }
    }
    if (s.title !== undefined) check(typeof s.title === 'string' && s.title.trim().length > 0 && s.title.length <= 120, 'Invalid title')
  }
  visit(input, 0)
}
function checkScalar(s: RestrictedSchema, value: unknown) {
  switch (s.type) {
    case 'string': check(typeof value === 'string' && value.length <= s.maxLength && value.length >= (s.minLength ?? 0), 'Invalid Schema string'); break
    case 'boolean': check(typeof value === 'boolean', 'Invalid Schema boolean'); break
    case 'number': case 'integer':
      check(typeof value === 'number' && Number.isFinite(value), 'Invalid Schema number')
      if (s.type === 'integer') check(Number.isSafeInteger(value), 'Invalid Schema integer')
      if (s.minimum !== undefined) check(value >= s.minimum, 'Below minimum')
      if (s.maximum !== undefined) check(value <= s.maximum, 'Above maximum')
      break
    default: check(false, 'Expected scalar Schema')
  }
}
export function assertObjectSchema(input: unknown): asserts input is ObjectSchema {
  assertRestrictedSchema(input); check(input.type === 'object', 'Root must be object Schema')
}
/** Pure validation only. Never coerce, remove unknown fields or insert defaults. */
export function assertSchemaValue(schema: RestrictedSchema, value: unknown): asserts value is JsonValue {
  assertRestrictedSchema(schema); assertJson(value)
  function visit(s: RestrictedSchema, v: unknown) {
    if (s.type === 'object') {
      object(v); keys(v, s.required, Object.keys(s.properties))
      for (const [key, item] of Object.entries(v)) visit(s.properties[key], item)
    } else {
      checkScalar(s, v)
      if (s.enum) check((s.enum as unknown[]).includes(v), 'Value outside enum')
    }
  }
  visit(schema, value)
}
