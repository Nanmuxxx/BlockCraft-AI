# Gallery independent browser acceptance

Result: READY FOR INDEPENDENT QA for covered offline Gallery behavior. Not READY FOR MERGE or production online acceptance.

## Version and ownership

Tested PR #55 code: a5392394b44c1d5702888af6f80e25195a3cc137.
Source tree: e1c05c3f236590c43fe7997624fd9e9056e9b146.
PR base: 8cfa37f5112adaab1e0adbb4cb4086240111d436. Refreshed main at audit: 4a95cae50f772cd242d932cdbd93366381d1df74. No merged-main or newer-Core result is claimed.

Scope follows Issue #57 DECISION 6268988241; ACK 6269036394. Only new tests/gallery-qa/** and docs/acceptance/gallery-qa/** are added. No product source changes. Gallery author retains production files; Core retains AiCreate generation/lifecycle. Author liveness remains UNVERIFIED; no equivalent owner browser report was present at last check.

## Method

Production Vite build served locally; real homepage Gallery link and /ai-create UI. Six shipped offline AppSpec Fixtures, not real AI generation or historical response replay. No Runtime globals, DOM state mutation or injected application state. Node reads shipped fixtures only for expected values. All application edits use browser controls.

Each case checks all six source-labelled cards, selected source label, B optional entity field creation and form/list display settings, C create/read/update/delete, count/sum updates, three B/C round trips, Cancel preserving title/rows/statistics, explicit Confirm replacing project and restoring next fixture initial records without old fields/data, and document horizontal overflow. Task has no metric: N/A. Accounting sums all transaction amounts, not net balance.

| Case | Viewport | B/C CRUD | Metrics | Cancel / Confirm |
|---|---|---|---|---|
| 社团报名 | 1440×900 | PASS | count | PASS / PASS |
| 学习记录 | 1440×900 | PASS | sum | PASS / PASS |
| 健身打卡 | 1440×900 | PASS | sum | PASS / PASS |
| 个人记账 | 1440×900 | PASS | sum | PASS / PASS |
| 任务管理 | 1440×900 | PASS | N/A | PASS / PASS |
| 习惯养成 | 1440×900 | PASS | count | PASS / PASS |
| 社团报名 | 390×844 | PASS | count | PASS / PASS |
| 学习记录 | 390×844 | PASS | sum | PASS / PASS |
| 健身打卡 | 390×844 | PASS | sum | PASS / PASS |
| 个人记账 | 390×844 | PASS | sum | PASS / PASS |
| 任务管理 | 390×844 | PASS | N/A | PASS / PASS |
| 习惯养成 | 390×844 | PASS | count | PASS / PASS |

## Results and exceptions

- Root 206/206 PASS. TypeScript and production build PASS. Browser 12/12 PASS. Chromium 156.0.8078.4; exact dependency/platform versions in environment.json.
- pageerror 0; error-level console messages 0; unexpected requests 0; HTTP >=400 0. Raw local request inventory: browser-report.json.
- Only /api/mochi-ai/status GET is fulfilled offline as disabled. Static requests use local preview. Other API/external requests are blocked and fail the run. Real model calls 0; generation POST 0.
- 50 original full-page PNGs. Image height can exceed viewport; actual browser viewport is exactly 1440×900 or 390×844. SCREENSHOTS.md indexes stage and SHA-256.
- Visual observation: 390px accounting/list tables wrap dates and text aggressively when multiple columns are enabled. No document horizontal overflow; controls operable and assertions passed. Mobile readability remains a UX follow-up.
- Dialog focus trap/Escape, real-provider auth/budget/CAS, late generation responses, ZIP download/build and latest Core integration NOT TESTED in this Gallery assignment. Historical results do not upgrade these to PASS here. Mochi remains disabled.

## Reproduce

Use an isolated checkout at tested code SHA, copy tests/gallery-qa/browser.cjs there, then npm ci, npm test and npm run build. Install the exact Playwright version from environment.json into a separate temporary prefix; install its Chromium. Set NODE_PATH to that prefix/node_modules and run node tests/gallery-qa/browser.cjs. Port 5205 must be free. The harness overwrites this evidence directory. commands.json records actual commands and exit codes.

Evidence-only PR is stacked on feature/demo-gallery; depends on #55. It adds no Gallery product changes. Distinguish tested code SHA from evidence commit. Keep PRs Draft. No merge, deployment, public switch, credentials/permissions/budget/ledger change or paid call occurred.

