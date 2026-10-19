const path = require('node:path')
const { chromium } = require('playwright')
const launch = chromium.launch.bind(chromium)
chromium.launch = options => launch({ ...options, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
process.env.GENERATION_QA_OUTPUT = process.argv[3]
require(path.join(process.argv[2], 'tests/generation/browser.cjs'))
