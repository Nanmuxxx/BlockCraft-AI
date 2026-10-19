import ts from 'typescript'
import { checkImports } from '../custom-block/import-policy.mjs'
import {
  FORBIDDEN_GLOBALS,
  FORBIDDEN_GLOBAL_NAMES,
  FORBIDDEN_GLOBAL_PROPERTIES,
  IMPORT_ALLOWLIST,
  SafeViewerError,
} from './policy.mjs'

const directNames = new Set(FORBIDDEN_GLOBAL_NAMES)
const globalNames = new Set(FORBIDDEN_GLOBALS)
const globalProperties = new Set(FORBIDDEN_GLOBAL_PROPERTIES)

function reject(code = 'SOURCE_CAPABILITY_REJECTED') {
  throw new SafeViewerError(code, 'Source uses a capability outside the safe viewer policy')
}

function isDeclarationName(node) {
  const parent = node.parent
  return Boolean(parent) && (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionExpression(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isClassExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && (parent.left === node || parent.right === node)) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isJsxAttribute(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node)
  )
}

function globalReceiver(node) {
  if (ts.isIdentifier(node)) return globalNames.has(node.text)
  if (ts.isParenthesizedExpression(node)) return globalReceiver(node.expression)
  return false
}

function scanImports(artifact) {
  for (const [name, source] of Object.entries(artifact.sources)) {
    if (name.split('/').some(segment => segment.toLowerCase() === 'node_modules')) reject('IMPORT_REJECTED')
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.ES2020, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    if (file.parseDiagnostics.length) reject('SOURCE_SYNTAX')
    for (const statement of file.statements) {
      const moduleSpecifier = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined
      if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier)) continue
      const specifier = moduleSpecifier.text
      if (specifier.startsWith('./') || specifier.startsWith('../')) continue
      if (!IMPORT_ALLOWLIST.includes(specifier)) reject('IMPORT_REJECTED')
    }
  }
}

function scanCapabilities(artifact) {
  for (const [name, source] of Object.entries(artifact.sources)) {
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.ES2020, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const stack = [file]
    while (stack.length) {
      const node = stack.pop()
      if (ts.isIdentifier(node) && directNames.has(node.text) && !isDeclarationName(node)) reject()
      if (ts.isPropertyAccessExpression(node)) {
        if (globalReceiver(node.expression) && globalProperties.has(node.name.text)) reject()
      }
      if (ts.isElementAccessExpression(node) && globalReceiver(node.expression) && ts.isStringLiteral(node.argumentExpression)) {
        if (globalProperties.has(node.argumentExpression.text)) reject()
      }
      ts.forEachChild(node, child => { stack.push(child) })
    }
  }
}

/** Syntax/import admission plus a source-level capability denylist.
 * This is defense in depth only; the iframe runtime and CSP remain the boundary.
 */
export function assertSafeSource(artifact) {
  checkImports(artifact)
  scanImports(artifact)
  scanCapabilities(artifact)
}
