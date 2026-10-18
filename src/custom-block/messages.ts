import type { CustomBlockManifest, SandboxMessage } from './types'
import { assertJson, check, cloneJson, digest, id, keys, MESSAGE_LIMITS, object, revision } from './json'
import { assertObjectSchema, assertSchemaValue } from './schema'

/** Structural validation ONLY. Does not authenticate origin, session, seq or requestId. */
export function parseSandboxMessage(input: unknown): SandboxMessage {
  assertJson(input, MESSAGE_LIMITS); object(input)
  keys(input, ['protocol', 'channelId', 'sessionId', 'instanceId', 'versionDigest', 'seq', 'requestId', 'type', 'payload'])
  check(input.protocol === 'custom-block/1', 'Unknown message protocol')
  for (const field of ['channelId', 'sessionId', 'instanceId', 'requestId']) id(input[field])
  digest(input.versionDigest); revision(input.seq); check((input.seq as number) >= 1, 'Sequence starts at one')
  const p = input.payload; object(p)
  switch (input.type) {
    case 'ready': keys(p, ['sdkVersion']); check(p.sdkVersion === '1.0.0', 'Unsupported SDK'); break
    case 'state.compareAndSet':
      keys(p, ['baseRevision', 'stateRevision', 'value']); revision(p.baseRevision); revision(p.stateRevision); object(p.value); break
    case 'event.emit': keys(p, ['eventId', 'value']); id(p.eventId); object(p.value); break
    case 'command.request': {
      keys(p, ['command', 'baseRevision', 'entityId', 'record'])
      check(p.command === 'records.create', 'Command outside protocol allowlist')
      revision(p.baseRevision); id(p.entityId); object(p.record); keys(p.record, ['id', 'values']); id(p.record.id); object(p.record.values)
      for (const [fieldId, value] of Object.entries(p.record.values)) { id(fieldId); check(['string', 'number', 'boolean'].includes(typeof value), 'Invalid record scalar') }
      break
    }
    case 'result':
      check(typeof p.ok === 'boolean', 'Invalid result')
      if (p.ok) { keys(p, ['ok', 'committedRevision']); revision(p.committedRevision) }
      else { keys(p, ['ok', 'code']); id(p.code) }
      break
    case 'error': keys(p, ['code', 'message']); id(p.code); check(typeof p.message === 'string' && p.message.length <= 1024, 'Invalid error message'); break
    default: check(false, 'Unknown message type')
  }
  return cloneJson(input as unknown as SandboxMessage)
}
/** Optional semantic pass against a verified manifest. Still grants no permission. */
export function validateMessageData(input: unknown, manifest: CustomBlockManifest): SandboxMessage {
  const message = parseSandboxMessage(input)
  if (message.type === 'state.compareAndSet') { assertObjectSchema(manifest.stateSchema); assertSchemaValue(manifest.stateSchema, message.payload.value) }
  if (message.type === 'event.emit') {
    check(Object.prototype.hasOwnProperty.call(manifest.events, message.payload.eventId), 'Undeclared event')
    const schema = manifest.events[message.payload.eventId]; assertObjectSchema(schema); assertSchemaValue(schema, message.payload.value)
  }
  return message
}
