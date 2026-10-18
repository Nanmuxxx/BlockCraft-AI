// Reuse the project's real validator/runtime; compile only in memory, as the
// existing *.test.cjs files do. No generated server files or model edits needed.
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename)

module.exports = {
  ...require('../../src/model/appSpecValidation.ts'),
  ...require('../../src/model/appRuntime.ts'),
  ...require('../../src/components/ai-create/generateApp.ts'),
}
