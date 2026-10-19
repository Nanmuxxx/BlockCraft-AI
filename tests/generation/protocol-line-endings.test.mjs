import test from 'node:test'
import assert from 'node:assert/strict'
import { readGenerationProtocol, readV1GenerationProtocol } from '../../server/aiGenerationPrompt.mjs'

test('v1 protocol projection is identical for LF and CRLF source', () => {
  const lf = readGenerationProtocol()
  const crlf = lf.replaceAll('\n', '\r\n')
  assert.equal(readV1GenerationProtocol(lf), readV1GenerationProtocol(crlf))
  assert.equal(readGenerationProtocol().includes('\r'), false)
  assert.equal(readV1GenerationProtocol(crlf).includes("type: 'pomodoro'"), false)
  assert.equal(readV1GenerationProtocol(crlf).includes('version: 1;'), true)
})

test('v1 protocol projection still rejects missing or ambiguous boundaries', () => {
  const source = readGenerationProtocol()
  const extension = "  | { type: 'pomodoro'; protocolVersion: 1; durationSeconds: number }\n"
  assert.ok(source.includes(extension))
  assert.throws(() => readV1GenerationProtocol(source.replace(extension, '')), /Review v1 protocol projection/)
  assert.throws(() => readV1GenerationProtocol(source.replace('version: 1 | 2;', 'version: 1 | 2 | 3;')), /Review v1 protocol projection/)
})
