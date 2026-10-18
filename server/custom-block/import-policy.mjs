import ts from 'typescript'
import path from 'node:path'
import { ensure, LIMITS } from './protocol.mjs'
import { IMPORTS } from './policy.mjs'

// Syntax admission only. This is NOT a sandbox, build, semantic proof or run permit.
export function checkImports(artifact) {
  ensure(ts.version === '5.9.3', 'PARSER_VERSION')
  const paths = Object.keys(artifact.sources)
  ensure(paths.length <= LIMITS.sourceFiles, 'SOURCE_LIMIT')
  const graph = new Map(paths.map(name => [name, new Set()]))
  function reference(from, specifier) {
    ensure(typeof specifier === 'string' && !/[\\%?#\s\x00-\x1f]/u.test(specifier), 'IMPORT_REJECTED')
    if (Object.hasOwn(IMPORTS, specifier)) {
      ensure(Object.hasOwn(artifact.dependencies, IMPORTS[specifier]), 'UNDECLARED_DEPENDENCY')
      return
    }
    ensure(specifier.startsWith('./') || specifier.startsWith('../'), 'IMPORT_REJECTED')
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    ensure(!base.startsWith('../') && !path.posix.isAbsolute(base), 'IMPORT_REJECTED')
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].filter(p => paths.includes(p))
    ensure(candidates.length === 1, 'IMPORT_RESOLUTION')
    graph.get(from).add(candidates[0])
  }
  for (const [name, source] of Object.entries(artifact.sources)) {
    ensure(/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts'), 'SOURCE_TYPE')
    ensure(Buffer.byteLength(source) <= LIMITS.sourceFileBytes, 'SOURCE_LIMIT')
    // Bound tokens/nesting before invoking the trusted syntax parser.
    const scanner = ts.createScanner(ts.ScriptTarget.ES2020, true, ts.LanguageVariant.JSX, source)
    let tokens = 0, nesting = 0, token
    while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
      ensure(++tokens <= LIMITS.sourceTokens, 'SOURCE_COMPLEXITY')
      if ([ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.OpenBracketToken, ts.SyntaxKind.OpenBraceToken].includes(token)) nesting++
      if ([ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseBraceToken].includes(token)) nesting = Math.max(0, nesting - 1)
      ensure(nesting <= LIMITS.sourceNesting, 'SOURCE_COMPLEXITY')
    }
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.ES2020, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    ensure(file.parseDiagnostics.length === 0, 'SOURCE_SYNTAX')
    ensure(file.referencedFiles.length === 0 && file.typeReferenceDirectives.length === 0 && file.libReferenceDirectives.length === 0 && !file.hasNoDefaultLib, 'IMPORT_REJECTED')
    if (name === artifact.manifest.entry) {
      ensure(file.statements.some(node =>
        ts.isExportAssignment(node) && !node.isExportEquals && (ts.isIdentifier(node.expression) || ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression) || ts.isClassExpression(node.expression)) ||
        (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)), 'ENTRY_EXPORT')
    }
    // Iterative walk avoids a second recursive walk over untrusted source trees.
    const stack = [file]
    while (stack.length) {
      const node = stack.pop()
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier) {
        ensure(ts.isStringLiteral(node.moduleSpecifier) && !node.attributes, 'IMPORT_REJECTED')
        reference(name, node.moduleSpecifier.text)
      }
      ensure(!ts.isImportEqualsDeclaration(node) && !ts.isImportTypeNode(node), 'IMPORT_REJECTED')
      if (ts.isCallExpression(node)) ensure(node.expression.kind !== ts.SyntaxKind.ImportKeyword, 'IMPORT_REJECTED')
      if (ts.isIdentifier(node)) ensure(!['require', 'eval', 'Function', 'Worker', 'SharedWorker', 'importScripts', 'WebAssembly'].includes(node.text), 'EXECUTION_PRIMITIVE')
      ts.forEachChild(node, child => { stack.push(child) })
    }
  }
  const reached = new Set(), pending = [artifact.manifest.entry]
  while (pending.length) { const name = pending.pop(); if (!reached.has(name)) { reached.add(name); pending.push(...graph.get(name)) } }
  ensure(reached.size === paths.length, 'UNREACHABLE_SOURCE')
}
