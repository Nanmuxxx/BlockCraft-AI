import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Local provenance check: requires the retained source commits, not a shallow clone.
const cwd = fileURLToPath(new URL('../../', import.meta.url))
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const main = 'b56a26a9803718d806bac3ddbd7fbe19e0c495c6'
const core = '764f2dd023d3e3ca54af755f6291e142e0ccb915'
const code = '47a0c45bc95834d575a07e986b0b3987a9accff7'
const docker = '278b13008fcbd90eb874e067ca3ffc1b33fef664'
assert.equal(git('diff', '--name-only', docker, 'HEAD', '--', 'Dockerfile', '.dockerignore', '.github/workflows/docker-acceptance.yml'), '', 'retain Docker owner exact packaging')
for (const ancestor of [main, core, docker]) git('merge-base', '--is-ancestor', ancestor, code)
assert.equal(git('diff', '--name-only', main, 'HEAD', '--', 'ms_deploy.json', 'tools/project-zip-export', 'tests/project-zip-export', 'src/integrations/mochi/host.test.cjs'), '')
assert.equal(git('diff', '--name-only', code, 'HEAD', '--', 'src', 'server', ':!server/server.test.mjs'), '', 'production must remain frozen after QA handoff')
assert.equal(git('diff', '--name-only', core, 'HEAD', '--', 'src'), '', 'preserve extracted Core client code')
const allowed = new Set(['server/index.mjs', 'server/custom-block/provider.mjs', 'server/mochi-ai/provider.mjs', 'server/server.test.mjs'])
const changes = git('diff', '--name-only', core, 'HEAD', '--', 'server').split('\n').filter(Boolean)
for (const file of changes) assert.ok(allowed.has(file) || file.startsWith('server/paid-gateway/'), `unexpected server change: ${file}`)
assert.equal(git('rev-parse', 'HEAD:server/index.mjs'), 'bdab61b76c92fa775c286edeb39e70b88467fdda', 'must retain exact owner-composed entry')
console.log(JSON.stringify({ status: 'PASS', main, core, code, checkedHead: git('rev-parse', 'HEAD'), protectedFiles: 'Docker/deployment, ZIP exporter, #36 CAS tests', productionFrozen: true }, null, 2))
