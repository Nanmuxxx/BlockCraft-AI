// Run in the local integration checkout with the audited source commits present.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
const main = '25773e6d65e4e5a2b29d125baa2510f4a10aa343'
const combined = 'a68c6e6b3078f228283566c6b8db0867f06ca4f4'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
assert.equal(git('diff', combined, 'HEAD', '--', 'src', 'server', 'tests/ai-core-night', 'tests/generation', 'tests/mochi', 'tests/mochi-ai', 'tests/mochi-source', 'tests/custom-block-generation', 'tests/custom-block-workshop', 'tests/generated-artifact', 'tests/generated-artifact-ui', 'tests/trusted-interactive', 'tests/ai-quality'), '')
assert.equal(git('diff', main, 'HEAD', '--', 'tools', 'src/integrations/mochi/host.test.cjs', 'tests/project-zip-export', 'tests/workshop-export'), '')
const paths = git('diff', '--name-only', main, 'HEAD', '--', 'src', 'server').split('\n')
assert.equal(paths.length, 20) // 19 production files + server/server.test.mjs
console.log('PASS: exact Core extraction; PR36 CAS tests and PR41 exporter/test blobs preserved')
