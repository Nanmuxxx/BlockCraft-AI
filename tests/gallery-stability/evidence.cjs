// Mechanically index and hash the completed run; no test or product state writes.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const out = path.join(root, 'docs/acceptance/gallery-stability')
const report = JSON.parse(fs.readFileSync(path.join(out, 'browser-report.json'), 'utf8'))
if (report.fatal || report.summary.fail || report.summary.pass !== 58) throw new Error('Expected a completed 58-case run')
const index = ['# Screenshot index', '', 'Original full-page PNGs from the completed production-browser run. `mock-*` are deliberately injected response failures, not failed product assertions. No failed assertions occurred.', '', '| Screenshot | Meaning |', '|---|---|']
for (const file of report.screenshots) {
  const label = path.basename(file)
  const meaning = label.includes('mock-') ? 'Injected fault message plus preserved current application/data' : label.includes('offline-') ? 'Loaded page while context offline, switching remains usable' : label.includes('refresh-') ? 'Reloaded initial fixture after refresh/malformed status' : 'Third full cycle; confirmed same-fixture reload restores initial rows'
  index.push(`| [${label}](${file}) | ${meaning} |`)
}
fs.writeFileSync(path.join(out, 'SCREENSHOTS.md'), index.join('\n') + '\n')
const files = []
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (entry.name !== 'SHA256SUMS') files.push(file)
  }
}
walk(out); walk(__dirname)
const sums = files.sort().map(file => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.relative(root, file).split(path.sep).join('/')}`)
fs.writeFileSync(path.join(out, 'SHA256SUMS'), sums.join('\n') + '\n')
console.log(JSON.stringify({ cases: report.summary, screenshots: report.screenshots.length, hashedFiles: files.length }))
