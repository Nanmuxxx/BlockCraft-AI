import { LIMITS, MochiError, projectContext } from './protocol.mjs'

/** Read-only projection over the EXISTING host and its owner's admitted registry.
 * No Runtime/commands/props/state/source/manifest spreads reach the wire.
 * Async metadata is bound to exact refs; stale resolutions never publish.
 */
export function createMochiContextProjection(host, { readReferences, registry }) {
  const listeners = new Set()
  let stopped = false, generation = 0, signature = '', metadata = new Map(), pending = false, failure = false
  const notify = () => { if (!stopped) listeners.forEach(fn => fn()) }
  function update() {
    if (stopped) return
    let refs
    try { refs = readReferences().map(({ id, definitionId, versionDigest }) => ({ id, definitionId, versionDigest })) }
    catch { generation++; signature = ''; metadata.clear(); pending = false; failure = true; return }
    const next = JSON.stringify(refs)
    if (next === signature) return
    signature = next; const owned = ++generation
    metadata = new Map(); failure = refs.length > LIMITS.blocks; pending = refs.length > 0 && !failure
    if (!pending) return
    void Promise.all(refs.map(async ref => {
      const registered = await registry.resolve({ definitionId: ref.definitionId, versionDigest: ref.versionDigest })
      const manifest = registered?.artifact?.manifest
      if (registered?.versionDigest !== ref.versionDigest || manifest?.definitionId !== ref.definitionId) throw new Error('Missing admitted metadata')
      const schema = manifest.propsSchema
      // Owner admission validates Schema. Only top-level field names/types travel;
      // enum/default/description/title, values and nested payloads are excluded.
      if (schema?.type !== 'object' || !schema.properties || !Array.isArray(schema.required)) throw new Error('Invalid metadata')
      const parameters = Object.entries(schema.properties).map(([name, field]) => ({ name, type: field.type, required: schema.required.includes(name) }))
      return [ref.id, { name: manifest.name, parameters }]
    })).then(entries => {
      if (stopped || owned !== generation) return
      metadata = new Map(entries); pending = false; notify()
    }, () => {
      if (stopped || owned !== generation) return
      pending = false; failure = true; notify()
    })
  }
  const unsubscribe = host.subscribe(() => { update(); notify() })
  update()
  return {
    read() {
      update()
      if (pending || failure) throw new MochiError(pending ? 'CONTEXT_PENDING' : 'CONTEXT_UNAVAILABLE', pending ? '正在读取积木结构…' : '积木结构暂不可用，请重新载入。', 409)
      const view = host.getSnapshot()
      return projectContext({ ...view.context, mode: view.mode, blocks: view.context.blocks.map(block => {
        if (block.type !== 'custom') return block
        const entry = metadata.get(block.id)
        if (!entry) throw new MochiError('CONTEXT_UNAVAILABLE', '积木版本已变化。', 409)
        return { id: block.id, type: 'custom', name: entry.name, fieldIds: [], parameters: entry.parameters }
      }) })
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    dispose() { stopped = true; generation++; unsubscribe(); listeners.clear(); metadata.clear() },
  }
}
