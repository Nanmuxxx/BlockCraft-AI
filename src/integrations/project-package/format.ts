import type { ArtifactRegistry, CustomProject } from '../../custom-block'
import type { ProjectAsset } from '../../model/appSpec'
import { PROJECT_ASSET_LIMITS } from '../../model/appSpecValidation'
import { assertProjectJson, cloneJson, CustomBlockError, id, keys, object } from '../../custom-block/json'
import { createProjectJson, parseProjectJson, PROJECT_JSON_FORMAT, type RestoredProject } from '../project-json/format'
import { ProjectPackageError } from './errors'
import { decodePackageZip, encodePackageZip } from './zip'
import { assertNoPackageSecrets, assertNoResourceSecrets } from './security'
import { parsePackageJsonText } from './json'
import { assertImageDecodable } from './image'

export const PROJECT_PACKAGE_FORMAT = 'blockcraft-project-package'
export const PROJECT_PACKAGE_VERSION = 1
const PROJECT_FORMAT = 'blockcraft-package-project'
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as const
const encoder = new TextEncoder()
const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key)
type Obj = Record<string, unknown>
interface Resource { id: string; path: string; mimeType: ProjectAsset['mimeType']; byteLength: number; sha256: string }

function ensure(condition: unknown, code = 'PACKAGE_INVALID'): asserts condition {
  if (!condition) throw new ProjectPackageError(code)
}
function exact(value: unknown, required: string[], optional: string[] = []): asserts value is Obj {
  object(value); keys(value, required, optional)
}
function admit(value: unknown) { assertProjectJson(value); assertNoPackageSecrets(value) }
function serialize(value: unknown): Uint8Array { admit(value); return encoder.encode(`${JSON.stringify(value)}\n`) }
function parse(bytes: Uint8Array): unknown {
  ensure(bytes.byteLength <= 4_000_000, 'PACKAGE_LIMIT')
  let value: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    value = parsePackageJsonText(text)
  } catch (error) {
    if (error instanceof ProjectPackageError) throw error
    throw new ProjectPackageError('PACKAGE_INVALID')
  }
  admit(value)
  return value
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  return btoa(binary)
}
function resourcePath(resourceId: unknown, mime: unknown): string {
  try { id(resourceId) } catch { throw new ProjectPackageError('RESOURCE_INVALID') }
  ensure(typeof mime === 'string' && hasOwn(extensions, mime), 'RESOURCE_INVALID')
  return `assets/${resourceId}.${extensions[mime as keyof typeof extensions]}`
}
function validateImage(bytes: Uint8Array, mimeType: unknown) {
  ensure(bytes.length > 0, 'RESOURCE_INVALID')
  ensure(bytes.length <= PROJECT_ASSET_LIMITS.maxBytesEach, 'PACKAGE_LIMIT')
  const prefix = (values: number[]) => values.every((value, index) => bytes[index] === value)
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  ensure(mimeType === 'image/png' ? prefix([137,80,78,71,13,10,26,10])
    : mimeType === 'image/jpeg' ? prefix([255,216,255])
    : mimeType === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(ascii(0, 6))
    : mimeType === 'image/webp' ? ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' : false, 'RESOURCE_INVALID')
  assertNoResourceSecrets(bytes)
}
function assetBytes(assetId: string, value: unknown): Uint8Array {
  exact(value, ['id', 'name', 'mimeType', 'dataUrl'], ['altText'])
  resourcePath(assetId, value.mimeType)
  ensure(value.id === assetId && typeof value.dataUrl === 'string', 'RESOURCE_INVALID')
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value.dataUrl)
  ensure(match && match[1] === value.mimeType && match[2].length % 4 === 0, 'RESOURCE_INVALID')
  ensure(match[2].length <= 699_052, 'PACKAGE_LIMIT')
  let data: Uint8Array
  try { data = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)) }
  catch { throw new ProjectPackageError('RESOURCE_INVALID') }
  ensure(base64(data) === match[2], 'RESOURCE_INVALID')
  validateImage(data, value.mimeType)
  return data
}
function metadata(project: CustomProject) {
  return { id: project.base.spec.id, name: project.base.spec.name, revision: project.revision,
    appSpecVersion: project.base.spec.version, projectFormatVersion: project.formatVersion }
}
function guardError(error: unknown): never {
  if (error instanceof ProjectPackageError) throw error
  // Preserve established component admission semantics, without exposing source/input in messages.
  if (error instanceof CustomBlockError) {
    if (error.code === 'LIMIT') throw new ProjectPackageError('PACKAGE_LIMIT')
    if (['VERSION_MISSING', 'DIGEST_MISMATCH', 'INVALID_FILE', 'VALIDATION'].includes(error.code)) {
      if (error.code === 'VERSION_MISSING' || error.code === 'DIGEST_MISMATCH') throw new CustomBlockError(error.code, '项目引用的组件版本缺失或校验失败。')
    }
  }
  throw new ProjectPackageError('PACKAGE_INVALID')
}
function checkVersions(project: Obj) {
  ensure(project.formatVersion === 2, 'PACKAGE_VERSION')
  exact(project.base, ['spec', 'records', 'blockPositions'], ['timers', 'assets'])
  object(project.base.spec)
  ensure(project.base.spec.version === 1 || project.base.spec.version === 2, 'PACKAGE_VERSION')
}
function checkGalleryReferences(project: Obj) {
  object(project.base); object(project.base.spec)
  const assets = project.base.assets ?? {}
  object(assets)
  ensure(Array.isArray(project.base.spec.blocks))
  for (const block of project.base.spec.blocks) {
    object(block)
    if (block.type === 'gallery') {
      ensure(Array.isArray(block.imageIds), 'RESOURCE_INVALID')
      for (const imageId of block.imageIds) ensure(typeof imageId === 'string' && hasOwn(assets, imageId), 'RESOURCE_MISSING')
    }
  }
}

export async function createProjectPackage(project: CustomProject, registry: ArtifactRegistry): Promise<Uint8Array> {
  try {
    // Snapshot before any asynchronous registry/hash work.
    admit(project)
    object(project); checkVersions(project as unknown as Obj); checkGalleryReferences(project as unknown as Obj)
    const snapshot = cloneJson(project)
    ensure(Object.keys(snapshot.base.assets ?? {}).length <= PROJECT_ASSET_LIMITS.maxCount, 'PACKAGE_LIMIT')
    let assetTotal = 0
    for (const [assetId, asset] of Object.entries(snapshot.base.assets ?? {})) {
      const data = assetBytes(assetId, asset)
      assetTotal += data.byteLength
      ensure(assetTotal <= PROJECT_ASSET_LIMITS.maxBytesTotal, 'PACKAGE_LIMIT')
      await assertImageDecodable(data, asset.mimeType)
    }
    const file = await createProjectJson(snapshot, registry)
    admit(file)
    const packaged = cloneJson(file.project) as unknown as Obj
    object(packaged.base)
    const resources: Resource[] = []
    const files: { path: string; data: Uint8Array }[] = []
    let total = 0
    const assets = file.project.base.assets
    ensure(Object.keys(assets ?? {}).length <= PROJECT_ASSET_LIMITS.maxCount, 'PACKAGE_LIMIT')
    for (const [assetId, asset] of Object.entries(assets ?? {})) {
      const path = resourcePath(assetId, asset.mimeType)
      ensure(asset.id === assetId, 'RESOURCE_INVALID')
      const data = assetBytes(assetId, asset)
      total += data.byteLength
      ensure(total <= PROJECT_ASSET_LIMITS.maxBytesTotal, 'PACKAGE_LIMIT')
      resources.push({ id: assetId, path, mimeType: asset.mimeType, byteLength: data.byteLength, sha256: await sha256(data) })
      files.push({ path, data })
      const { dataUrl: _dataUrl, ...properties } = asset
      ;(packaged.base.assets as Obj)[assetId] = { ...properties, resourcePath: path }
    }
    const projectBytes = serialize({ format: PROJECT_FORMAT, formatVersion: 1, project: packaged, artifacts: file.artifacts })
    const manifest = { format: PROJECT_PACKAGE_FORMAT, formatVersion: 1, metadata: metadata(file.project),
      project: { path: 'project.json', byteLength: projectBytes.byteLength, sha256: await sha256(projectBytes) }, resources }
    return encodePackageZip([{ path: 'manifest.json', data: serialize(manifest) }, { path: 'project.json', data: projectBytes }, ...files])
  } catch (error) { guardError(error) }
}

export async function parseProjectPackage(bytes: Uint8Array): Promise<RestoredProject> {
  try {
    const files = decodePackageZip(bytes)
    const manifestBytes = files.get('manifest.json'), projectBytes = files.get('project.json')
    ensure(manifestBytes && projectBytes)
    const manifest = parse(manifestBytes)
    exact(manifest, ['format', 'formatVersion', 'metadata', 'project', 'resources'])
    ensure(manifest.format === PROJECT_PACKAGE_FORMAT)
    ensure(manifest.formatVersion === 1, 'PACKAGE_VERSION')
    exact(manifest.metadata, ['id', 'name', 'revision', 'appSpecVersion', 'projectFormatVersion'])
    exact(manifest.project, ['path', 'byteLength', 'sha256'])
    ensure(manifest.project.path === 'project.json', 'PACKAGE_PATH')
    ensure(manifest.project.byteLength === projectBytes.byteLength && /^[0-9a-f]{64}$/.test(String(manifest.project.sha256))
      && manifest.project.sha256 === await sha256(projectBytes), 'PACKAGE_INTEGRITY')
    ensure(Array.isArray(manifest.resources))
    ensure(manifest.resources.length <= PROJECT_ASSET_LIMITS.maxCount, 'PACKAGE_LIMIT')
    const document = parse(projectBytes)
    exact(document, ['format', 'formatVersion', 'project', 'artifacts'])
    ensure(document.format === PROJECT_FORMAT)
    ensure(document.formatVersion === 1, 'PACKAGE_VERSION')
    object(document.project); checkVersions(document.project)
    const project = cloneJson(document.project)
    object(project.base)
    const assets = project.base.assets ?? {}
    object(assets)
    const listed = new Set(['manifest.json', 'project.json']), ids = new Set<string>()
    let total = 0
    for (const entry of manifest.resources) {
      exact(entry, ['id', 'path', 'mimeType', 'byteLength', 'sha256'])
      const path = resourcePath(entry.id, entry.mimeType)
      ensure(entry.path === path, 'RESOURCE_INVALID')
      ensure(!ids.has(entry.id as string) && !listed.has(path), 'RESOURCE_INVALID')
      ids.add(entry.id as string); listed.add(path)
      const data = files.get(path)
      ensure(data, 'RESOURCE_MISSING')
      ensure(Number.isSafeInteger(entry.byteLength) && (entry.byteLength as number) > 0, 'RESOURCE_INVALID')
      ensure((entry.byteLength as number) <= PROJECT_ASSET_LIMITS.maxBytesEach, 'PACKAGE_LIMIT')
      total += data.byteLength
      ensure(total <= PROJECT_ASSET_LIMITS.maxBytesTotal, 'PACKAGE_LIMIT')
      ensure(entry.byteLength === data.byteLength && typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256)
        && entry.sha256 === await sha256(data), 'PACKAGE_INTEGRITY')
      validateImage(data, entry.mimeType)
      await assertImageDecodable(data, entry.mimeType as string)
      ensure(hasOwn(assets, entry.id as string), 'RESOURCE_INVALID')
      const asset = assets[entry.id as string]
      exact(asset, ['id', 'name', 'mimeType', 'resourcePath'], ['altText'])
      ensure(asset.id === entry.id && asset.mimeType === entry.mimeType && asset.resourcePath === path, 'RESOURCE_INVALID')
      const { resourcePath: _resourcePath, ...properties } = asset
      assets[entry.id as string] = { ...properties, dataUrl: `data:${entry.mimeType};base64,${base64(data)}` }
    }
    for (const assetId of Object.keys(assets)) ensure(ids.has(assetId), 'RESOURCE_MISSING')
    ensure([...files.keys()].every(path => listed.has(path)), 'PACKAGE_PATH')
    checkGalleryReferences(project)
    const expected = metadata(project as unknown as CustomProject)
    ensure(Object.entries(expected).every(([key, value]) => (manifest.metadata as Obj)[key] === value), 'PACKAGE_INVALID')
    return await parseProjectJson({ format: PROJECT_JSON_FORMAT, formatVersion: 1, project, artifacts: document.artifacts })
  } catch (error) { guardError(error) }
}
