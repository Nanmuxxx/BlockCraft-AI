import ts from 'typescript'
import { readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Static audit only: never import the server or construct a paid provider.
const root = fileURLToPath(new URL('../../', import.meta.url))
const docker = readFileSync(path.join(root, 'Dockerfile'), 'utf8')
const stages = { build: [], runtime: [] }
let stage
for (const line of docker.replace(/\\\r?\n/g, ' ').split('\n')) {
  const from = /^FROM .* AS (build|runtime)$/i.exec(line.trim())
  if (from) stage = from[1].toLowerCase()
  if (!line.startsWith('COPY ')) continue
  const parts = line.trim().split(/\s+/).slice(1).filter(p => !p.startsWith('--'))
  parts.pop()
  if (!stage || parts.some(p => /[\["*?]/.test(p))) throw Error('Unsupported COPY syntax: refresh audit')
  stages[stage].push(...parts.map(p => p.replace(/^\/app\//, '').replace(/\/$/, '')))
}
const copied = (file, target) => stages[target].some(source => file === source || file.startsWith(source + '/'))
const visited = new Set()
const edges = []
function visit(file) {
  if (visited.has(file)) return
  visited.add(file)
  if (!existsSync(path.join(root, file))) throw Error(`Build required before audit: ${file}`)
  if (!/\.(mjs|js|ts)$/.test(file)) return
  const ast = ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (ast.parseDiagnostics.length) throw Error(`Invalid source syntax: ${file}`)
  const add = spec => {
    if (spec.startsWith('node:')) return
    if (!spec.startsWith('.')) throw Error(`Unaccounted runtime package: ${file} -> ${spec}`)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))
    edges.push({ from: file, to: resolved })
    visit(resolved)
  }
  const walk = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) add(node.moduleSpecifier.text)
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === 'require')) {
      if (!ts.isStringLiteral(node.arguments[0])) throw Error(`Nonliteral dependency: ${file}`)
      add(node.arguments[0].text)
    }
    if (ts.isNewExpression(node) && node.expression.getText(ast) === 'URL' && node.arguments?.[1]?.getText(ast) === 'import.meta.url') {
      if (!ts.isStringLiteral(node.arguments[0])) throw Error(`Nonliteral file dependency: ${file}`)
      add(node.arguments[0].text)
    }
    ts.forEachChild(node, walk)
  }
  walk(ast)
}
visit('server/index.mjs')
const files = [...visited].sort().map(file => ({
  file,
  build: file.replace(/\/$/, '') === 'dist' || file.startsWith('server/.generated/') || copied(file, 'build'),
  runtime: copied(file, 'runtime'),
  bytes: statSync(path.join(root, file)).size,
}))
const missing = files.filter(f => !f.build || !f.runtime)
console.log(JSON.stringify({ entry: 'server/index.mjs', scope: 'Literal imports, require and import.meta.url file reads; COPY coverage only. Docker context exclusions require separate review.', files, edges, missing, status: missing.length ? 'BLOCKED' : 'COPY_CLOSURE_COMPLETE' }, null, 2))
process.exitCode = missing.length ? 1 : 0
