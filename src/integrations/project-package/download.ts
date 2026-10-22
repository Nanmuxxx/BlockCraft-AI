export function downloadProjectPackage(bytes: Uint8Array): void {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'application/zip' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'blockcraft-project.zip'; anchor.rel = 'noopener'
  document.body.append(anchor)
  try { anchor.click() }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
