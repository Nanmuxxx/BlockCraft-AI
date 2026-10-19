import type { CSSProperties } from 'react'
import type { BlockPresentation } from '../../model/appSpec'

// Display projection of PR #49's schema, never a write/authorization boundary.
// Read data descriptors so malformed external objects cannot execute getters.
function data(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}
export function readBlockPresentation(block: unknown): BlockPresentation {
  const raw = data(block, 'presentation')
  const result: BlockPresentation = {}
  const text = data(raw, 'buttonText')
  if (data(block, 'type') === 'form' && typeof text === 'string' && text.trim() && text.length <= 120) result.buttonText = text
  for (const key of ['backgroundColor', 'textColor'] as const) {
    const value = data(raw, key)
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) result[key] = value
  }
  const radius = data(raw, 'borderRadius')
  if (typeof radius === 'number' && Number.isInteger(radius) && radius >= 0 && radius <= 32) result.borderRadius = radius
  return result
}
export function blockCardStyle(presentation: BlockPresentation): CSSProperties {
  return {
    ...(presentation.backgroundColor === undefined ? {} : { backgroundColor: presentation.backgroundColor }),
    ...(presentation.textColor === undefined ? {} : { color: presentation.textColor }),
    ...(presentation.borderRadius === undefined ? {} : { borderRadius: presentation.borderRadius }),
  }
}
