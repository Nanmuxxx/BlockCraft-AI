import type { ProjectState } from '../../model/appSpec'
import type { ArtifactRegistry, CustomProject, RegisteredArtifact } from '../../custom-block'
import { assertJson, cloneJson, CustomBlockError, JSON_LIMITS, keys, object } from '../../custom-block/json'
import { assertCustomProjectStructure, parseCustomProject } from '../../custom-block/project'

export const PROJECT_JSON_FORMAT = 'blockcraft-project'
export const PROJECT_JSON_VERSION = 1
export const PROJECT_JSON_MAX_BYTES = JSON_LIMITS.maxBytes

export interface ProjectJsonDocument {
  format: typeof PROJECT_JSON_FORMAT
  formatVersion: typeof PROJECT_JSON_VERSION
  project: CustomProject
  artifacts: RegisteredArtifact[]
}

export interface RestoredProject {
  project: CustomProject
  artifacts: RegisteredArtifact[]
  base: ProjectState
}

function fail(code: string, message: string): never {
  throw new CustomBlockError(code, message)
}

export async function createProjectJson(project: CustomProject, registry: ArtifactRegistry): Promise<ProjectJsonDocument> {
  assertCustomProjectStructure(project)
  const artifacts: RegisteredArtifact[] = []
  const seen = new Set<string>()
  for (const instance of project.custom.instances) {
    const ref = { definitionId: instance.definitionId, versionDigest: instance.versionDigest }
    const key = `${ref.definitionId}/${ref.versionDigest}`
    if (seen.has(key)) continue
    seen.add(key)
    const artifact = await registry.resolve(ref)
    if (!artifact) fail('VERSION_MISSING', '缺少项目引用的精确组件版本。')
    artifacts.push(cloneJson(artifact) as RegisteredArtifact)
  }
  const validated = await parseCustomProject(project, { async resolve(ref) {
    return artifacts.find(item => item.versionDigest === ref.versionDigest && item.artifact.manifest.definitionId === ref.definitionId)
  } })
  return { format: PROJECT_JSON_FORMAT, formatVersion: PROJECT_JSON_VERSION, project: validated, artifacts }
}

export async function parseProjectJson(value: unknown): Promise<RestoredProject> {
  try {
    assertJson(value)
    object(value)
    keys(value, ['format', 'formatVersion', 'project', 'artifacts'])
    if (value.format !== PROJECT_JSON_FORMAT || value.formatVersion !== PROJECT_JSON_VERSION) {
      fail('UNSUPPORTED_FORMAT', '项目文件格式或版本不受支持。')
    }
    if (!Array.isArray(value.artifacts)) fail('INVALID_FILE', '项目文件中的组件版本清单无效。')
    assertCustomProjectStructure(value.project)
    if (value.artifacts.length > 128) fail('LIMIT', '项目组件数量超出上限。')
    const project = cloneJson(value.project)
    const artifacts = cloneJson(value.artifacts) as unknown as RegisteredArtifact[]
    const refs = new Set(project.custom.instances.map(item => `${item.definitionId}/${item.versionDigest}`))
    const artifactRefs = new Set<string>()
    for (const item of artifacts) {
      object(item)
      keys(item, ['versionDigest', 'artifact'])
      const key = `${item.artifact.manifest.definitionId}/${item.versionDigest}`
      if (artifactRefs.has(key)) fail('INVALID_FILE', '项目文件含有重复组件版本。')
      artifactRefs.add(key)
    }
    if (refs.size !== artifactRefs.size || [...refs].some(ref => !artifactRefs.has(ref))) {
      fail('INVALID_FILE', '项目引用与组件版本清单不一致。')
    }
    const validated = await parseCustomProject(project, { async resolve(ref) {
      return artifacts.find(item => item.versionDigest === ref.versionDigest && item.artifact.manifest.definitionId === ref.definitionId)
    } })
    return { project: validated, artifacts, base: { revision: validated.revision, ...validated.base } }
  } catch (error) {
    if (error instanceof CustomBlockError) throw error
    fail('INVALID_FILE', '项目文件无效或已损坏，当前项目未更改。')
  }
}

export function parseProjectJsonText(text: string): Promise<RestoredProject> {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > PROJECT_JSON_MAX_BYTES) {
    return Promise.reject(new CustomBlockError('LIMIT', '项目文件超过 4 MB，当前项目未更改。'))
  }
  let value: unknown
  try { value = JSON.parse(text) }
  catch { return Promise.reject(new CustomBlockError('INVALID_FILE', '文件不是有效的项目 JSON，当前项目未更改。')) }
  return parseProjectJson(value)
}

export function serializeProjectJson(document: ProjectJsonDocument): string {
  assertJson(document)
  const text = `${JSON.stringify(document, null, 2)}\n`
  if (new TextEncoder().encode(text).byteLength > PROJECT_JSON_MAX_BYTES) {
    fail('LIMIT', '项目文件超过 4 MB，无法导出。')
  }
  return text
}
