# Core signal-fix independent QA

Product: `63a4ab2b65b9ffba72875a383a4ad82f472725fe` (Core #61), base `4a95cae50f772cd242d932cdbd93366381d1df74`.
Run: 2026-10-19 UTC; Node 24.22.0, macOS arm64, Chromium 156.0.8078.4, Playwright 1.64.1. Isolated detached checkout. Only QA-owned tests/evidence added. Live model calls: **0**.

| Scenario | Provenance | 1440x900 | 390x844 |
|---|---|---|---|
| Task management | PR44 recorded real response replay | PASS | PASS |
| Club registration | PR44 recorded real response replay | PASS | PASS |
| Fitness | Hand-authored Fixture | PASS | PASS |
| Learning | Hand-authored Fixture | PASS | PASS |
| Accounting | Hand-authored Fixture | PASS | PASS |

Every case validates AppSpec, B selection/add optional field/display binding, C CRUD, count/sum/average, three B/C round trips, and state preservation after provider failure/invalid spec/timeout/401/injected budget503. These are offline replay passes, **not live model passes**. The browser uses createAppServer Mock provider, not the final paid principal composition. Gateway ledger tests are separate.

Independent actual HTTP/private temporary ledger: 6 tests pass. OS child receives SIGTERM then SIGINT+SIGTERM; exit0, signal null, COMPLETE observed, 38 lock probes; no early release. The old 9b0e715 signal failure is fixed in this tested SHA. Unauthorized zero reserve/egress; six success settlements then503; timeout504 and disconnect abort -> uncertain+halt; shutdown retains lock. Identical Idempotency-Key still causes six reservations/egress: this negative assertion passing is **not idempotency readiness**.

Five downloaded sample ZIPs independently installed/built outside checkout after byte equality of fixed executable scaffold: 5/5 PASS. See zip-sample-builds.json. AppSpec data is JSON, never executed as supplied TS.

Canary browser rerun: PASS (266 text response bodies,282 headers,10 DOM,150 ZIP entries,56 console messages); report copied as canary-browser-report.json. Canary is a synthetic offline API credential. Does not cover final principal contract or hostile upstream echo. Server build and Vite build PASS; build with synthetic DEEPSEEK_API_KEY then scan9 dist files,11 build logs,150 exported files,15 independently-built export dist files: no canary. Docker image check BLOCKED: docker unavailable. Screenshots show rendered DOM, not an independent binary OCR secret scan.

Reproduce from exact detached product SHA after applying only real-loop QA tests and source-pr44 data:

```sh
npm ci
npm --prefix server run build
node tools/project-zip-export/prepare.mjs
node --test tests/generation/real-loop-ledger.test.mjs
GENERATION_QA_OUTPUT=docs/acceptance/real-loop-qa/core61-signal-fix NODE_PATH=<playwright-node_modules> node tests/generation/real-loop.browser.cjs
GENERATION_QA_OUTPUT=docs/acceptance/real-loop-qa/core61-signal-fix node tests/generation/real-loop-zip-build.mjs
REAL_LOOP_SECRET_CANARY=synthetic-qa-canary-63a4ab2-not-a-secret GENERATION_QA_OUTPUT=docs/acceptance/real-loop-qa/core61-canary NODE_PATH=<playwright-node_modules> node tests/generation/real-loop.browser.cjs
DEEPSEEK_API_KEY=synthetic-qa-canary-63a4ab2-not-a-secret npm run build
REAL_LOOP_SECRET_CANARY=synthetic-qa-canary-63a4ab2-not-a-secret node tests/generation/real-loop-artifact-scan.mjs
```

Raw logs and actual exit files accompany this report. Browser evidence:28 screenshots (full-page captures at specified viewport); screenshots indexed in SCREENSHOTS.md. Mobile accounting table wrapping remains P2 readability issue: generate accounting390, create expense, observe date/text split across lines.

SECRET-2 final target BLOCKED: 63a has no sidecar/principal integration. Known c1c7df0 repro: open sidecar a/b against same ledger/directory/bindingKey; a.reserve same principal/key/payload; settle; b.reserve succeeds -> ledger entries2/claims1. Required independent final-SHA regressions: same-ledger multi-handle; same-directory multi-ledger; alias paths; close/reopen; mismatch/corruption/write failure; concurrent/restart max one reserve/egress. Do not mark older prototype or current boolean identity as final PASS.

Verdict: **GO offline UI/ZIP/lifecycle only; production/secret injection NO-GO**. Await fixed final Core/Gateway composition, image and Studio/POSIX/permissions evidence, independent Tech Lead and owner approval. No merge/deploy/live call/key/real-ledger or permission change. No automatic QA issue poller/wakeup connected.

Coordination: https://github.com/Nanmuxxx/BlockCraft-AI/issues/57#issuecomment-6271253123
