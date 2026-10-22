# D2 — PR61 initial independent joint acceptance

Tested product SHA: 9b0e715a71afb40d93151fe99c948f78e770ec61.
Base: 4a95cae50f772cd242d932cdbd93366381d1df74.
Node v24.22.0, macOS arm64; browser Chromium156.0.8078.4/Playwright1.64.1.
DECISION: Issue57 comment6270371611. No product edits. REAL_MODEL_CALLS=0.

Commands: npm ci; npm --prefix server run build; node tools/project-zip-export/prepare.mjs (all exit0).
node --test tests/generation/real-loop-ledger.test.mjs => exit1 (5 PASS,1 FAIL), raw ledger.txt.
NODE_PATH=<Playwright runtime>/node_modules GENERATION_QA_OUTPUT=<output> node tests/generation/real-loop.browser.cjs => exit0, raw browser.txt/browser-report.json.
Files browser.exit/ledger.exit preserve actual exit code. Generated validator missing in first browser setup was repaired with prepare.mjs; not a product failure.

Actual private mkdtemp synthetic ledger + real loopback HTTP + injected Mock fetch:
-401: zero reservations/egress.
-Six successes: six settled entries; seventh503 BUDGET_EXHAUSTED, zero additional egress/reservation and unchanged disk state.
-Timeout ignoring abort:504 AI_TIMEOUT, one uncertain reservation+halt; retry503 BUDGET_HALTED without extra egress.
-Disconnect: real client socket destroyed; upstream signal aborted; uncertain+halt; shutdown then reopen works.
-Shutdown: never-settling Mock ignoring abort, drain120ms;21 LEDGER_LOCKED probes; handlers finish with uncertain+halt before lock reopen succeeds. Request wrapper abort racing does not wait indefinitely for Mock producer Promise.
-OS child: full startServer+runtime+ledger; SIGTERM starts drain, then SIGINT+SIGTERM; OS exits by SIGTERM, COMPLETE absent. Test FAIL. Stale synthetic lock intentionally retained and not deleted/reset. This is the known P1 lifecycle blocker (D1), not a production incident.
-Identical Idempotency-Key submitted six times produces six calls/reservations: explicit negative evidence, NOT IDEMPOTENT; test passes because it asserts current absence, not feature readiness.

Browser: five scenarios x two required sizes all pass with new budget expectation503. Sources remain todo/club historical real-response replay plus fitness/learning/accounting handwritten fixtures, never live-model PASS. CRUD, metrics, three B/C rounds and failure preservation verified. These browser fixtures do not substitute for actual ledger assertions above. No ZIP source delta relative main; no broad independent ZIP rebuild repeated. Existing harness still validates actual UI downloads/snapshot content.

Current result: PARTIAL / NO-GO for initial candidate due real OS multi-signal drain failure. Await Core D1 unique fixed remote SHA and rerun same independent ledger/child test; only that SHA may receive final candidate verdict. Remote165e429 source inspected while running still had first-signal listener removal; not accepted as D1 fix.

Scope only tests/generation/real-loop* and docs/acceptance/real-loop-qa/**. No owner worktree tested; no merge/deploy/live API/real-ledger/secret/permission changes.
