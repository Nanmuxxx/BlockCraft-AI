import { ProjectPackageError } from './errors'

// Call only after the existing bounded, data-descriptor JSON admission pass.
const credentialKey = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|authorization|password|passwd|client[_-]?secret|private[_-]?key|secret|token)$/i
const tokenValue = /(?:\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[A-Z0-9]{16})\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----)/
const assignment = /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|secret|token|password|authorization)\s*["']?\s*\]?\s*(?::\s*(?:string\s*=\s*)?|=\s*)["'`]([^"'`\r\n]+)["'`]/i
const secretQuery = /^(?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|auth|authorization|signature|sig|x-(?:amz|goog)-(?:credential|signature|security-token)|awsaccesskeyid|googleaccessid|sharedaccesssignature)$/i

function fail(): never { throw new ProjectPackageError('PACKAGE_SECRET', '项目可能包含凭据，请移除敏感内容后重试。') }

function inspectText(text: string) {
  // Never run text URL heuristics over base64. Scan the decoded raster instead,
  // including legacy JSON image metadata. The admission pass bounds this input.
  const image = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/]*={0,2})$/.exec(text)
  if (image && image[1].length <= 699_052) {
    let bytes: Uint8Array
    try { bytes = Uint8Array.from(atob(image[1]), char => char.charCodeAt(0)) } catch { return }
    assertNoResourceSecrets(bytes)
    return
  }
  if (tokenValue.test(text) || assignment.test(text)) fail()
  // URLs can appear inside text or source files. Percent-encoded query names are decoded by URL.
  // Scheme length is bounded: an unbounded scheme regex retries quadratically
  // over long ordinary text/base64 that contains no colon.
  for (const match of text.matchAll(/(?:\b[a-z][a-z0-9+.-]{0,31}:\/\/|\/\/)[^\s<>"'`]+/gi)) {
    let url: URL
    try { url = new URL(match[0], 'https://project.invalid') } catch { continue }
    if (url.username || url.password) fail()
    for (const [key] of url.searchParams) if (secretQuery.test(key)) fail()
  }
}

export function assertNoPackageSecrets(value: unknown): void {
  const visit = (item: unknown) => {
    if (typeof item === 'string') { inspectText(item); return }
    if (item === null || typeof item !== 'object') return
    for (const [key, child] of Object.entries(item)) {
      if (credentialKey.test(key)) fail()
      inspectText(key)
      visit(child)
    }
  }
  visit(value)
}

/** Also reject readable credentials hidden in raster metadata/trailing bytes. */
export function assertNoResourceSecrets(bytes: Uint8Array): void {
  // TextDecoder preserves ASCII credentials in otherwise binary image content.
  inspectText(new TextDecoder().decode(bytes))
  // UTF-16 image metadata can carry text as well. Bounded by the resource limit.
  if (bytes.byteLength >= 2) {
    inspectText(new TextDecoder('utf-16le').decode(bytes))
    inspectText(new TextDecoder('utf-16be').decode(bytes))
  }
}
