#!/usr/bin/env node
// Reads five local JSON files only. Does not invoke generation or fetch.
if (process.argv.includes('--help')) {
  console.log('Usage: node tests/ai-quality/check.cjs [local-output-directory]\nExpected files: club-registration.json, fitness-plan.json, reading-log.json, event-registration.json, personal-tasks.json\nDefault: bundled reference fixtures. No AI/network calls.')
} else {
  const { evaluateDirectory } = require('./evaluate.cjs')
  const report = evaluateDirectory(process.argv[2])
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.ok ? 0 : 1
}
