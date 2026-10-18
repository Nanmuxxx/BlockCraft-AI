import type { JsonValue } from './types'

export class CustomBlockError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'CustomBlockError' }
}
export function check(condition: unknown, message: string, code = 'VALIDATION'): asserts condition {
  if (!condition) throw new CustomBlockError(code, message)
}
export const JSON_LIMITS = Object.freeze({ maxDepth: 32, maxNodes: 100_000, maxKeys: 2048, maxArrayLength: 10_000, maxStringLength: 262_144, maxTextLength: 2_000_000, maxBytes: 4_000_000 })
export const MESSAGE_LIMITS = Object.freeze({ maxDepth: 12, maxNodes: 2048, maxKeys: 64, maxArrayLength: 128, maxStringLength: 4096, maxTextLength: 16_384, maxBytes: 32_768 })
export type JsonLimits = { [K in keyof typeof JSON_LIMITS]: number }
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
export function safeKey(key: string) { check(!forbidden.has(key), 'Forbidden property name') }

/** Data descriptors only. No property reads/toJSON before inspection; never coerce input. */
export function assertJson(value: unknown, limits: JsonLimits = JSON_LIMITS): asserts value is JsonValue {
  let nodes = 0, textLength = 0
  const ancestors = new Set<object>()
  const text = (s: string) => {
    check(s.length <= limits.maxStringLength, 'JSON string limit', 'LIMIT')
    textLength += s.length
    check(textLength <= limits.maxTextLength, 'JSON aggregate text limit', 'LIMIT')
  }
  const visit = (v: unknown, depth: number) => {
    check(++nodes <= limits.maxNodes && depth <= limits.maxDepth, 'JSON node/depth limit', 'LIMIT')
    if (v === null || typeof v === 'boolean') return
    if (typeof v === 'string') { text(v); return }
    if (typeof v === 'number') { check(Number.isFinite(v), 'Non-finite JSON number'); return }
    check(typeof v === 'object', 'Non-JSON value')
    check(!ancestors.has(v), 'Cyclic JSON')
    const array = Array.isArray(v)
    check(Object.getPrototypeOf(v) === (array ? Array.prototype : Object.prototype) || (!array && Object.getPrototypeOf(v) === null), 'Non-plain JSON value')
    const ownKeys = Reflect.ownKeys(v)
    if (array) check(v.length <= limits.maxArrayLength && ownKeys.length === v.length + 1, 'Sparse/extended/oversized array', 'LIMIT')
    else check(ownKeys.length <= limits.maxKeys, 'JSON property count limit', 'LIMIT')
    ancestors.add(v)
    for (const key of ownKeys) {
      check(typeof key === 'string', 'Symbol JSON property')
      if (array && key === 'length') continue
      safeKey(key); text(key)
      if (array) check(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < v.length, 'Invalid array key')
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!
      check('value' in descriptor && descriptor.enumerable, 'Accessor/hidden JSON property')
      visit(descriptor.value, depth + 1)
    }
    ancestors.delete(v)
  }
  visit(value, 0)
  check(new TextEncoder().encode(JSON.stringify(value)).byteLength <= limits.maxBytes, 'JSON byte limit', 'LIMIT')
}
export function object(value: unknown): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object')
}
export function keys(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  check(required.every(key => Object.prototype.hasOwnProperty.call(value, key)), 'Missing property')
  check(Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'Unknown property')
}
export function id(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value), 'Invalid ID')
  safeKey(value)
}
export function revision(value: unknown) { check(Number.isSafeInteger(value) && (value as number) >= 0, 'Invalid revision/sequence') }
export function digest(value: unknown): asserts value is `sha256:${string}` { check(typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value), 'Invalid SHA-256 reference') }
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => cloneJson(item)) as T
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)])) as T
  return value
}
/** v1 of canonical encoding: sorted UTF-16 keys, JSON scalar encoding, array order retained. */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}
