import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { exportProjectZip } from '../../tools/project-zip-export/export.mjs'
import { protocol } from '../../server/custom-block/protocol.mjs'
const spec = JSON.parse(readFileSync(new URL('./pomodoro.json', import.meta.url)))
test('pure ZIP boundary explicitly rejects v2 even when caller bypasses UI capture', async () => {
  const project = protocol.migrateProjectState({ revision: 0, spec, records: {}, blockPositions: {} })
  await assert.rejects(exportProjectZip({ project, artifacts: [] }), { code: 'UNSUPPORTED_APP_SPEC' })
  project.base.spec.blocks[0].type = 'list'
  await assert.rejects(exportProjectZip({ project, artifacts: [] }), { code: 'UNSUPPORTED_APP_SPEC' })
})
