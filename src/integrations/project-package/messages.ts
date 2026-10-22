const messages: Record<string, string> = {
  PACKAGE_INVALID: '项目包结构无效或文件已损坏。',
  PACKAGE_VERSION: '项目包格式或版本不受支持。',
  PACKAGE_LIMIT: '项目包或资源大小、数量超过上限。',
  PACKAGE_PATH: '项目包含有非法路径或不允许的文件。',
  PACKAGE_UNSUPPORTED: '项目包使用了不支持的 ZIP 特性，请使用 BlockCraft 原始导出包。',
  PACKAGE_INTEGRITY: '项目包完整性校验失败，文件可能已损坏。',
  RESOURCE_MISSING: '项目包缺少必需的图片或资源文件。',
  RESOURCE_INVALID: '图片格式不受支持，或资源引用不一致。',
  PACKAGE_SECRET: '项目内容可能含有凭据，请移除后再导入或导出。',
  LIMIT: '项目 JSON 或资源超过上限。',
  INVALID_FILE: '项目 JSON 无效或已损坏。',
  UNSUPPORTED_FORMAT: '项目 JSON 格式版本不受支持。',
  VERSION_MISSING: '项目引用的组件版本不完整。',
  DIGEST_MISMATCH: '项目组件版本校验失败。',
}

/** Never reflect untrusted filenames, JSON values or arbitrary exception text. */
export function projectFileErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (Object.prototype.hasOwnProperty.call(messages, code)) return `${messages[code]} 当前项目未更改。`
  if (error instanceof Error && error.message.startsWith('无法保存本地备份')) {
    return '无法保存本地备份，请先下载当前项目并检查浏览器存储。当前项目未更改。'
  }
  return '项目文件操作失败，请检查文件或稍后重试。当前项目未更改。'
}
