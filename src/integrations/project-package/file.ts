import type { RestoredProject } from '../project-json/format'
import { parseProjectJson, PROJECT_JSON_MAX_BYTES } from '../project-json/format'
import { assertProjectJson, object, CustomBlockError } from '../../custom-block/json'
import { migrateProjectState } from '../../custom-block/project'
import { ProjectPackageError } from './errors'
import { parseProjectPackage } from './format'
import { PACKAGE_LIMITS } from './zip'
import { assertNoPackageSecrets } from './security'
import { parsePackageJsonText } from './json'
import { assertProjectImagesDecodable } from './image'

export interface ProjectFile {
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/** Detect content, not a user-controlled extension. No registry or storage mutations. */
export async function parseProjectFile(file: ProjectFile): Promise<RestoredProject> {
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > PACKAGE_LIMITS.maxZipBytes) {
    throw new ProjectPackageError('PACKAGE_LIMIT')
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength !== file.size) throw new ProjectPackageError('PACKAGE_INVALID')
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseProjectPackage(bytes)
  if (bytes.byteLength > PROJECT_JSON_MAX_BYTES) throw new ProjectPackageError('PACKAGE_LIMIT')
  let value: unknown
  try { value = parsePackageJsonText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch (error) {
    if (error instanceof ProjectPackageError) throw error
    throw new ProjectPackageError('PACKAGE_INVALID')
  }
  try {
    assertProjectJson(value)
    assertNoPackageSecrets(value)
    object(value)
    let restored: RestoredProject
    if ('format' in value) restored = await parseProjectJson(value)
    // Explicit legacy shapes only; never discard custom/artifact/version fields.
    else if ('formatVersion' in value) {
      if (value.formatVersion !== 2) throw new ProjectPackageError('PACKAGE_VERSION')
      restored = await parseProjectJson({ format: 'blockcraft-project', formatVersion: 1, project: value, artifacts: [] })
    } else {
      if (value.spec && typeof value.spec === 'object' && 'version' in value.spec
        && value.spec.version !== 1 && value.spec.version !== 2) throw new ProjectPackageError('PACKAGE_VERSION')
      const project = migrateProjectState(value)
      restored = await parseProjectJson({ format: 'blockcraft-project', formatVersion: 1, project, artifacts: [] })
    }
    await assertProjectImagesDecodable(restored.project.base.assets)
    return restored
  } catch (error) {
    if (error instanceof ProjectPackageError) throw error
    if (error instanceof CustomBlockError && ['UNSUPPORTED_FORMAT', 'VERSION_MISSING', 'DIGEST_MISMATCH', 'LIMIT'].includes(error.code)) throw error
    throw new ProjectPackageError('PACKAGE_INVALID')
  }
}
