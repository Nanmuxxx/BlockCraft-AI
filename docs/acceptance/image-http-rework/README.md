# PR98 R1/R2 rework — developer evidence, independent re-verification pending

Original main/base `bcb6c1a7402ad4b4514feb4865c38d769d7244d1`; original PR98 HEAD `f325e2fc9f9574fdead27ed7265e851a93cbd849`. Fresh fetch/PR metadata confirmed these unchanged and worktree clean before editing; original feature branch retained. Read [independent QA6463584665](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-6463584665) and [REWORK6463610981](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92#issuecomment-6463610981). This author is the original implementation agent, not independent QA. No ACCEPT issued.

Functional commits: R2 `5041f56` and R1 `d4fec9ff07d239dc66de0b51ff8d8d6680706aa2`. Subsequent evidence-only commit preserves these tested sources; final published SHA and actual CI links are in PR98/#92 [REPORT][REWORK FIX]. Original #94/#96 commits and provider.ts remain unchanged.

## R1 — final warning and dispatch latch

`http.ts` now preserves `HttpReviewRequired` with safe request/job IDs and a distinct UNCERTAIN state. A local unresolved-operation latch is stored **before POST**, containing opaque IDs only (no prompt, image, credential). Controller/UI subscribe to it; cancel, project/controller remount, source changes and page refresh cannot erase the unresolved warning or create a fresh key. Ordinary generate is disabled, and direct provider/controller calls also refuse a new dispatch while locked. Existing project/resources stay unchanged; no automatic adoption/retry.

Final DOM: `任务/费用状态未确认（UNCERTAIN）；核对前不要重新提交。任务 ID：…；请求 ID：…` (UNKNOWN uses the same warning without falsely claiming a verified terminal state). Unknown create response displays `任务 ID：未取得` plus the original request ID. Source selection remains disabled while unresolved; refresh restores the HTTP warning.

Explicit “核对原任务状态（不重试）” sends GET only, through existing server identity/project checks; it clears the same operation only on verified SUCCEEDED/FAILED/CANCELLED + NONE. It never adopts/retries a recovered result. UNCERTAIN, running, revoked/403, missing/404, expired/410, malformed/network responses remain locked. Lost cancellation acknowledgement does not unlock. No job ID => no invented key lookup/replay/reset; button stays disabled, operator reconciliation required. No administrative settlement/reset capability or production authority is invented.

Before: `REWORK_EXPECT_BEFORE=1 GALLERY_SOURCE_ROOT=/tmp/blockcraft-pr98-r1-before-rework ... node tests/image-http-integration/rework.browser.cjs` serves the original literal f325e2f frontend from a detached worktree while injecting real loopback settlement failure. `logs/r1-before.log` records generic final alert, enabled generation, create count2, no candidate. Exit0 means defect reproduced, not acceptance.

After: new actual DOM suite at1440 and390px covers UNCERTAIN, lost create response/unknown job ID, lost cancel response, unknown-job GET404, and poll network interruption. Every unresolved case retains final warning/IDs, zero candidate/adopt controls, unchanged JSON/storage; repeated disabled UI clicks and direct provider calls leave create POST count1. UNCERTAIN/404 reconciliation does not unlock; revoked GET403 does not unlock; restored authorized GET confirming CANCELLED/NONE unlocks without POST/adoption. Reload/remount protection verified. Successful responses always use real loopback handler; routing injects connection loss or redirects a query to an actual missing resource, never fabricated image success.

## R2 — actual execution ownership

Coordinator accepts only branded `createIsolatedMockProvider` execution; arbitrary in-process generate closures are rejected IMAGE_DISABLED. Its default worker imports/reuses original #94 fixed Mock provider; injected faults are trusted server-side fixture modules, never a client-selected module. Environment and preload args are not inherited. Each task owns one Worker with JS heap/stack limits. Result/error/cancel/deadline all stop that Worker. Generate settles **only on the real exit event**, so the coordinator's existing finally releases capacity only after the owned execution has exited. No Promise.race/early count decrement, lost tombstone or duplicate dispatch.

A2000ms termination guard marks the provider blocked and rejects new admission if native termination cannot be confirmed; it does NOT resolve generate, remove active workers or free running capacity. close() returns bounded `{closed:false,blocked:true}` in that condition. This uncommon native failure path is fail closed; no simulated success/recovery claim. Normal terminate/exit recovery is independently executable via the tests below, with running/active/spawned/entered/exited/highWater counters available only to the server-side fixture (no added HTTP resource endpoint).

Before: original f325e2f handler,4 permanent Promises ignoring abort, deadline80ms; both cancel and timeout probes wait200ms then fifth new key429 CAPACITY. `logs/r2-before.log`, exit0 defect reproduction. Four starts/four aborts; no resource release existed.

After CI tests (`isolation.test.mjs`, per-test10s and CLI10s bound): four trusted worker providers each enter a **permanently pending, abort-ignoring** generate; fifth initially429. Separate all-cancel and all-timeout cases confirm4 worker exits, active=running=0, spawned=exited=4, highWater4, no settlement/image on old jobs, original key IDs/tombstones replay unchanged, duplicate cancel stable. Fifth new task then202→SUCCEEDED, total spawned=exited=5, active0, exactly one settlement. Additional CPU-loop worker is actually terminated; naked unresolved closure rejected. `logs/contracts.log` includes resource snapshots. Cleanup is bounded and asserts closed=true.

Worker ownership is **not an OS sandbox** for malicious code, arbitrary native/subprocess/network transports or a paid-operation cancellation/refund guarantee. Only trusted MOCK modules are supported. Future general provider safety, image authorization, persistent ledger, moderation and supplier normalization remain blocked. This change must not be used to authorize real egress or claim child-process cleanup beyond its worker-owned fixture scope.

Reference checked: [Node24 Worker.terminate](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#workerterminate) describes asynchronous termination and exit completion; current code/test await actual exit instead of interpreting AbortSignal as termination.

## Actual regression and environment

All18 commands in `logs/results.json` exit0 on exact functional HEAD `d4fec9ff07d239dc66de0b51ff8d8d6680706aa2`, start/end SHA equal. Darwin arm64/macOS26.6, Git2.50.1, Node24.22.0/npm11.19.1/TS5.9.3, isolated Playwright1.62.1/Chromium151.0.7922.34. Browser environment: `NODE_PATH=/tmp/blockcraft-workshop-browser-tools/node_modules`, `GALLERY_EXPECTED_SHA=d4fec9ff07d239dc66de0b51ff8d8d6680706aa2`, fresh contexts (no personal storage).

- OFFLINE: `node node_modules/typescript/bin/tsc -b`; server and image-provider tsc configs; `VITE_IMAGE_HTTP_FIXTURE=1 npm run build` (existing bundle warning).
- OFFLINE/MOCK/HTTP MOCK: `node --test --test-timeout=10000 tests/image-backend/provider.test.mjs tests/image-http-contract/*.test.mjs` =>25 (original21 +4 R2 regressions).
- MOCK: `npm --prefix server test` =>37; `npm run test:generation` =>144. OFFLINE `npm test` =>224.
- OFFLINE: prepare export; JSON/ZIP/custom-block/export117; ZIP browser4. Exact commands in results.json.
- HTTP MOCK: original desktop27/mobile390px27 plus new final-DOM5/5; default fixed Mock16 and Canvas14. External/page errors0; screenshots visually inspected for warning/ID wrapping and disabled controls.
- OFFLINE production-disabled browser: build even with VITE_IMAGE_HTTP_FIXTURE=1, HTTP option absent, create/get/cancel404, real upstream0.
- CI updated to execute25 bounded provider/contract/isolation tests and both new DOM widths in addition to original modes/production-disabled. New DOM runner has180s overall watchdog. Actual final-head CI results must be read, not inferred from local or old CI.

Evidence JSON and representative final-DOM screenshots are in `evidence/`. Historical initial Phase2 manifests/logs describe f325e2f and are superseded for these two defects. New source manifest binds changed integration/test files; no assertion that the old222-file manifest remains current.

## Tooling/test correction

Initial GitHub ACK call timed out (outcome unknown); a complete read of #92 confirmed absent before one later successful ACK6464202084. No blind duplicate write or credential access. New DOM runner initially tried selectOption on the correctly disabled, already-selected HTTP mode after refresh: exit1 `TimeoutError: element is not enabled`, full `logs/r1-first.log`. [Playwright actionability](https://playwright.dev/docs/actionability) confirms selectOption waits for enabled. Fixed test only to read current selection and select only if needed; did not weaken the UI guard. Both final widths pass. Log trailing whitespace normalized; error/exit content retained.

## Independent re-verification and limits

Fetch final Draft HEAD, verify ancestry and new CI. Re-run25 tests (inspect real exit counters/fifth admission), original HTTP27 and new DOM5 at both widths, fixed16/Canvas14/ZIP4, storage/resource117, types/build/server and production404 checks. Inspect final DOM after UNCERTAIN and response loss/reload, direct re-entry guard, request count and unchanged candidate/project. Review native-termination fail-closed behavior and unknown-ID operator-only recovery. Record separate QA identity, exact SHA, commands/exits; independent QA decides ACCEPT/REWORK/BLOCKED. This implementer stops after reporting.

No merge, deploy, production image route, REAL model, key/permission/budget changes. Rollback keeps Draft unmerged or reverts only the two rework commits after review; adopted PNG/schema/history remain compatible. Do not remove tombstones, reset a budget or clear unresolved IDs as a workaround.
