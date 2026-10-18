// Explicit developer setup only. Compiles fixed, repository-owned protocol TS.
// Never import this from the pure exporter. No artifact argument is accepted.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
if (process.argv.length !== 2) throw new Error('NO_ARGUMENTS_ACCEPTED')
const root = new URL('../../', import.meta.url)
const result = spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', 'server/custom-block/tsconfig.json'], { cwd: root, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
writeFileSync(new URL('server/custom-block/.generated/package.json', root), '{"type":"commonjs"}\n')
