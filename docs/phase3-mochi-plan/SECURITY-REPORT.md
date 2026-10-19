# Phase 3 P0 Mochi PlanProvider remediation candidate

Decision: **P0 BLOCKED / READY FOR INDEPENDENT QA**, never READY FOR MERGE or enablement. Formal HTTP route and Workshop provider remain disabled. REAL_MODEL_CALLS=0. No deployment, main push, merge or force push.

## Provenance

- Main/base: `8cfa37f5112adaab1e0adbb4cb4086240111d436` (live GitHub rechecked 2026-10-19).
- Gateway owner Draft PR #53: https://github.com/Nanmuxxx/BlockCraft-AI/pull/53 ; source remote `b9adc757870a7e994dc511b8431be2986bd204dc`, source local `1e74c2aeacdfe0dd4da764454fcb50742908365f`, identical owner tree `667a85b097f81821a2c95d297519fad6ac7f2d03`.
- Owner patch cherry-picked with provenance as `e6d6b904f0ebe90c3d765d841af6c0aac788ed17`; no independent gateway redesign. This candidate includes #53; do not blindly duplicate it when composing later.
- Core implementation/test commit: `b075116ddf7cf8beea0375748e2a5432b99453ef`. Later documentation-only commits may carry this evidence. Final remote candidate SHA is recorded in the Draft PR and QA handoff.
- Isolated branch `phase3/mochi-plan-provider-20261019`. No changes to shared server entry, Engine, Workshop UI, Viewer, ZIP or Docker.

## P0 finding and remediation

The first draft reused the session snapshot across asynchronous project lookup. A revoke during lookup could reach Provider and reserve budget. It was not accepted or enabled. A reauthentication alone also leaves a gap during gateway's reserved-to-fetch microtask.

The candidate now requires an authoritative live admission lease in addition to session reauthentication after project resolution. Gateway owner patch captures the same synchronous guard before durable reserve and immediately before actual fetch. No await separates the last check and invocation. Missing/false/throw/Promise/thenable guards fail closed. Handler also captures its lease function so replacement cannot change its request authority. Exact capability branding rejects older gateway versions that silently ignore the third argument.

Unsent reservation release is explicitly distinguished from sent/unknown usage: not-sent releases money and retains attempt audit; sent uncertain requests halt and retain quota. Final plan authorization ordering is reauthenticate -> resolve -> compare snapshot -> live guard -> send. The Handler only returns a candidate; existing Host Preview/Confirm/CAS remains mandatory.

Authentication has a distinct two-second AUTH_TIMEOUT/504 classification. Whole request deadline remains PLAN_TIMEOUT/504; client cancellation is distinct. An unfinished body is destroyed after flushing its response to retire the upload iterator/socket. Late resolver/lease/response work cannot start a later model call; late leases are released. All errors are public static codes, never upstream secrets.

## Files

Core: `server/mochi-plan/index.mjs`, `trusted.ts`, `build.mjs`, `.gitignore`; `src/integrations/mochi/httpPlanProvider.ts`; `tests/mochi-plan/provider.test.mjs`.
Owner patch: `server/paid-gateway/provider.mjs`, `ledger.mjs`, README; `tests/paid-gateway/admission.test.mjs`, owner security test update and owner evidence docs.
Evidence: this report, INTERFACES.md and `logs/commands.jsonl` plus command logs. Generated build output and node_modules are ignored.

## Measured evidence

40/40 Core tests: loopback real HTTP -> branded gateway -> strict plan -> existing Host Preview with zero Runtime writes -> explicit Confirm/CAS exactly once. Model transport is injected offline. This single suite records **18 mock wire invocations, 0 real model invocations**. Counts from other regression suites are separate and not summed as real usage.

Deterministic P0 probes:

| Boundary | Mock wire calls | Final budget |
| --- | ---: | --- |
| Held project resolution, session revoked before release | 0 | no entries |
| Live lease rejected before gateway reserve | 0 | no entries |
| Revoked inside durable reserve | 0 | one not-sent, retained money 0, attempt retained, not halted |
| Revoked at final pre-fetch check | 0 | one not-sent, retained money 0, attempt retained, not halted |
| Lease invalidated after reserve | 0 | not-sent, no network |
| Resolver timeout/client disconnect | 0 | no entries |
| Late lease acquisition after deadline | 0 | no entries; lease retired once |
| Final project/authorization change after response | 1 | settled/retained; no returned executable plan |
| Unknown sent failure/late response timeout | 1 | uncertain+halted, no refund |

The gateway owner's independent ordered-probe test asserts exactly check/reserve/check/fetch, microtask revocation, abort before fetch, no reset of six attempts, not-sent reopen, forged release rejection and sent synchronous throw remaining nonrefundable. See owner report and combined gateway logs.

## Commands and limitations

Exact commands, UTC times and exit codes: `logs/commands.jsonl`. Plan build, 40 Core tests, root 205, Host 57, TypeScript, frontend build, generation/v2 and 118 provider regressions passed at the recorded code. Gateway subset passed 19 after building prerequisites; full gateway rerun is separately recorded.

An initial gateway command exited 1 because clean worktree lacked generated AppSpec validator (ERR_MODULE_NOT_FOUND). It was corrected by the existing server build; the failed log is preserved as `gateway.log`, and the successful rerun as `gateway-after-build.log`. Early development also exposed an invalid test fixture using valid empty records; that fixture was corrected to genuinely invalid spec entities, without weakening validation. No failure is counted as a pass.

No formal-page browser acceptance, production authentication/project/lease adapter acceptance, container acceptance or paid model generation has been claimed. The route is not mounted and the UI remains unavailablePlanProvider. An async/distributed authority cannot satisfy the synchronous guard with a stale local boolean; a true authoritative lock/epoch lease requires separate security review. Revocation observed after network invocation cannot undo an already-sent request; cancellation aborts it, and uncertain usage halts conservatively. Process crash/persistence uncertainty keeps budget unavailable rather than refunds.

## Required independent acceptance

Agent C must review the exact remote candidate SHA, repeat controlled delay probes and verify default-off, trusted owner/revision, five-command scope, Preview/Confirm/Host CAS and no fallback. Gateway owner must review this composition. Workshop and shared-entry owners must separately supply audited live authority/lease integration and UI lifecycle before any future enablement; Docker owner must package the new trusted generated closure before any proposed deployment. Until independent GO and these prerequisites, Phase 3 P0 remains BLOCKED.

Gateway owner also independently reran this exact Core test suite: 40/40, 18 mock wire invocations, zero real calls, and independently confirmed both gateway production files match its patch. That is a static/Mock composition review, not Agent C acceptance or production lease authorization. Full gateway rerun in this Core worktree passed 28/28 (`gateway-all.log`). No unresolved test failure remains after rebuilding prerequisites; initial failed command remains recorded.
