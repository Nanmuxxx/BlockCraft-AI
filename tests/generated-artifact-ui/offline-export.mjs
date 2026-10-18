// Explicit offline acceptance helper; no provider import, request or source compilation.
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPendingStore } from '../../server/custom-block/store.mjs'
import { exportPendingInstall } from '../../server/custom-block/install-export.mjs'

export async function archivedInstallExport(instanceId = 'offline-pomodoro') {
  const record = JSON.parse(await readFile(new URL('../generated-artifact/fixtures/pomodoro.pending.json', import.meta.url), 'utf8'))
  const directory = await mkdtemp(path.join(os.tmpdir(), 'blockcraft-offline-ui-'))
  try {
    const store = createPendingStore(directory)
    await store.put(record)
    return await exportPendingInstall(store, {
      reference: { definitionId: record.entry.artifact.manifest.definitionId, versionDigest: record.entry.versionDigest },
      instanceId, props: { initialMinutes: 25, title: '离线真实番茄钟' },
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
}
