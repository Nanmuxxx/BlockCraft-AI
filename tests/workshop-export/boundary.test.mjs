import test from 'node:test'
import assert from 'node:assert/strict'
import { localProjectExportPlugin } from '../../server/project-export/vite-plugin.mjs'

test('only explicit dev on strict IPv4 loopback receives a capability; builds and preview never do', () => {
  for (const [command, isPreview, mode, enabled] of [
    ['serve', false, 'local-export', true], ['serve', false, 'development', false],
    ['build', false, 'local-export', false], ['serve', true, 'local-export', false],
  ]) {
    const plugin = localProjectExportPlugin()
    plugin.configResolved({ command, isPreview, mode, server: { host: '127.0.0.1', strictPort: true } })
    const code = plugin.load(plugin.resolveId('virtual:local-project-export'))
    assert.equal(!code.includes('= null'), enabled)
    let mounted = false
    if (!enabled) plugin.configureServer({ middlewares: { use() { mounted = true } } })
    assert.equal(mounted, false)
  }
})

test('local mode refuses wildcard/network hosts, automatic port changes and HTTPS proxy setups', () => {
  for (const server of [{ host: '0.0.0.0', strictPort: true }, { host: true, strictPort: true },
    { host: '127.0.0.1', strictPort: false }, { host: '127.0.0.1', strictPort: true, https: {} }]) {
    assert.throws(() => localProjectExportPlugin().configResolved({ command: 'serve', mode: 'local-export', server }))
  }
})
