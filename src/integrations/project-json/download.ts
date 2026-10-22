export function downloadProjectJson(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.rel = 'noopener'
  document.body.append(anchor)
  try { anchor.click() }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
