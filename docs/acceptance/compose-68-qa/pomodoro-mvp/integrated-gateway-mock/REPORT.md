# Independent QA: actual Gateway / Mock upstream

Tested exact product commit: `e09a3d619719f9fb77e768e67ea5967f4a143dc4`.
Base main: `4a95cae50f772cd242d932cdbd93366381d1df74`.
Scope: owner-local-smoke combo; this is not main, production, live DeepSeek, or public deployment acceptance. Product candidate was a local committed SHA at test time. `current-snapshot.json` records source and rebuilt assets; no product files were edited by QA. The first run used checkout `1c44518058371afdd5d53ee27eb15b4d147a5f3b`; its separate logs are historical, not the final exact-SHA results.

## Result

**GO for the tested offline Pomodoro integration. NO-GO for claiming live AI, a green full regression, or public/production readiness.** Any owner-controlled live trial is a separate Supervisor/Tech Lead decision; QA neither starts it nor treats Mock provenance as model output.

- Frontend TypeScript/Vite, server TypeScript and generated protocol build: PASS.
- Four specified files: 24/24 PASS (`current-targeted.log`).
- Complete paid-gateway suite: 38/53 PASS, **15 FAIL** (`current-gateway-full.log`). No failures filtered or silently repaired.
- Browser: 1440x900 and 390x844 PASS, Chromium headless. Actual launcher and HttpOnly/Strict cookie, actual HTTP principal Gateway/sidecar/durable temporary ledger; only provider fetch is synthetic. Each viewport: 3 Mock requests, 3 settled entries, paidCalls=0. Each run gets a fresh temporary synthetic state directory, never the owner's real ledger.
- Browser page errors and external requests: zero. Node fetch denies non-loopback calls. No real secret, owner Terminal environment, real state, or sensitive log was read.

## Scenario matrix

| Check | Exact-SHA result | Evidence / limit |
|---|---|---|
| Anonymous generation | PASS 401 | Browser script before bootstrap |
| Cookie bootstrap | PASS | HttpOnly, SameSite Strict, invisible to document.cookie |
| New natural-language UI -> v2 HTTP -> principal Gateway -> AppSpec | PASS Mock | No localStorage fixture injection; output is synthetic `pomodoro.json` |
| B display and selection | PASS | One block; selected inspector shows duration1500 and protocol1 |
| B parameter editing | NOT SUPPORTED | Current Pomodoro inspector is read-only; no edit PASS claimed |
| Entity/field binding | N/A for Pomodoro | Timer intentionally has no data entity; no CRUD claim |
| C start / pause / reset | PASS | Below25:00 after1.2s; pause stable1.1s; reset25:00 |
| B/C state retention | PASS | Paused remaining time retained across switch |
| Invalid generated schema | PASS Mock | Error displays previous app/data retained; timer remains25:00 |
| Third allowed request | PASS200 | Provider count3, settled ledger entries3 |
| Repeated key after call cap / fourth unique key | PASS429 | Admission gate BUDGET_EXHAUSTED precedes sidecar; no fourth egress/reservation |
| Gateway idempotency/restart/timeout/disconnect/concurrency/expiry | PASS targeted | principal-runtime, principal-smoke, smoke-profile; isolated Mock tests, not all browser cases |
| Timeout/provider failure retaining UI | Not rerun in this actual-Gateway browser | Prior separate harness evidence exists in parent report; do not transplant it to this exact path |
| ZIP | NOT RECHECKED this run | Pomodoro explicitly unsupported by inspector; prior report verifies refusal. No independent Pomodoro build claim |
| Live model / public deployment | NOT VERIFIED | paidCalls0 |

Screenshots: `current-desktop/b.png`, `current-desktop/c.png`, `current-mobile/b.png`, `current-mobile/c.png`. They are full-page captures taken with the stated viewports. Model label in the UI reflects branded transport; it does **not** prove a live model request. QA inspected desktop B and mobile C visually; controls fit the390px width, but the long stacked page requires scrolling.

## Failures and reproduction

**P1 regression coverage / release blocker:** full Gateway remains red in audit-boundary(4), model-policy(2), runtime-integration(2), security(7). Examples: expected UPSTREAM_CANCELLED/USAGE_UNRELIABLE but REQUEST_INVALID occurs before the intended behavior; legacy runtime composition also fails. These are consistent with stale request/policy contracts (8192/old runtime) in several tests, but this run does not prove every failure is harmless. Owners must align the tests and retest; do not disable assertions merely to turn them green.

Reproduce in the exact candidate: build server protocol, then `node --test tests/paid-gateway/*.test.mjs`. Full unfiltered log includes file/line and stack for every failure. Initial older snapshot: 36/53 and generation suite failed then hit120s timeout; retained `gateway-full.log` and `generation-full.log`, not counted as current-SHA success.

**QA assertion correction (resolved):** initial added test expected409/503 after three launcher admissions. Actual gate returns429 before sidecar. Original `desktop-initial-assertion.log` and `mobile-initial-assertion.log` retained. Corrected test checks429/BUDGET_EXHAUSTED and unchanged provider/ledger counts. Gateway duplicate rejection is separately covered by targeted tests; this is not cached-result replay.

**P2 scope limitation:** B Pomodoro configuration is display-only and ZIP is unsupported. If acceptance requires editing timer duration or exporting this timer as a standalone project, it remains unmet; no product expansion was made by QA.

## Safe reproduction

1. Freeze the exact candidate into a separate checkout, install existing dependencies, and make Chromium1248 available. Do not start the secret wrapper or load owner env/state.
2. From this evidence directory execute `QA_SNAPSHOT=/absolute/frozen/checkout python3 run-exact.py`. Update only the QA script's Chromium executable path if necessary. Port3229 must be free.
3. Runner uses a fresh HOME and environment allowlist, synthetic key, temporary state, loopback-only native fetch guard and browser routing. It builds assets/protocol, executes specified tests plus the full Gateway suite, then browser checks sequentially. Read `current-run-results.json`; the full suite intentionally records its nonzero result and continues to browsers.
4. Compare source/build hashes in `current-snapshot.json` before attributing results to another commit. This combo SHA must be published by Supervisor for cross-machine reproduction; evidence publication alone does not publish the product candidate.

## Historical scenarios / dependencies

Task/club recorded-real-response replay and fitness/learning/accounting hand-authored fixtures were completed in earlier real-loop QA and reported at #57 comment6268822157. They are **not** live AI and were not rerun under this Pomodoro combo. Earlier evidence PR#69 remains separate and version-bound.

Next: Core/Gateway align failing regression contracts; Supervisor publishes the exact product candidate; owner/Supervisor separately performs any authorized live trial and supplies non-sensitive results. QA reads #57 on demand before tasks and reports milestones there. Automatic polling/wakeup is NOT CONNECTED. No merge, deployment, real paid call, secret change, or real ledger reset occurred.
