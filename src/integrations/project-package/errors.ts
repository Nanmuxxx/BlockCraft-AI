/** Safe, stable errors: messages must never interpolate imported content. */
export class ProjectPackageError extends Error {
  constructor(public readonly code: string, message = '项目包无效。') {
    super(message)
    this.name = 'ProjectPackageError'
  }
}
