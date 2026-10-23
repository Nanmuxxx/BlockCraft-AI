// Demo QA harness — read-only checks against origin/main @ 4a95cae50f772cd242d932cdbd93366381d1df74.
// Real local app + real local HTTP; only the DeepSeek fetch is injected offline (zero paid calls).
// generationAccess: () => true is the server's own documented offline-test injection point
// (server/index.mjs: "Dependency injection is for offline tests"); no real authorization is manufactured.
// Env: AUDIT_APP_DIR (repo root), AUDIT_PORT (vite, default 5199), AUDIT_OUT (evidence dir).
const path = require('node:path')
const APP_DIR = process.env.AUDIT_APP_DIR
const { chromium } = require(path.join(APP_DIR, 'node_modules', 'playwright'))
const { expect } = require(path.join(APP_DIR, 'node_modules', 'playwright', 'test'))
const { mkdir } = require('node:fs/promises')
const { once } = require('node:events')
const { pathToFileURL } = require('node:url')

const VITE_PORT = Number(process.env.AUDIT_PORT || 5199)
const OUT = process.env.AUDIT_OUT || path.join(__dirname, '..', 'audit-evidence', 'demo-qa')
const mod = rel => import(pathToFileURL(path.join(APP_DIR, rel)).href)

const results = []
const shots = []
let shotIndex = 0
async function shot(page, name, fullPage = true) {
  shotIndex += 1
  const file = path.join(OUT, 'screenshots', `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file, fullPage })
  shots.push(file)
}
function record(id, name, expected, actual, status) {
  results.push({ id, name, expected, actual, status })
  console.log(`[${status}] ${id}: ${name} — ${actual}`)
}
// Fill every control of a RecordEditor defensively; returns how many fields were filled.
async function fillEditor(editor) {
  const labels = editor.locator('label')
  const count = await labels.count()
  let filled = 0
  for (let i = 0; i < count; i += 1) {
    const label = labels.nth(i)
    const select = label.locator('select')
    if (await select.count()) {
      const options = await select.locator('option').count()
      if (options > 1) { await select.selectOption({ index: 1 }); filled += 1 }
      continue
    }
    const input = label.locator('input').first()
    if (await input.count()) {
      const type = await input.getAttribute('type')
      if (type === 'number') await input.fill('1')
      else if (type === 'date') await input.fill('2026-01-19')
      else if (type === 'email') await input.fill('demo@example.com')
      else await input.fill('演示' + (i + 1))
      filled += 1
    }
  }
  return filled
}

async function run() {
  const { cases } = await mod('tests/generation/fixtures.mjs')
  const { createServer: createViteServer } = await mod('node_modules/vite/dist/node/index.js')
  const { createAppServer } = await mod('server/index.mjs')
  const club = cases.find(candidate => candidate.id === 'club-app')
  const movie = cases.find(candidate => candidate.id === 'movie-log')
  let candidate = club
  let mode = 'success'
  let delayMs = 0
  const fetchImpl = async (url, options) => {
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
    if (mode === 'failure') return new Response('', { status: 503 })
    if (mode === 'network') throw new TypeError('offline simulated connection failure')
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(candidate.spec) } }] })
  }
  const backendOptions = { apiKey: 'offline-qa-key', model: 'offline-qa-model', fetchImpl, generationAccess: () => true }
  let backend = createAppServer(backendOptions)
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const backendPort = backend.address().port
  const vite = await createViteServer({ root: APP_DIR, server: { host: '127.0.0.1', port: VITE_PORT, strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: false } } } })
  let browser
  const consoleErrors = []
  const pageErrors = []
  const assetFailures = []
  const consoleWarnings = []
  let suppressConsole = false // set during intentional failure injection (Q9) so the mocked 5xx isn't counted
  const wire = page => {
    page.on('console', message => {
      if (message.type() === 'error' && !suppressConsole) consoleErrors.push(`${page.url()} :: ${message.text()}`)
      if (message.type() === 'warning') consoleWarnings.push(`${page.url()} :: ${message.text()}`)
    })
    page.on('pageerror', error => pageErrors.push(`${page.url()} :: ${error.message}`))
    page.on('response', response => {
      if (!new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) assetFailures.push(`${response.status()} ${response.url()}`)
    })
  }
  try {
    await vite.listen()
    await mkdir(path.join(OUT, 'screenshots'), { recursive: true })
    browser = await chromium.launch({ headless: true })
    // ================= Desktop checks =================
    const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } })
    wire(page)
    const overflowOf = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

    // Q1-Q4 landing page
    await page.goto(`http://127.0.0.1:${VITE_PORT}/ai-create`)
    await expect(page.locator('.hero__title')).toBeVisible()
    const prompt = page.getByLabel('你想做什么软件？')
    await expect(prompt).toBeVisible()
    const navLinks = await page.locator('.ai-create-links a').count()
    const overflowLanding = await overflowOf()
    record('Q1', '/ai-create 落地页加载', '标题/输入框/生成按钮/导航可见，无横向溢出',
      `hero 标题可见；输入框可见；导航链接=${navLinks}；横向溢出=${overflowLanding}px`,
      navLinks === 2 && overflowLanding <= 0 ? 'PASS' : 'FAIL')
    const hint = (await page.locator('.ai-create-hint').textContent() || '').trim()
    // Fact-level honesty assertion (survives wording changes): the hint must state that the click
    // requests DeepSeek, that failure/cancel keeps the current app/data, and that data is not persisted.
    const honest = hint.includes('DeepSeek') && hint.includes('失败') && hint.includes('保留') && hint.includes('刷新')
    record('Q2', 'AI 能力文案诚实性', '提示写明"将请求 DeepSeek / 失败或取消保留原应用和数据 / 刷新后清空"，不夸大能力',
      `提示="${hint}"`, honest ? 'PASS' : 'FAIL')
    const mascot = page.locator('img[src*="mochi"]')
    const mascotCount = await mascot.count()
    let mascotOk = mascotCount > 0
    let mascotAlt = ''
    for (let i = 0; i < mascotCount; i += 1) {
      const item = mascot.nth(i)
      const box = await item.boundingBox()
      const loaded = await item.evaluate(img => img.complete && img.naturalWidth > 0)
      mascotAlt = mascotAlt || (await item.getAttribute('alt')) || ''
      if (!box || box.width === 0 || !loaded) mascotOk = false
    }
    record('Q3', 'Mochi 吉祥物显示（落地页）', '吉祥物图片存在、可见、成功加载、alt 非空',
      `数量=${mascotCount}，全部可见且加载=${mascotOk}，alt="${mascotAlt.slice(0, 40)}"`, mascotOk && mascotAlt ? 'PASS' : 'FAIL')
    record('Q4', '落地页控制台', '无 pageerror / console.error / 资源 4xx',
      `pageErrors=${pageErrors.length}，consoleErrors=${consoleErrors.length}，assetFailures=${assetFailures.length}`,
      pageErrors.length + consoleErrors.length + assetFailures.length === 0 ? 'PASS' : 'FAIL')
    await shot(page, 'landing-desktop')

    // Q5 offline trusted-fixture mainline (the official offline demo path on main @ 4a95cae)
    const pendingPromise = page.locator('.ai-create-status').waitFor({ state: 'visible', timeout: 2500 }).then(() => true).catch(() => false)
    await page.getByLabel('创建方式').selectOption('trusted-fixture')
    await expect(page.locator('.ai-create-hint').first()).toContainText('不会根据自然语言生成内容')
    await page.getByRole('button', { name: '加载离线番茄钟', exact: true }).click()
    const sawPending = await pendingPromise
    await expect(page.getByRole('heading', { name: '考试专注番茄钟', exact: true })).toBeVisible({ timeout: 30000 })
    const sourceNote = (await page.locator('.ai-create-source').textContent().catch(() => '')) || ''
    record('Q5', '离线演示主线（可信番茄钟 Fixture）', '应用标题出现且来源标注为离线固定 Fixture（非真实调用）；本地加载极快，pending 状态一帧即过，仅作观测不判定',
      `pending 观测=${sawPending}；应用「考试专注番茄钟」出现；来源="${(sourceNote || '').trim().slice(0, 40)}"`,
      sourceNote.includes('离线固定 Fixture') ? 'PASS' : 'FAIL')
    await shot(page, 'generated-desktop')

    // Q6 workshop B canvas + mascot panel + honest disabled AI entry
    const blockButtons = await page.locator('button[data-block-key]').count()
    const panelMascot = page.locator('[data-workshop-panel="mochi"] img[src*="mochi"], .mochi-panel img[src*="mochi"], .mochi-ai img[src*="mochi"]')
    const panelMascotCount = await panelMascot.count()
    let panelMascotLoaded = panelMascotCount > 0
    for (let i = 0; i < panelMascotCount; i += 1) {
      const loaded = await panelMascot.nth(i).evaluate(img => img.complete && img.naturalWidth > 0)
      if (!loaded) panelMascotLoaded = false
    }
    const bodyText = await page.locator('body').innerText()
    const disabledHonest = /AI 修改能力尚未启用|尚未接入|AI_MODIFICATION_DISABLED/.test(bodyText)
    record('Q6', 'Workshop B 模式 + Mochi 面板 + AI 入口诚实禁用', '积木卡片=应用 spec 数（番茄钟应用为 1：pomodoro）；吉祥物面板加载；AI 修改入口显示未启用原因',
      `积木卡片=${blockButtons}；面板吉祥物=${panelMascotCount}(加载=${panelMascotLoaded})；禁用原因可见=${disabledHonest}`,
      blockButtons === 1 && panelMascotLoaded && disabledHonest ? 'PASS' : 'FAIL')

    // Q7 C-mode render (pomodoro runtime) + CRUD on the /app-renderer built-in example
    const cButton = page.getByRole('button', { name: /C 模式 · 运行应用|C 模式|运行/ }).first()
    await cButton.click()
    await expect(page.locator('section.renderer-block--pomodoro')).toBeVisible({ timeout: 5000 })
    const pomodoroTimer = ((await page.locator('section.renderer-block--pomodoro output').textContent().catch(() => '')) || '').trim()
    const pomodoroStatus = ((await page.locator('section.renderer-block--pomodoro [role="status"]').textContent().catch(() => '')) || '').trim()
    await shot(page, 'c-mode-pomodoro-desktop')
    await page.goto(`http://127.0.0.1:${VITE_PORT}/app-renderer`)
    await expect(page.getByRole('heading', { name: '通用应用预览' })).toBeVisible()
    const formSection = page.locator('section.renderer-block--form').first()
    const formEditor = formSection.locator('form.renderer-editor')
    const formFilled = await fillEditor(formEditor)
    await formEditor.getByRole('button', { name: '提交', exact: true }).click()
    const formSaved = await formSection.getByRole('status').filter({ hasText: '已保存' }).waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)
    const listSection = page.locator('section.renderer-block--list').first()
    const metricSection = page.locator('section.renderer-block--metric').first()
    const hasMetric = await metricSection.count()
    const metricBefore = hasMetric ? (await metricSection.locator('output').textContent().catch(() => '')) || '' : '（本应用无统计积木）'
    const rowsBefore = await listSection.locator('tbody tr').count()
    await listSection.getByRole('button', { name: '新增记录' }).click()
    const listEditor = listSection.locator('form.renderer-editor')
    const listFilled = await fillEditor(listEditor)
    await listEditor.getByRole('button', { name: '提交', exact: true }).click()
    // Successful create closes the inline editor; row count is the durable success signal.
    await expect(listSection.locator('tbody tr')).toHaveCount(rowsBefore + 1, { timeout: 4000 })
    const rowsAfterAdd = rowsBefore + 1
    await shot(page, 'c-mode-crud-desktop')
    // Single-step delete on main @ 4a95cae: clicking 删除 dispatches immediately (no confirm dialog).
    await listSection.locator('tbody tr').first().getByRole('button', { name: '删除', exact: true }).click()
    await expect(listSection.locator('tbody tr')).toHaveCount(rowsBefore, { timeout: 4000 })
    const rowsAfterDelete = await listSection.locator('tbody tr').count()
    record('Q7', 'C 模式运行与增删（番茄钟计时 + 示例 CRUD）', '番茄钟计时区可见（mm:ss）；示例应用表单提交/列表新增行数+1/两步删除行数-1/统计为数字',
      `番茄钟="${pomodoroTimer}"(${pomodoroStatus})；表单填写=${formFilled} 已保存=${formSaved}；列表行 ${rowsBefore}→${rowsAfterAdd}→${rowsAfterDelete}(填写=${listFilled})；metric="${metricBefore}"`,
      /^\d{2}:\d{2}$/.test(pomodoroTimer) && formSaved && rowsAfterAdd === rowsBefore + 1 && rowsAfterDelete === rowsBefore && (!hasMetric || /^[\d.,\s]+$/.test(metricBefore || 'NaN')) ? 'PASS' : 'FAIL')

    // Q8 repeatability: run the offline mainline again from a fresh landing.
    // (In-memory app state intentionally resets on reload — that is the honest no-persistence behavior.)
    await page.goto(`http://127.0.0.1:${VITE_PORT}/ai-create`)
    await expect(page.locator('.hero__title')).toBeVisible()
    await page.getByLabel('创建方式').selectOption('trusted-fixture')
    await page.getByRole('button', { name: '加载离线番茄钟', exact: true }).click()
    await expect(page.getByRole('heading', { name: '考试专注番茄钟', exact: true })).toBeVisible({ timeout: 30000 })
    await shot(page, 'regenerated-desktop')
    record('Q8', '演示流程可重复运行', '从落地页再次走离线主线成功（刷新重置内存态为诚实的不持久行为）',
      `第 2 次全流程加载「考试专注番茄钟」成功`, true ? 'PASS' : 'FAIL')

    // Q9 honest failure/cancel feedback keeps the old app. Path depends on checkout line endings:
    // CRLF => v1 fails immediately with 502 (no pending window, see F1); LF => injected delay opens
    // the pending window so the cancel button appears. Both paths assert the same honesty contract.
    suppressConsole = true
    await page.locator('.ai-create-regenerate > summary').click()
    await page.getByLabel('创建方式').selectOption('legacy-v1')
    await page.getByLabel('你想做什么软件？').fill(club.idea)
    delayMs = 1500
    await page.getByRole('button', { name: /生成新应用|生成应用/ }).click()
    const cancelVisible = await page.getByRole('button', { name: '取消生成' }).waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)
    let alertText = ''
    if (cancelVisible) {
      await page.getByRole('button', { name: '取消生成' }).click()
      alertText = (await page.getByRole('alert').textContent().catch(() => '')) || ''
    } else {
      // CRLF checkout: v1 fails fast (see F1); the honest failure alert itself is the assertion.
      alertText = await page.getByRole('alert').waitFor({ state: 'visible', timeout: 10000 })
        .then(() => page.getByRole('alert').textContent().catch(() => ''))
        .catch(() => '')
    }
    delayMs = 0
    suppressConsole = false
    const oldAppKept = await page.getByRole('heading', { name: '考试专注番茄钟', exact: true }).isVisible().catch(() => false)
    const honestFeedback = /已保留/.test(alertText || '') && (/已取消/.test(alertText || '') || /生成失败/.test(alertText || ''))
    record('Q9', '失败/取消反馈与旧应用保留', '生成中断（取消或失败）后出现明确 alert 且含"已保留"，旧应用仍在',
      `路径=${cancelVisible ? '取消' : '立即失败（CRLF 检出，见 F1）'}；alert="${(alertText || '').trim().slice(0, 60)}"；旧应用保留=${oldAppKept}`,
      honestFeedback && oldAppKept ? 'PASS' : 'FAIL')

    // F1 environment finding (recorded, not scored): v1 generation availability depends on line
    // endings. server/aiGenerationPrompt.mjs readV1GenerationProtocol() asserts an exact LF
    // spelling inside src/model/appSpec.ts; on a CRLF checkout (Windows autocrlf) the self-check
    // fails closed and every v1 generation returns 502 AI_INVALID_RESPONSE. Product fix belongs
    // to the server owner; this harness only documents the observed behavior on this checkout.
    suppressConsole = true
    await page.getByRole('button', { name: /生成新应用|重试生成/ }).click()
    let f1Outcome = 'timeout'
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(500)
      const clubVisible = await page.getByRole('heading', { name: club.spec.name, exact: true }).isVisible().catch(() => false)
      if (clubVisible) { f1Outcome = 'generated'; break }
      const currentAlert = ((await page.getByRole('alert').textContent().catch(() => '')) || '')
      if (currentAlert.includes('502')) { f1Outcome = 'fail502'; break }
      if (currentAlert && !currentAlert.includes('已取消')) { f1Outcome = 'other-error'; break }
    }
    suppressConsole = false
    if (f1Outcome === 'fail502') {
      record('F1', 'v1 生成在 CRLF 检出下 fail-closed（发现项，不计分）', 'LF 检出：v1 生成可用；CRLF 检出（Windows autocrlf=true）：readV1GenerationProtocol 源码自检失败 → 所有 v1 生成 502。修复建议：读取后做 \\r\\n 归一化或 .gitattributes 固定 eol=lf；归 server owner',
        `当前检出下 v1 生成返回 502（alert="${((await page.getByRole('alert').textContent().catch(() => '')) || '').trim().slice(0, 50)}"）`, 'FINDING')
    } else if (f1Outcome === 'generated') {
      record('F1', 'v1 生成在当前检出下可用（LF 检出行为）', 'v1 生成链路在 LF 检出环境正常（返回注入的离线 AppSpec）',
        `应用「${club.spec.name}」生成成功`, 'FINDING')
    } else {
      record('F1', 'v1 生成探测未得出结论', '15s 内既未生成也未出现 502 alert',
        `outcome=${f1Outcome}`, 'FINDING')
    }
    // Restore the offline fixture app so later checks run on the official mainline.
    await page.getByLabel('创建方式').selectOption('trusted-fixture')
    await page.getByRole('button', { name: '加载离线番茄钟', exact: true }).click()
    await expect(page.getByRole('heading', { name: '考试专注番茄钟', exact: true })).toBeVisible({ timeout: 30000 })

    // Q10 desktop overflow on all three routes (current state: generated app)
    const ovAiCreate = await overflowOf()
    await page.goto(`http://127.0.0.1:${VITE_PORT}/`)
    await expect(page.locator('.hero__title')).toBeVisible()
    const ovHome = await overflowOf()
    await page.goto(`http://127.0.0.1:${VITE_PORT}/app-renderer`)
    await expect(page.getByRole('heading', { name: '通用应用预览' })).toBeVisible()
    const ovDemo = await overflowOf()
    record('Q10', '桌面溢出审计（三条路由）', 'scrollWidth<=clientWidth，无横向溢出',
      `/ai-create=${ovAiCreate}px，/= ${ovHome}px，/app-renderer=${ovDemo}px`,
      ovAiCreate <= 0 && ovHome <= 0 && ovDemo <= 0 ? 'PASS' : 'FAIL')

    // Q11 legacy `/` learning demo flow: home -> clarification -> workshop MochiPanel (honest Mock)
    await page.goto(`http://127.0.0.1:${VITE_PORT}/`)
    await expect(page.locator('.hero__title')).toBeVisible()
    const homeMascot = page.locator('img[src*="mochi"]')
    const homeMascotLoaded = (await homeMascot.count()) > 0 && await homeMascot.first().evaluate(img => img.complete && img.naturalWidth > 0)
    await page.locator('#idea').fill('一个班级值日表工具，记录值日生和完成情况')
    await page.getByRole('button', { name: '开始创造' }).click()
    const clarificationText = page.getByText('你更关注任务管理、课程安排，还是两个都需要？')
    await expect(clarificationText).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: /两个都需要|任务管理|课程安排/ }).first().click()
    const panelTitle = page.getByRole('heading', { name: 'Mochi 的小窝' })
    await expect(panelTitle).toBeVisible({ timeout: 8000 })
    const mockBadge = await page.locator('.mochi-panel__mode').textContent().catch(() => '')
    const history = page.locator('.mochi-panel__history')
    // 1) Arbitrary chat text must get an honest Mock guard notice, not a fake AI reply.
    await page.locator('#mochi-message-input').fill('你好 Mochi，请帮我看看当前积木')
    await page.locator('#mochi-message-input').press('Enter')
    await page.waitForTimeout(400)
    const guardNotice = ((await page.locator('.mochi-panel__notice--input').textContent().catch(() => '')) || '').trim()
    const guardOk = guardNotice.includes('Mock') || guardNotice.includes('只能介绍')
    // 2) Select a supported module, then send its supported mock request → messages append.
    await page.getByRole('button', { name: /任务管理/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    const quickCount = await page.locator('.mochi-panel__quick-button').count()
    let sentVia = 'none'
    if (quickCount > 0) {
      await page.locator('.mochi-panel__quick-button').first().click()
      sentVia = '快捷提示'
    } else {
      await page.locator('#mochi-message-input').fill('解释任务积木')
      await page.locator('#mochi-message-input').press('Enter')
      sentVia = '聊天输入(精确请求)'
    }
    await page.waitForTimeout(600)
    const msgsAfter = await history.locator('.mochi-panel__message').count()
    const historyText = await history.innerText()
    const messageArrived = msgsAfter > 0 && (historyText.includes('解释任务积木') || historyText.includes('任务积木'))
    await shot(page, 'workshop-legacy-desktop')
    record('Q11', '/ 学习 Demo 全流程 + Mochi 面板（本地 Mock + 诚实护栏）', '首页→澄清→Workshop；吉祥物加载；Mock 标识；越界请求有可见护栏提示；选中积木后 Mock 请求写入聊天记录',
      `吉祥物加载=${homeMascotLoaded}；澄清题=true；「Mochi 的小窝」=true；Mock 标识="${(mockBadge || '').trim()}"；护栏提示=${guardOk}("${guardNotice.slice(0, 28)}")；发送方式=${sentVia}；消息=${msgsAfter} 条`,
      homeMascotLoaded && (mockBadge || '').includes('Mock') && guardOk && messageArrived ? 'PASS' : 'FAIL')

    // Q12 /app-renderer example switch
    await page.goto(`http://127.0.0.1:${VITE_PORT}/app-renderer`)
    await expect(page.getByRole('heading', { name: '通用应用预览' })).toBeVisible()
    const h2Before = await page.locator('h2').first().textContent()
    await page.getByRole('button', { name: '阅读记录' }).click()
    const h2After = await page.locator('h2').first().textContent()
    const switched = h2Before !== h2After
    await shot(page, 'app-renderer-demo')
    record('Q12', '/app-renderer 示例切换', '两个示例可切换，标题随示例变化',
      `标题 "${(h2Before || '').trim()}" → "${(h2After || '').trim()}"`, switched ? 'PASS' : 'FAIL')

    // ================= Mobile pass (390x844) =================
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
    wire(mobile)
    const mOverflow = async () => mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    await mobile.goto(`http://127.0.0.1:${VITE_PORT}/ai-create`)
    await expect(mobile.locator('.hero__title')).toBeVisible()
    const mLanding = await mOverflow()
    const mMascot = await mobile.locator('img[src*="mochi"]').first().isVisible().catch(() => false)
    await mobile.getByLabel('创建方式').selectOption('trusted-fixture')
    await mobile.getByRole('button', { name: '加载离线番茄钟', exact: true }).click()
    await expect(mobile.getByRole('heading', { name: '考试专注番茄钟', exact: true })).toBeVisible({ timeout: 30000 })
    const mGenerated = await mOverflow()
    await mobile.getByRole('button', { name: /C 模式 · 运行应用|C 模式|运行/ }).first().click()
    const timerVisible = await mobile.locator('section.renderer-block--pomodoro output').first().isVisible().catch(() => false)
    await shot(mobile, 'generated-mobile')
    record('Q13', '手机视口（390×844）落地与离线生成', '落地无溢出、吉祥物可见；离线加载后无溢出；C 模式番茄钟计时可见',
      `落地溢出=${mLanding}px；吉祥物可见=${mMascot}；加载后溢出=${mGenerated}px；番茄钟计时可见=${timerVisible}`,
      mLanding <= 0 && mMascot && mGenerated <= 0 && timerVisible ? 'PASS' : 'FAIL')
    await mobile.goto(`http://127.0.0.1:${VITE_PORT}/`)
    const mHome = await mOverflow()
    await mobile.goto(`http://127.0.0.1:${VITE_PORT}/app-renderer`)
    const mDemo = await mOverflow()
    record('Q14', '手机视口溢出（/ 与 /app-renderer）', '两页均无横向溢出',
      `/=${mHome}px，/app-renderer=${mDemo}px`, mHome <= 0 && mDemo <= 0 ? 'PASS' : 'FAIL')
    record('Q15', '全程控制台健康（桌面+手机）', 'pageerror=0、console.error=0、资源 4xx=0',
      `pageErrors=${pageErrors.length}，consoleErrors=${consoleErrors.length}，assetFailures=${assetFailures.length}${consoleErrors.length ? '；首条=' + consoleErrors[0].slice(0, 120) : ''}`,
      pageErrors.length + consoleErrors.length + assetFailures.length === 0 ? 'PASS' : 'FAIL')



  } finally {
    if (browser) await browser.close().catch(() => {})
    await vite.close().catch(() => {})
    const closeBackend = () => new Promise(resolve => { backend.closeAllConnections(); backend.close(resolve) })
    await closeBackend()
  }
  const pass = results.filter(item => item.status === 'PASS').length
  const fail = results.filter(item => item.status === 'FAIL').length
  const findings = results.filter(item => item.status === 'FINDING').length
  console.log(`DONE demo-qa: ${results.length} checks (incl. ${findings} FINDING), PASS=${pass}, FAIL=${fail} -> ${results.filter(item => item.status === 'FAIL').map(item => item.id).join(',') || 'none'}`)
  console.log(`Console warnings (informational): ${consoleWarnings.length}`)
  console.log(`Evidence: ${OUT}`)
}
run().catch(error => { console.error('HARNESS_ERROR', error); process.exit(1) })
