const assert = require('node:assert/strict')
const { writeFile, mkdir } = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require('playwright')

const testedMain = process.env.SAFE_VIEWER_MAIN_SHA ?? 'b56a26a9803718d806bac3ddbd7fbe19e0c495c6'
const prHead = process.env.SAFE_VIEWER_PR_HEAD ?? '753dfc5a5b5205665b0a8c9c4c2ce2e00385e9cd'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function frameFor(page) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const frame = page.frames().find(candidate => candidate !== page.mainFrame() && candidate.url().includes('/runner'))
    if (frame) return frame
    await wait(50)
  }
  throw new Error('Runner frame did not appear')
}

async function waitText(frame, selector, expected, timeout = 8000) {
  const started = Date.now()
  let actual = null
  while (Date.now() - started < timeout) {
    actual = await frame.locator(selector).textContent().catch(() => null)
    if (actual === expected) return actual
    await wait(50)
  }
  throw new Error(`Expected ${selector} to be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

async function waitStatus(page, expected, timeout = 8000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const state = await page.evaluate(() => window.__safeViewerTest.state()).catch(() => null)
    if (state?.status === expected) return state
    await wait(40)
  }
  throw new Error(`Expected viewer status ${expected}`)
}

async function noFrame(page) {
  await page.waitForFunction(() => document.querySelectorAll('iframe[data-safe-viewer-frame]').length === 0)
}

async function run() {
  const { start } = await import('./serve.mjs')
  const running = await start()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12_000)
  const pageErrors = []
  const externalAttempts = []
  const externalResponses = []
  const blockedExternal = []
  const runnerRequestCookies = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' && !/^127\.0\.0\.\d+$/.test(url.hostname)) externalAttempts.push(request.url())
    if (/^127\.0\.0\.[2-9]$/.test(url.hostname)) {
      const cookie = request.headers().cookie
      if (cookie) runnerRequestCookies.push(cookie)
    }
  })
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.hostname !== '127.0.0.1' && !/^127\.0\.0\.\d+$/.test(url.hostname)) externalResponses.push(response.url())
  })
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' && !/^127\.0\.0\.\d+$/.test(url.hostname)) {
      blockedExternal.push({ url: request.url(), error: request.failure()?.errorText ?? 'blocked' })
    }
  })
  const checks = []
  const evidence = []
  const mark = (name, detail = {}) => {
    checks.push({ name, passed: true, ...detail })
    evidence.push(name)
  }
  try {
    await page.goto(`${running.hostOrigin}/?bootTimeout=3000`)
    await page.waitForFunction(() => Boolean(window.__safeViewerTest))
    const initialSecrets = await page.evaluate(() => window.__safeViewerTest.hostSecrets())
    assert.deepEqual(initialSecrets, {
      dom: 'HOST_DOM_SECRET',
      storage: 'HOST_AUTH_SECRET',
      cookie: 'host_cookie=HOST_COOKIE_SECRET',
      ping: 0,
    })
    mark('host secrets initialized')

    const counter = await page.evaluate(() => window.__safeViewerTest.mount('counter'))
    assert.equal(counter.status, 'ready')
    const attributes = await page.evaluate(() => {
      const frame = document.querySelector('iframe[data-safe-viewer-frame]')
      return {
        sandbox: frame.getAttribute('sandbox'),
        credentialless: frame.hasAttribute('credentialless'),
        contentDocumentIsNull: frame.contentDocument === null,
        frameCount: document.querySelectorAll('iframe[data-safe-viewer-frame]').length,
      }
    })
    assert.deepEqual(attributes, { sandbox: 'allow-scripts', credentialless: true, contentDocumentIsNull: true, frameCount: 1 })
    let frame = await frameFor(page)
    await frame.waitForSelector('[data-testid="count"]')
    await waitText(frame, '[data-testid="count"]', '0')
    await frame.getByRole('button', { name: '增加', exact: true }).click()
    await waitText(frame, '[data-testid="count"]', '1')
    await frame.getByRole('button', { name: '增加', exact: true }).click()
    await waitText(frame, '[data-testid="count"]', '2')
    await frame.getByRole('button', { name: '重置', exact: true }).click()
    await waitText(frame, '[data-testid="count"]', '0')
    mark('Counter renders and React state updates from real clicks')
    await page.evaluate(() => window.__safeViewerTest.dispose())
    await waitStatus(page, 'disposed')
    await noFrame(page)
    mark('Counter unmount removes iframe')

    const todo = await page.evaluate(() => window.__safeViewerTest.mount('todo'))
    assert.equal(todo.status, 'ready')
    frame = await frameFor(page)
    await frame.getByLabel('新任务').fill('买牛奶')
    await frame.getByRole('button', { name: '添加', exact: true }).click()
    await frame.getByLabel('新任务').fill('写测试')
    await frame.getByRole('button', { name: '添加', exact: true }).click()
    await waitText(frame, '[data-testid="todo-count"]', '2')
    await frame.getByRole('button', { name: '切换 买牛奶', exact: true }).click()
    await waitText(frame, '[aria-label="切换 买牛奶"]', '已完成')
    await frame.getByRole('button', { name: '删除 写测试', exact: true }).click()
    await waitText(frame, '[data-testid="todo-count"]', '1')
    mark('Todo List input, add, toggle and delete update React state')
    await page.evaluate(() => window.__safeViewerTest.dispose())
    await noFrame(page)

    const pomodoro = await page.evaluate(() => window.__safeViewerTest.mount('pomodoro'))
    assert.equal(pomodoro.status, 'ready')
    frame = await frameFor(page)
    await waitText(frame, '[data-testid="remaining"]', '00:03')
    await frame.getByRole('button', { name: '开始', exact: true }).click()
    await wait(1200)
    const runningValue = await frame.locator('[data-testid="remaining"]').textContent()
    assert.notEqual(runningValue, '00:03')
    await frame.getByRole('button', { name: '暂停', exact: true }).click()
    const pausedValue = await frame.locator('[data-testid="remaining"]').textContent()
    await wait(1200)
    assert.equal(await frame.locator('[data-testid="remaining"]').textContent(), pausedValue)
    await frame.getByRole('button', { name: '重置', exact: true }).click()
    await waitText(frame, '[data-testid="remaining"]', '00:03')
    mark('Pomodoro timer runs, pauses and resets')
    await page.evaluate(() => window.__safeViewerTest.dispose())
    await noFrame(page)

    const errored = await page.evaluate(() => window.__safeViewerTest.mount('error'))
    assert.equal(errored.status, 'error')
    assert.ok(['RENDER_ERROR', 'RUNTIME_UNCAUGHT', 'BUNDLE_LOAD_FAILED'].includes(errored.errorCode))
    await noFrame(page)
    await page.evaluate(() => document.querySelector('#ping').click())
    assert.equal(await page.locator('#host-ping').textContent(), '1')
    mark('render error is contained and host stays alive', { code: errored.errorCode })

    await page.evaluate(() => { void window.__safeViewerTest.mount('loop') })
    await wait(300)
    const pingStarted = Date.now()
    await page.evaluate(() => document.querySelector('#ping').click())
    const pingDuration = Date.now() - pingStarted
    assert.ok(pingDuration < 1000, `host became unresponsive for ${pingDuration}ms`)
    const looped = await waitStatus(page, 'error', 7000)
    assert.equal(looped.errorCode, 'RUNTIME_TIMEOUT')
    await noFrame(page)
    await page.evaluate(() => document.querySelector('#ping').click())
    assert.equal(await page.locator('#host-ping').textContent(), '3')
    mark('infinite loop is process-isolated, timed out and removed', { pingDurationMs: pingDuration })

    const attack = await page.evaluate(() => window.__safeViewerTest.mount('attack-dynamic'))
    assert.equal(attack.status, 'ready')
    frame = await frameFor(page)
    await frame.getByRole('button', { name: '运行攻击测试', exact: true }).click()
    await frame.waitForSelector('[data-testid="attack-result"]')
    const resultText = await frame.locator('[data-testid="attack-result"]').textContent()
    const attackResult = JSON.parse(resultText)
    assert.ok(['SecurityError', 'SafeViewerCapabilityError'].includes(attackResult.parent))
    assert.ok(['SecurityError', 'Error', 'SafeViewerCapabilityError'].includes(attackResult.storage))
    assert.ok(['empty', 'SecurityError', 'SafeViewerCapabilityError'].includes(attackResult.cookie))
    assert.equal(attackResult.fetch, 'SafeViewerCapabilityError')
    assert.equal(attackResult.ws, 'SafeViewerCapabilityError')
    assert.equal(attackResult.beacon, 'SafeViewerCapabilityError')
    assert.equal(attackResult.open, 'SafeViewerCapabilityError')
    assert.equal(attackResult.image, 'requested')
    const frameHtml = await frame.content()
    for (const secret of ['HOST_DOM_SECRET', 'HOST_AUTH_SECRET', 'HOST_COOKIE_SECRET']) {
      assert.equal(frameHtml.includes(secret), false)
    }
    const beforeTop = page.url()
    await frame.getByTestId('top-link').click()
    await wait(250)
    assert.equal(page.url(), beforeTop)
    assert.deepEqual(externalResponses, [])
    assert.ok(blockedExternal.some(entry => entry.url === 'https://example.test/pixel'))
    assert.deepEqual(runnerRequestCookies, [])
    mark('host DOM, storage and network are inaccessible; top navigation blocked')

    const diagnosticsBeforeForge = await page.evaluate(() => window.__safeViewerTest.diagnostics())
    await page.evaluate(({ sessionId, nonce }) => {
      window.__safeViewerTest.forge({ protocol: 'blockcraft-safe-viewer/1', type: 'ready', sessionId, nonce, seq: 1, sdkVersion: '1.0.0' })
      window.__safeViewerTest.forge({ protocol: 'blockcraft-safe-viewer/1', type: 'boot', sessionId, nonce })
    }, diagnosticsBeforeForge)
    await wait(150)
    const diagnosticsAfterForge = await page.evaluate(() => window.__safeViewerTest.diagnostics())
    assert.equal(diagnosticsAfterForge.status, 'ready')
    assert.ok(diagnosticsAfterForge.rejectedMessages >= diagnosticsBeforeForge.rejectedMessages + 2)
    assert.equal(diagnosticsAfterForge.acceptedMessages, diagnosticsBeforeForge.acceptedMessages)
    mark('forged postMessage from the host window is rejected')
    await page.evaluate(() => window.__safeViewerTest.dispose())
    await noFrame(page)

    const invalid = await page.evaluate(async () => {
      const fixtures = window.__safeViewerTest.fixtures
      const run = async (payload) => window.__safeViewerTest.compileRaw(payload)
      return {
        protocol: await run({ protocol: 'evil', instance: fixtures.counter.instance, artifact: fixtures.counter.artifact }),
        illegal: await run({ protocol: 'blockcraft-safe-viewer/1', instance: fixtures['illegal-import'].instance, artifact: fixtures['illegal-import'].artifact }),
        staticAttack: await run({ protocol: 'blockcraft-safe-viewer/1', instance: fixtures['attack-static'].instance, artifact: fixtures['attack-static'].artifact }),
        bundleLimit: await run({ protocol: 'blockcraft-safe-viewer/1', instance: fixtures['bundle-limit'].instance, artifact: fixtures['bundle-limit'].artifact }),
        digest: await (async () => {
          const instance = { ...fixtures.counter.instance, versionDigest: `sha256:${'0'.repeat(64)}` }
          return run({ protocol: 'blockcraft-safe-viewer/1', instance, artifact: fixtures.counter.artifact })
        })(),
      }
    })
    assert.equal(invalid.protocol.body.error.code, 'INVALID_PROTOCOL')
    assert.equal(invalid.illegal.status, 422)
    assert.equal(invalid.illegal.body.error.code, 'IMPORT_REJECTED')
    assert.equal(invalid.staticAttack.status, 422)
    assert.equal(invalid.staticAttack.body.error.code, 'SOURCE_CAPABILITY_REJECTED')
    assert.equal(invalid.bundleLimit.status, 422)
    assert.equal(invalid.bundleLimit.body.error.code, 'BUNDLE_LIMIT')
    assert.equal(invalid.digest.status, 422)
    assert.equal(invalid.digest.body.error.code, 'DIGEST_MISMATCH')
    mark('illegal protocol, imports, capabilities, digest and bundle size are rejected')

    const beforeRepeat = await page.evaluate(() => window.__safeViewerTest.diagnostics())
    for (let index = 0; index < 3; index++) {
      const state = await page.evaluate(() => window.__safeViewerTest.mount('counter'))
      assert.equal(state.status, 'ready')
      const currentFrame = await frameFor(page)
      await waitText(currentFrame, '[data-testid="count"]', '0')
      await page.evaluate(() => window.__safeViewerTest.dispose())
      await noFrame(page)
    }
    const afterRepeat = await page.evaluate(() => window.__safeViewerTest.diagnostics())
    assert.equal(afterRepeat.windowListenerAttached, false)
    assert.equal(afterRepeat.framePresent, false)
    assert.ok(afterRepeat.mounts >= beforeRepeat.mounts + 3)
    mark('repeated mount and unmount leave no iframe or host listener', { mounts: afterRepeat.mounts })

    const firstSwitch = await page.evaluate(() => window.__safeViewerTest.mount('counter'))
    assert.equal(firstSwitch.status, 'ready')
    const secondSwitch = await page.evaluate(() => window.__safeViewerTest.mount('todo'))
    assert.equal(secondSwitch.status, 'ready')
    assert.equal(await page.locator('iframe[data-safe-viewer-frame]').count(), 1)
    frame = await frameFor(page)
    await frame.getByLabel('新任务').fill('页面切换后仍可编辑')
    await frame.getByRole('button', { name: '添加', exact: true }).click()
    await waitText(frame, '[data-testid="todo-count"]', '1')
    mark('page switching disposes the old iframe and keeps one live runner')

    const diagnostics = await page.evaluate(() => window.__safeViewerTest.diagnostics())
    const runnerResponse = await page.request.get(diagnostics.lastRunnerUrl)
    assert.equal(runnerResponse.status(), 200)
    const runnerCsp = runnerResponse.headers()['content-security-policy']
    assert.match(runnerCsp, /sandbox allow-scripts/)
    assert.match(runnerCsp, /connect-src 'none'/)
    assert.match(runnerCsp, /frame-ancestors http:\/\/127\.0\.0\.1:\d+/)
    assert.equal(runnerResponse.headers()['origin-agent-cluster'], '?1')
    mark('runner response carries strict CSP and origin-agent-cluster headers')

    const finalStats = await page.evaluate(() => window.__safeViewerTest.stats())
    assert.ok(finalStats.compiler.builds >= 1)
    assert.ok(finalStats.compiler.hits >= 1)
    assert.equal(finalStats.runnerCookieHeaders, 0)
    assert.ok(finalStats.quarantined.length >= 1)
    assert.deepEqual(runnerRequestCookies, [])
    assert.deepEqual(externalResponses, [])
    assert.deepEqual(pageErrors, [])
    assert.deepEqual(await page.evaluate(() => window.__safeViewerTest.hostSecrets()), {
      dom: 'HOST_DOM_SECRET',
      storage: 'HOST_AUTH_SECRET',
      cookie: 'host_cookie=HOST_COOKIE_SECRET',
      ping: 3,
    })
    mark('host state remains intact and CSP blocked the only external attempt', { cache: finalStats.compiler })

    const output = path.resolve('docs/acceptance/safe-viewer')
    await mkdir(output, { recursive: true })
    const report = {
      generatedAt: new Date().toISOString(),
      testedMain,
      prHead,
      browser: await browser.version(),
      hostOrigin: running.hostOrigin,
      runnerOrigins: running.runnerOrigins,
      checks,
      externalRequests: externalAttempts,
      externalResponses,
      blockedExternal,
      runnerRequestCookies,
      pageErrors,
      cache: finalStats.compiler,
      runnerPool: finalStats.runnerPool,
      quarantined: finalStats.quarantined,
      runnerRetired: finalStats.runnerRetired,
      note: 'Real Chromium interactions; no screenshot substituted for execution.',
    }
    await writeFile(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ passed: checks.length, browser: report.browser, cache: finalStats.compiler, evidence: output }, null, 2))
  } finally {
    await context.close()
    await browser.close()
    await running.stop()
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
