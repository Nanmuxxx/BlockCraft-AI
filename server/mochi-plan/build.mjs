// Compiles trusted repository validators only, never model-provided source.
import ts from 'typescript'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const out = fileURLToPath(new URL('./.generated/', import.meta.url))
const program = ts.createProgram([fileURLToPath(new URL('./trusted.ts', import.meta.url))], {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, strict: true, skipLibCheck: true,
  rootDir: root, outDir: out, noEmitOnError: true,
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: p => p, getNewLine: () => '\n' }))
  process.exitCode = 1
} else {
  if (program.emit().emitSkipped) throw new Error('TRUSTED_BUILD_FAILED')
  mkdirSync(out, { recursive: true }); writeFileSync(out + '/package.json', '{"type":"commonjs"}\n')
}
