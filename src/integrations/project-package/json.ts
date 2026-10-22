import { assertProjectJson, CustomBlockError, JSON_LIMITS } from '../../custom-block/json'
import { ProjectPackageError } from './errors'

/** Bounded JSON admission shared by ZIP, legacy files and local backups. */
export function parsePackageJsonText(text: string): unknown {
  const invalid = (): never => { throw new ProjectPackageError('PACKAGE_INVALID') }
  const limit = (condition: boolean) => { if (!condition) throw new ProjectPackageError('PACKAGE_LIMIT') }
  // Bound work before parsing or allocating a second representation.
  limit(text.length <= JSON_LIMITS.maxBytes)
  limit(new TextEncoder().encode(text).byteLength <= JSON_LIMITS.maxBytes)
  let index = 0, nodes = 0
  const primitive = /(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/y
  const space = () => { while (index < text.length && /[\t\n\r ]/.test(text[index])) index++ }
  const string = (): string => {
    const start = index++
    while (index < text.length) {
      const char = text.charCodeAt(index++)
      if (char === 34) {
        try { return JSON.parse(text.slice(start, index)) as string } catch { return invalid() }
      }
      if (char < 32) invalid()
      if (char === 92) {
        const escape = text[index++]
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(index, index + 4))) invalid()
          index += 4
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) invalid()
      }
    }
    return invalid()
  }
  const value = (depth: number): void => {
    limit(++nodes <= JSON_LIMITS.maxNodes && depth <= JSON_LIMITS.maxDepth)
    space()
    const char = text[index]
    if (char === '"') { string(); return }
    if (char === '{' || char === '[') {
      const isObject = char === '{', end = isObject ? '}' : ']'
      const seen = new Set<string>()
      let count = 0
      index++; space()
      if (text[index] === end) { index++; return }
      while (index < text.length) {
        limit(++count <= (isObject ? JSON_LIMITS.maxKeys : JSON_LIMITS.maxArrayLength))
        if (isObject) {
          if (text[index] !== '"') invalid()
          const key = string()
          if (seen.has(key)) invalid()
          seen.add(key); space()
          if (text[index++] !== ':') invalid()
        }
        value(depth + 1); space()
        if (text[index] === end) { index++; return }
        if (text[index++] !== ',') invalid()
        space()
      }
      invalid()
    }
    primitive.lastIndex = index
    const match = primitive.exec(text)
    if (!match) invalid()
    index += match![0].length
  }
  value(0); space()
  if (index !== text.length) invalid()
  try {
    const result: unknown = JSON.parse(text)
    assertProjectJson(result)
    return result
  } catch (error) {
    if (error instanceof CustomBlockError && error.code === 'LIMIT') throw new ProjectPackageError('PACKAGE_LIMIT')
    throw new ProjectPackageError('PACKAGE_INVALID')
  }
}
