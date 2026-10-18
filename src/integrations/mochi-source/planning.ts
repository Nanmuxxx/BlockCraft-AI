import type { ArtifactReference, CustomBlockInstance, CustomProject, JsonObject, JsonValue, RegisteredArtifact } from '../../custom-block'
import { assertArtifactReference, parseCustomProject, resolveArtifact } from '../../custom-block'
import { assertJson, canonicalJson, check, cloneJson, id, keys, object } from '../../custom-block/json'
import type { CustomProjectSession } from '../../model/customProjectSession'
import type { RuntimeResult } from '../../model/appRuntime'
import type { WriteAuthorization } from '../custom-block-bc/owner'

export interface SourceEditInput extends ArtifactReference { blockId: string; intent: string }
export interface SourcePlanRequest {
  contractVersion: 1
  requestId: string
  projectId: string
  baseRevision: number
  intent: string
  target: CustomBlockInstance
  current: RegisteredArtifact
}
export interface SourcePlanCandidate {
  contractVersion: 1
  requestId: string
  baseRevision: number
  blockId: string
  baseReference: ArtifactReference
  candidate: RegisteredArtifact
  props: JsonObject
  summary: string
  steps: string[]
  changedFiles: string[]
}
/** No Runtime, session, authorization, business records, or writable registry. */
export interface SourcePlanProvider {
  readonly kind: 'mock' | 'model'
  generate(request: Readonly<SourcePlanRequest>, signal: AbortSignal): unknown | Promise<unknown>
}
export interface SourcePlanPreview {
  planId: string
  providerKind: SourcePlanProvider['kind']
  request: SourcePlanRequest
  proposal: SourcePlanCandidate
  status: 'pending-build'
  stateEffect: 'none' | 'archive-and-reset-selected-state'
}
export interface SourceVersionRecord {
  planId: string
  before: CustomBlockInstance
  beforeState: CustomProject['custom']['states'][string] | null
  after: CustomBlockInstance
  previousArtifact: RegisteredArtifact
  candidate: RegisteredArtifact
  receipt: Extract<RuntimeResult, { ok: true }>
  status: 'pending-build'
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const json = (value: unknown) => canonicalJson(value as JsonValue)
const reference = ({ definitionId, versionDigest }: ArtifactReference): ArtifactReference => ({ definitionId, versionDigest })
const same = (a: ArtifactReference, b: ArtifactReference) => a.definitionId === b.definitionId && a.versionDigest === b.versionDigest
function text(value: unknown, max: number): asserts value is string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'Expected bounded nonempty text', 'INVALID_PLAN')
}

/** Validate untrusted JSON, detach before any await, then rehash the candidate.
 * Source admission is data validation, never a build or execution permission.
 * v1 deliberately permits source/props edits only; no capability/schema migration.
 */
export async function validateSourcePlan(raw: unknown, request: Readonly<SourcePlanRequest>): Promise<SourcePlanCandidate> {
  assertJson(raw)
  const value = cloneJson(raw)
  object(value); keys(value, ['contractVersion', 'requestId', 'baseRevision', 'blockId', 'baseReference', 'candidate', 'props', 'summary', 'steps', 'changedFiles'])
  assertArtifactReference(value.baseReference)
  check(value.contractVersion === 1 && value.requestId === request.requestId && value.baseRevision === request.baseRevision && value.blockId === request.target.id && same(value.baseReference, request.target), 'Provider changed request binding', 'PLAN_BINDING_MISMATCH')
  text(value.summary, 1200)
  check(Array.isArray(value.steps) && value.steps.length > 0 && value.steps.length <= 12, 'Expected explicit modification steps', 'INVALID_PLAN')
  value.steps.forEach(step => text(step, 400))
  object(value.props); object(value.candidate)
  const candidateRef = { definitionId: request.target.definitionId, versionDigest: value.candidate.versionDigest }
  assertArtifactReference(candidateRef)
  const candidate = await resolveArtifact({ async resolve() { return value.candidate } }, candidateRef)
  check(!same(candidateRef, request.target), 'Candidate must be a new version', 'VERSION_CONFLICT')
  const before = request.current.artifact, after = candidate.artifact
  check(json(before.manifest) === json(after.manifest) && json(before.dependencies) === json(after.dependencies) && json(before.build) === json(after.build), 'Schema, capabilities, dependencies and build policy migrations require a separate protocol', 'UNSUPPORTED_MIGRATION')
  const changed = [...new Set([...Object.keys(before.sources), ...Object.keys(after.sources)])].filter(path => before.sources[path] !== after.sources[path]).sort()
  check(changed.some(path => path.endsWith('.tsx') && typeof after.sources[path] === 'string' && after.sources[path].trim().length > 0), 'Expected changed TSX source, not a props-only suggestion', 'SOURCE_CHANGE_REQUIRED')
  check(Array.isArray(value.changedFiles) && json(value.changedFiles) === json(changed), 'Changed-file summary does not match source content', 'DIFF_MISMATCH')
  return freeze({ ...value, candidate } as unknown as SourcePlanCandidate)
}

/** Independent confirmation adapter around the EXISTING session.install -> CAS.
 * It owns plan lifecycle/history only, never a project store or revision.
 * All trusted UI selection/mode changes MUST call setSelection/invalidate first.
 * During install's async admission, those changes are rejected by a short lease.
 */
export function createSourceEditPlanner(session: CustomProjectSession, provider: SourcePlanProvider) {
  type Entry = {
    preview: SourcePlanPreview; snapshot: CustomProject; authorization: WriteAuthorization; epoch: number
    status: 'pending' | 'confirming' | 'committed' | 'cancelled' | 'rejected'
    result?: RuntimeResult
  }
  const entries = new Map<string, Entry>()
  const history: SourceVersionRecord[] = []
  let selected: string | null = null, epoch = 0, active: string | null = null
  let pending: AbortController | null = null, confirming = false, disposed = false
  const alive = () => check(!disposed, 'Planner disposed', 'PLANNER_DISPOSED')
  const unlocked = () => check(!confirming, 'Selection is locked until confirmation settles', 'CONFIRM_BUSY')
  function invalidate() {
    epoch++; pending?.abort(); pending = null
    if (active) { const entry = entries.get(active)!; if (entry.status === 'pending') entry.status = 'cancelled' }
    active = null
  }
  function current(snapshot: CustomProject, authorization: WriteAuthorization, ownEpoch: number, blockId: string, base: ArtifactReference) {
    alive()
    check(epoch === ownEpoch && selected === blockId, 'Selection or host context changed', 'CONTEXT_CHANGED')
    check(!session.getAuthorization().readOnly, 'Project is read only', 'READ_ONLY')
    check(session.getAuthorization() === authorization, 'Write authorization changed', 'AUTHORIZATION_CHANGED')
    check(session.getSnapshot() === snapshot, 'Project revision changed', 'REVISION_CONFLICT')
    check(snapshot.custom.instances.some(instance => instance.id === blockId && same(instance, base)), 'Original version changed', 'VERSION_CONFLICT')
  }
  function owned(planId: string) { alive(); const entry = entries.get(planId); check(entry, 'Unknown or foreign plan', 'PLAN_NOT_OWNED'); return entry }
  // Project/authorization generations cancel pending requests, including A -> B -> A.
  const unsubscribe = session.subscribe(invalidate)
  return {
    setSelection(blockId: string | null) {
      alive(); unlocked()
      if (blockId !== null) { id(blockId); check(session.getSnapshot().custom.instances.some(item => item.id === blockId), 'Select an existing custom block', 'SELECTION_REQUIRED') }
      if (selected !== blockId) { invalidate(); selected = blockId }
    },
    invalidate() { alive(); unlocked(); invalidate() },
    async request(input: unknown): Promise<SourcePlanPreview> {
      alive(); unlocked(); assertJson(input); object(input)
      keys(input, ['blockId', 'definitionId', 'versionDigest', 'intent']); id(input.blockId)
      const base = { definitionId: input.definitionId, versionDigest: input.versionDigest }
      assertArtifactReference(base); text(input.intent, 4000)
      check(selected === input.blockId, 'Explicit target must match current selection', 'SELECTION_REQUIRED')
      const blockId = input.blockId, intent = input.intent.trim()
      invalidate()
      const snapshot = session.getSnapshot(), authorization = session.getAuthorization(), ownEpoch = epoch
      current(snapshot, authorization, ownEpoch, blockId, base)
      const target = snapshot.custom.instances.find(item => item.id === blockId)!
      const controller = new AbortController(); pending = controller
      try {
        const artifact = await resolveArtifact(session.registry, base)
        current(snapshot, authorization, ownEpoch, blockId, base)
        const request = freeze({ contractVersion: 1 as const, requestId: `source-${globalThis.crypto.randomUUID()}`, projectId: snapshot.base.spec.id, baseRevision: snapshot.revision, intent, target: cloneJson(target), current: artifact })
        const raw = await provider.generate(request, controller.signal)
        current(snapshot, authorization, ownEpoch, blockId, base)
        const proposal = await validateSourcePlan(raw, request)
        // Validate the entire replacement with the same official project parser.
        const next = cloneJson(snapshot)
        next.custom.instances[next.custom.instances.findIndex(item => item.id === blockId)] = { id: blockId, ...reference({ definitionId: base.definitionId, versionDigest: proposal.candidate.versionDigest }), props: cloneJson(proposal.props) }
        delete next.custom.states[blockId]
        next.revision++
        await parseCustomProject(next, { async resolve(ref) { return same(ref, { definitionId: base.definitionId, versionDigest: proposal.candidate.versionDigest }) ? proposal.candidate : session.registry.resolve(ref) } })
        current(snapshot, authorization, ownEpoch, blockId, base)
        check(!controller.signal.aborted, 'Request cancelled', 'CONTEXT_CHANGED')
        const planId = request.requestId
        const preview = freeze({ planId, providerKind: provider.kind, request, proposal, status: 'pending-build' as const, stateEffect: snapshot.custom.states[blockId] ? 'archive-and-reset-selected-state' as const : 'none' as const })
        entries.set(planId, { preview, snapshot, authorization, epoch: ownEpoch, status: 'pending' }); active = planId
        return preview
      } finally { if (pending === controller) pending = null }
    },
    async confirm(planId: string): Promise<RuntimeResult> {
      const entry = owned(planId)
      if (entry.status === 'committed') return { ...(entry.result as Extract<RuntimeResult, { ok: true }>), duplicate: true }
      unlocked()
      check(entry.status === 'pending' && active === planId, 'Plan is no longer pending', 'PLAN_NOT_PENDING')
      const { request, proposal } = entry.preview
      current(entry.snapshot, entry.authorization, entry.epoch, request.target.id, request.target)
      // Lock before any await/notification to reject duplicate/reentrant confirms.
      entry.status = 'confirming'; confirming = true
      try {
        const after = { id: request.target.id, definitionId: request.target.definitionId, versionDigest: proposal.candidate.versionDigest, props: cloneJson(proposal.props) }
        const result = await session.install({ baseRevision: request.baseRevision, instance: after, artifact: proposal.candidate, expectedReference: reference(request.target) }, entry.authorization)
        entry.result = result; entry.status = result.ok ? 'committed' : 'rejected'
        if (result.ok) history.push(freeze({ planId, before: cloneJson(request.target), beforeState: cloneJson(entry.snapshot.custom.states[request.target.id] ?? null), after, previousArtifact: request.current, candidate: proposal.candidate, receipt: result, status: 'pending-build' }))
        return result
      } catch (error) { entry.status = 'rejected'; throw error }
      finally { confirming = false; if (active === planId) active = null }
    },
    cancel(planId: string) {
      const entry = owned(planId); unlocked()
      if (entry.status === 'cancelled') return
      check(entry.status === 'pending' && active === planId, 'Plan is no longer pending', 'PLAN_NOT_PENDING')
      invalidate()
    },
    getStatus(planId: string) { return owned(planId).status },
    getHistory(): readonly SourceVersionRecord[] { return freeze([...history]) },
    dispose() { if (disposed) return; unlocked(); invalidate(); unsubscribe(); disposed = true },
  }
}
