// Compiles ONLY trusted repository protocol modules. Never accepts a source path.
import ts from 'typescript'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'

if (ts.version !== '5.9.3') throw new Error('Trusted protocol compiler version mismatch')
const configPath = fileURLToPath(new URL('./tsconfig.json', import.meta.url))
const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) throw new Error('Invalid trusted protocol tsconfig')
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL('.', import.meta.url)))
const program = ts.createProgram(parsed.fileNames, parsed.options)
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory, getCanonicalFileName: p => p, getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else {
  const result = program.emit()
  if (result.emitSkipped) throw new Error('Trusted protocol compilation failed')
  mkdirSync(new URL('./.generated/', import.meta.url), { recursive: true })
  writeFileSync(new URL('./.generated/package.json', import.meta.url), '{"type":"commonjs"}\n')
  process.stdout.write('Trusted Phase 1A protocol compiled; no component source compiled or executed.\n')
}
