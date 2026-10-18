import type { CustomBlockInstance, CustomProject, RegisteredArtifact } from '../../custom-block'
import { assertArtifactReference, parseCustomProject, resolveArtifact } from '../../custom-block'
import { assertJson, check, cloneJson, id, keys, object } from '../../custom-block/json'
import type { CustomProjectSession } from '../../model/customProjectSession'
import type { RuntimeResult } from '../../model/appRuntime'
import type { WriteAuthorization } from '../custom-block-bc/owner'

/** Identical to the existing CustomBlockImport JSON file, never a commit token. */
export interface GeneratedImportFile { instance: CustomBlockInstance; artifact: RegisteredArtifact }
export interface GeneratedInstallPreview {
  ticketId: string
  importFile: GeneratedImportFile
  baseRevision: number
  status: 'pending-build'
  operation: 'add'
  build: 'not-attempted'
  execution: 'denied'
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

/** One session-bound confirmation adapter, NOT an owner or generator.
 * Host MUST synchronously invalidate/dispose before switching projects. During
 * confirm this gate rejects CONFIRM_BUSY; defer the actual switch until settled.
 * New instances only: replacement is the separate source-version-plan protocol.
 */
export function createGeneratedArtifactInstaller(session: CustomProjectSession) {
  type Ticket = {
    preview: GeneratedInstallPreview; snapshot: CustomProject; authorization: WriteAuthorization; epoch: number
    status: 'pending' | 'confirming' | 'cancelled' | 'rejected' | 'installed'; result?: RuntimeResult
  }
  const tickets = new Map<string, Ticket>()
  let epoch = 0, active: Ticket | null = null, busy = false, disposed = false
  const alive = () => check(!disposed, 'Installer disposed', 'INSTALLER_DISPOSED')
  const unlocked = () => check(!busy, 'Confirmation is pending; defer host context change', 'CONFIRM_BUSY')
  function invalidate() {
    epoch++
    if (active?.status === 'pending') active.status = 'cancelled'
    active = null
  }
  function current(snapshot: CustomProject, authorization: WriteAuthorization, generation: number) {
    alive()
    check(epoch === generation, 'Project context changed', 'CONTEXT_CHANGED')
    check(!session.getAuthorization().readOnly, 'Project is read only', 'READ_ONLY')
    check(session.getAuthorization() === authorization, 'Authorization changed', 'AUTHORIZATION_CHANGED')
    check(session.getSnapshot() === snapshot, 'Project revision changed', 'REVISION_CONFLICT')
  }
  function owned(ticketId: string) {
    alive(); const ticket = tickets.get(ticketId)
    check(ticket, 'Unknown or foreign install ticket', 'TICKET_NOT_OWNED')
    return ticket
  }
  const unsubscribe = session.subscribe(invalidate)
  return {
    async prepare(input: unknown): Promise<GeneratedInstallPreview> {
      alive(); unlocked(); invalidate()
      const snapshot = session.getSnapshot(), authorization = session.getAuthorization(), generation = epoch
      current(snapshot, authorization, generation)
      // Capture all input before the first asynchronous digest validation.
      assertJson(input); object(input); keys(input, ['instance', 'artifact']); object(input.instance)
      keys(input.instance, ['id', 'definitionId', 'versionDigest', 'props'])
      id(input.instance.id); object(input.instance.props)
      const ref = { definitionId: input.instance.definitionId, versionDigest: input.instance.versionDigest }
      assertArtifactReference(ref)
      const file = cloneJson(input) as unknown as GeneratedImportFile
      check(!snapshot.custom.instances.some(item => item.id === file.instance.id), 'Existing instance requires explicit replacement protocol', 'INSTANCE_EXISTS')
      const artifact = await resolveArtifact({ async resolve() { return file.artifact } }, ref)
      check(artifact.artifact.manifest.requestedCapabilities.length === 0 && Object.keys(artifact.artifact.manifest.events).length === 0, 'Generated install cannot grant host capabilities or events', 'CAPABILITIES_REJECTED')
      const next = cloneJson(snapshot)
      next.custom.instances.push(file.instance)
      next.custom.positions[file.instance.id] = { x: .1, y: .7 }
      next.renderOrder.push({ kind: 'custom', id: file.instance.id }); next.revision++
      await parseCustomProject(next, { async resolve(reference) {
        return reference.definitionId === ref.definitionId && reference.versionDigest === ref.versionDigest ? artifact : session.registry.resolve(reference)
      } })
      current(snapshot, authorization, generation)
      const preview = freeze({ ticketId: `install-${globalThis.crypto.randomUUID()}`, importFile: { instance: file.instance, artifact }, baseRevision: snapshot.revision,
        status: 'pending-build' as const, operation: 'add' as const, build: 'not-attempted' as const, execution: 'denied' as const })
      active = { preview, snapshot, authorization, epoch: generation, status: 'pending' }
      tickets.set(preview.ticketId, active)
      return preview
    },
    async confirm(ticketId: string): Promise<RuntimeResult> {
      const ticket = owned(ticketId)
      if (ticket.status === 'installed') return { ...(ticket.result as Extract<RuntimeResult, { ok: true }>), duplicate: true }
      unlocked()
      check(ticket.status === 'pending' && active === ticket, 'Install ticket no longer pending', 'TICKET_NOT_PENDING')
      current(ticket.snapshot, ticket.authorization, ticket.epoch)
      busy = true; ticket.status = 'confirming'
      try {
        const result = await session.install({ ...ticket.preview.importFile, baseRevision: ticket.preview.baseRevision, expectedReference: null }, ticket.authorization)
        ticket.result = result; ticket.status = result.ok ? 'installed' : 'rejected'
        return result
      } catch (error) { ticket.status = 'rejected'; throw error }
      finally { busy = false; if (active === ticket) active = null }
    },
    cancel(ticketId: string) {
      const ticket = owned(ticketId); unlocked()
      if (ticket.status === 'cancelled') return
      check(ticket.status === 'pending' && active === ticket, 'Install ticket no longer pending', 'TICKET_NOT_PENDING')
      invalidate()
    },
    invalidate() { alive(); unlocked(); invalidate() },
    getStatus(ticketId: string) { return owned(ticketId).status },
    dispose() { if (disposed) return; unlocked(); invalidate(); unsubscribe(); disposed = true },
  }
}
