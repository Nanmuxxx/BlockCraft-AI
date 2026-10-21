import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProtocolSource, projectV1GenerationProtocol, readGenerationProtocol, readV1GenerationProtocol } from '../../server/aiGenerationPrompt.mjs'

test('protocol projection treats LF and CRLF source bytes equivalently', () => {
  const lf = readGenerationProtocol()
  const crlf = lf.replace(/\n/g, '\r\n')
  assert.equal(normalizeProtocolSource(crlf), lf)
  assert.equal(projectV1GenerationProtocol(normalizeProtocolSource(crlf)), readV1GenerationProtocol())
})

test('protocol projection still rejects actual AppSpec extension changes', () => {
  const changed = readGenerationProtocol().replace("type: 'pomodoro'", "type: 'timer'")
  assert.throws(() => projectV1GenerationProtocol(changed), /Review v1 protocol projection/)
})
