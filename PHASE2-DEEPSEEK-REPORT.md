# Phase 2 — Real DeepSeek Secure Generation

2026-10-19 (Asia/Shanghai). Result: **two real natural-language applications generated and operated in formal B/C**, with no generated TSX execution. No merge, deployment or Force Push.

## Baseline and Scope

Real-call baseline main: `25773e6d65e4e5a2b29d125baa2510f4a10aa343`. Publication-time GitHub main verified as `b56a26a9803718d806bac3ddbd7fbe19e0c495c6`; merged without changing deployment files, then revalidated offline. Independent worktree: `BlockCraft-AI-phase2-real-deepseek`; branch `phase2/real-deepseek-secure`. The previous Agent B ZIP worktree is untouched. PR #40 was inspected at `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc` (open Draft); its Runtime is not modified or cherry-picked. The main branch already supplies strict v1/v2 validation and the formal v1 route used here.

Owned additions: `server/paid-gateway/`, `tools/real-deepseek/evaluate.mjs`, `tests/paid-gateway/`, response samples and evidence. Minimal shared-entry patches add server authentication, production egress guards and accurate controlled-transport provenance. Core Integration Lead (Agent A chat) was sent the ownership/interface coordination message before live testing. No Runtime, Mochi modification engine, Viewer, ZIP or Docker files changed.

## Safety Boundary

Three Provider entry paths were found: legacy/trusted generation in `server/index.mjs`, CustomBlock `provider.mjs` / `live-generate.mjs`, and Mochi advisory `provider.mjs`.

- v1 **and** v2 generation now require a trusted server identity callback; default denies before body processing or Provider invocation. CORS/Origin/Host/XFF/body flags cannot authenticate.
- The local evaluator generates a random 256-bit bearer token, authenticates loopback peers using constant-time hashed comparison and injects the token in its server-side loopback Vite proxy. Token and key never enter the bundle, query string, saved samples or logs. Any process on the operator's computer can access the local evaluator while it runs; this is a controlled single-user test mechanism, not multi-user or public-site authentication. It shuts down after evaluation.
- All three native Provider transports fail closed unless trusted server code injects a controlled transport. Ordinary production startup does not enable the paid route. CustomBlock/Mochi are not activated by the evaluator. Injected offline transports remain possible for tests; server-code injection is a trust boundary, not an HTTP option.
- The actual paid adapter fixes HTTPS endpoint `https://api.deepseek.com/chat/completions`, model `deepseek-flash`, JSON mode, no tools, thinking disabled, max_tokens <=8192, concurrency 1, timeout <=30 seconds, zero retries and rejected redirects. Connection and body reads are deadline/cancellation bounded, including transports that return late.
- API key is read in memory from the existing server-only primary-repository `.env`; it is not copied or printed. No key was requested in chat. All tests use synthetic secrets and temporary ledgers.

Anonymous legacy and v2 (including no Origin) returned 401 with zero Provider calls in unit tests and before the live evaluator opened its UI. Forged Origin/Host/XFF/approval fields, wrong bearer, missing adapter, throwing adapter and late identity all fail closed. Provider tests cover concurrency, endpoint/model/input/output limits, unknown usage, HTTP/JSON/body failures, timeout, cancellation and late replies. Key content is absent from saved evidence.

## Price and Shared Budget

Official CNY prices verified on 2026-10-19: [DeepSeek pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/). Flash peak/cache-miss input ¥2 per million tokens; peak output ¥8 per million. Cheaper cache/off-peak rates are deliberately ignored. [Official API documentation](https://api-docs.deepseek.com/api/create-chat-completion/) confirms explicit thinking disablement and max_tokens. The pinned price snapshot expires before the next day; later calls require a reviewed price update.

User authorization: ¥10 shared total, ¥8 automatic stop. This implementation is stricter: **¥1 total retained reservations, six attempts maximum, no automatic repeat live run**. Every reservation must fit all ¥1/¥8/¥10 thresholds. The canonical private ledger is shared by worktrees under the workspace parent, with mode 0700 directory/0600 files, an exclusive process lease, atomic replacement and fsync before network. Crash/stale leases are not automatically recovered. Unknown/missing/out-of-bound usage or uncertain timeout/cancel/network results halt future calls. Reservations are never refunded, including on failure. Audit stores hashes, limits, usage and money; no prompt text or key. No other Agent was authorized to call under this Phase 2 run; this ledger records the only two calls executed here.

| Real Call | Prompt Tokens | Completion Tokens | Total Tokens | Peak-Rate Estimate | Retained Reservation |
|---|---:|---:|---:|---:|---:|
| Personal todo | 1,381 | 237 | 1,618 | ¥0.004658 | ¥0.094198 |
| Club registration | 1,401 | 253 | 1,654 | ¥0.004826 | ¥0.094414 |
| Total | 2,782 | 490 | 3,272 | **¥0.009484** | **¥0.188612** |

Both entries settled with trustworthy usage. Conservative remaining authorization: ¥9.811388 (¥10 minus retained reservations); before the requested ¥8 stop: ¥7.811388; stricter internal ¥1 allowance: ¥0.811388. These figures are audit estimates/retained accounting, **not a supplier balance or invoice**. A repeat `--live` refuses a nonempty ledger; no more live calls are planned.

The input reservation is UTF-8 message bytes plus 8192 framing tokens, charged at peak/cache-miss prices, with finite output tokens. This is a conservative engineering bound, not a tokenizer proof or supplier-side monetary hard limit. Software cannot guarantee supplier price/accounting behavior or unrelated account usage. The ¥1 cap, no refunds, unknown-usage halt and refusal to auto-repeat provide substantial margin under the ¥8/¥10 authorization. No supplier hard-limit claim is made.

## Real Samples and Results

Evidence root: `docs/acceptance/phase2-deepseek/`. Only synthetic requirements and synthetic test records were sent; no real personal records.

| Requirement | Real Model Result | Functional Result |
|---|---|---|
| Personal todo with title, due date and done flag | `todo.response.json`, v1 `personal-todo`, text/date/boolean fields | Strict schema/completeness PASS; actual formal B/C CRUD and edit cancel PASS |
| Club registration with department, interview flag and total count | `club.response.json`, v1 `club-registration`, text/select/boolean fields and exact requested departments | Strict schema/completeness PASS; actual formal B/C CRUD and count display PASS |

Sanitized response SHA-256:

- Todo: `1dbe4fc23b93d5f7075e311350eea12d1dafb884f0c831e9cd2ea7ba5d972de2`.
- Club: `348bb62c3c24ad87029b40e3390a0a870c2a6925aef80ce517b96cd74da1ca14`.

Samples contain only model identifier, assistant content, finish reason and allowlisted usage; upstream headers, account identifiers and reasoning text are omitted. SHA identifies this sanitized evidence file, not an unmodified provider wire body. Requirements, request hashes, timing and usage correlate with the private durable audit copied into `live-browser.json`.

These responses were not replaced by fixtures or repaired in code. Their fields and options differ according to the actual requirements. Both happen to include form/list/count; this establishes two valid simple data applications, not universal capability or semantic completeness for every request. Todo additionally supplied an unrequested task count; harmless but a quality limitation. A v1 data form is never described as a real timer.

## Formal Browser Verification

`live-browser.json`: Chromium 156.0.8078.4, actual `/ai-create` and unchanged formal UI/Runtime, no QA transforms or runtime introspection. Two 1440px generations traverse UI → authenticated proxy → real DeepSeek → strict server validator → Runtime → B → C. Each 390px case replays that exact recorded model envelope through the same server validation and UI, with **zero additional paid calls**.

All four scenario/viewport cases check required-field errors, Create/Read/Update with unchanged row count, cancel editing, B/C record retention, deleting an active edit, empty state and no iframe/generated TSX. Local-only HTTP failure, invalid-version response, cancel and late completion probes preserve existing records; these are explicitly intercepted responses, not real paid failures. Unit tests separately cover real adapter timeout/body/cancel/late handling with fake transports and v1/v2 version boundaries. The page displays the original legacy “unverified model source” label because core UI provenance display is outside this patch; the server audit supplies actual provenance.

`replay-browser.json` reruns all four cases without credentials or any live call. Screenshot files `todo|club-1440|390-b|c.png` show the real returned applications; representative desktop/mobile C screenshots were visually inspected. Replay does not overwrite the preserved live report. Earlier offline smoke failures were evaluator issues (fault probes consumed normal rate limits), fixed by explicitly intercepting fault probes without weakening server limits. Only the final passing smoke run is preserved; no failed live call was retried.

## Validation and Reproduction

- Initial focused Provider/generation/security regression: 184/184 PASS (`provider-regression.txt`).
- Final paid-gateway plus preserved-real-sample tests: 14/14 PASS (`final-security-tests.txt`).
- Root tests: 194/194 PASS (`root-tests.txt`); root TypeScript/Vite build PASS (`root-build.txt`).
- Offline smoke and recorded-response Chromium runs: both two scenarios × two viewports PASS, zero real calls.
- Anonymous live preflight: v1/v2 401, no egress; real completed calls: exactly two.

Reproduce offline after dependencies and a local Chromium are available:

```sh
npm --prefix server run build
node server/custom-block/build-protocol.mjs
node --test tests/paid-gateway/*.test.mjs
node tools/real-deepseek/evaluate.mjs --replay
```

Playwright can be supplied through the developer's existing test runtime/NODE_PATH; browser profiles remain temporary. `--smoke` uses fixed local fixtures and never reads credentials. `--live` is deliberately opt-in and refuses the already-used ledger. Do not delete/reset the ledger or remove a crash lease to gain more calls.

## Delivery and Remaining Work

Local commits: `68ab456` security gate/budget/adapter; `bdf6703` evaluator and offline preflight; following evidence commits retain real results and this report. Draft PR and final remote SHA are supplied in the final handoff; Git API publication may regenerate commit metadata, with exact content-tree comparison.

Limitations: live v2/pomodoro generation was not attempted; main's formal UI currently offers v1 or an explicitly offline fixed timer. This branch does not alter PR #40 Runtime/UI to open v2. Public multi-user authentication, supplier account reconciliation/hard limits, account persistence and real Mochi/Viewer integration are not implemented. No production endpoint is enabled by this local test. Core Lead should review the minimal `generationAccess`/egress seams and packaging of the new server modules before integration. Mochi/Viewer may reuse sanitized v1 responses as data fixtures, not as executable TSX or permission to call DeepSeek. No further paid optimization calls are needed for this delivery.

## Latest-main and Core Integration Handoff

Local merge `252365e` incorporates #35 main `b56a26a` and preserves its static path protections, SPA paths, PUBLIC_ORIGIN and production listener behavior. Latest-main TypeScript/Vite build PASS; focused server/generation/gateway regression **67/67 PASS**; recorded real-response Chromium B/C replay PASS for both applications at 1440/390, **zero paid calls**. Evidence: `latest-main-build.txt`, `latest-main-tests.txt`, `latest-main-replay.txt`. Original live screenshots and two-call audit remain preserved.

Core integration uses a separate exact patch `docs/acceptance/phase2-deepseek/core-entry-composition.patch` against PR #42 HEAD `764f2dd023d3e3ca54af755f6291e142e0ccb915`. It changes only `server/index.mjs`, combining #35 static/PublicOrigin with #40 strict envelopes/UTF-8/abortable reads and complete admission AbortController/close listener/signal/finally cleanup/disconnected-peer checks, then adding identity and controlled egress/provenance. The Core candidate worktree was not edited. A temporary detached composition passed **66/66** gateway/server/ingress/trusted-admission tests (`core-entry-tests.txt`), including disconnects during access/budget and late upstream cancellation. Temporary offline harnesses explicitly inject identity; the mocked input-timeout test flushes two event-loop turns after first data before advancing its deadline, so asynchronous authentication has completed. These are focused composition results, not the Core Lead's full integration acceptance.

Shared-entry ownership and exact patch/dependency paths were handed to the Core Lead. Native-egress hunks in CustomBlock and Mochi Provider must be combined with Core cancellation improvements, never replaced with an older whole file.

**Integration remains BLOCKED / merge NO-GO:** #35's `.dockerignore` and Dockerfile build/runtime COPY lists omit `server/paid-gateway/`; Core also reports omitted `ai-abort.mjs`. The deployment owner must package and validate these imports. This task does not edit Docker configuration or deploy. Public-site generation intentionally stays disabled until an authenticated, budgeted production integration is independently approved. No new real calls were made during latest-main/Core composition work.

## Published Delivery

Draft PR: https://github.com/Nanmuxxx/BlockCraft-AI/pull/44 (not merged). Initial published HEAD: `da16bb8652e10d9da8d58b20b20a7d95b0030021`; subsequent handoff-only documentation/test-patch commit does not change production code. Exact local → GitHub commit content-tree mappings:

- `68ab4564b13a5f4b94b5d0c75a1f6d6eac66d356` → `af528cc1317a4806d541e5f55903158af4bb338e` (gateway/identity/security baseline).
- `bdf67032232df701a2808fe28c45eff75c3ed539` → `178627758b0d2fe4602b6b72f45bd93db639b3d8` (evaluator).
- `4e333d5199cf9271e8552de257ec39e685aa391b` → `e07eceedbc55f48707808383bfb7958a6df704e2` (real evidence and eleventh monetary-cap security test).
- `252365e3ec07a2ab8843c7cc8718127fba22106a` → `7689d8893e8353364ce63a280f26265aef3e738b` (latest-main merge).
- `daa3328e34cb8cf0bdb0026486a2cce3d8489543` → `da16bb8652e10d9da8d58b20b20a7d95b0030021` (Core entry patch/latest-main evidence).

Core Lead independently reports byte-identical hunk composition into isolated candidate `63197299ab85330a63dc9af8525d5c5e8d78b48c`, with Core 812 / baseline security 10 / CAS 57 / ZIP 63 / Workshop 9 passing and QA handoff. These are Core Lead-reported results, not additional tests run by this evaluator. `security-money-cap-test.patch` adds only the eleventh security test to the original ten-test baseline, with no live sample dependency; this evaluator has verified all eleven in its 66-test composition run. Docker packaging remains BLOCKED. No further paid calls authorized or needed for QA.

## Follow-up: exact model contract and server-code boundary

Core Lead identified that historical entry/Mochi defaults and CustomBlock allowlist used old model names, while the audited transport only accepts priced `deepseek-flash`. Owner decision: preserve legacy/offline defaults; paid combinations must explicitly pass `model: PRICING.model` to every consumer and share the same transport/canonical ledger. The gateway retains exact-model rejection before reservation and never rewrites aliases. The sole production-code change adds exact `deepseek-flash` to CustomBlock's constructor allowlist. It does not enable CustomBlock/Mochi, execute TSX, raise budgets or extend the dated price approval.

`server/paid-gateway/README.md` records the explicit authentication/model/shared-transport contract and states that arbitrary injected functions are trusted server code. `requireControlledEgress` rejects the captured native fetch but is not a sandbox against malicious server code or arbitrary wrappers. Provenance branding is not endpoint authentication.

Minimal owner patch: `docs/acceptance/phase2-deepseek/model-contract-provider.patch`. Independent test: `tests/paid-gateway/model-contract.test.mjs` (no live samples/credentials). Both old aliases reject through all three consumers with zero reservations/network; exact model succeeds with shared pre-network audit and a six-call ceiling. Synthetic component output remains inert text. Model contract plus existing security **13/13 PASS** on this branch and isolated Core composition; existing CustomBlock Provider **13/13 PASS**. Evidence: `model-contract-tests.txt`, `model-contract-core-tests.txt`, `model-provider-regression.txt`. No additional paid calls; all original monetary totals unchanged. #45 remains the integration/QA candidate, Docker remains BLOCKED; this follow-up must be composed by the Core Lead before any new acceptance claim.

## Follow-up: QA audit deadline and metadata defects

Independent QA reproduced two defects in the original gateway: a pending `onResponse` wait could exceed timeout/cancellation, and untrusted upstream `envelope.model` could echo a synthetic API-key sentinel into callback/response metadata. These are reproduced local boundary defects, not a claim of actual live-key disclosure. Original live evidence remains unchanged.

Minimal owner fix changes only `server/paid-gateway/provider.mjs`: asynchronous auditing now shares the existing deadline/cancellation signal, passes that signal to the callback, checks cancellation before callback and success, and ignores late results. Response/callback model is now always the approved request model `PRICING.model`, never untrusted upstream metadata. Concurrency cleanup remains in finally; trustworthy usage stays settled and its reservation remains retained on audit failure, without refund/retry. Trusted callback side effects cannot be rolled back or synchronous CPU-blocking code preempted; README states this limit explicitly.

Independent owner regressions cover hung callback timeout/concurrency release, cancellation with late resolve/reject, metadata key echo across several data types, detached callback mutation and sanitized callback exceptions. Before-fix diagnostics reproduce both failures; the old hanging diagnostic processes required explicit termination after test timeouts (`audit-boundary-before.txt`). After-fix full paid-gateway suite **20/20 PASS**; isolated Core composition security/model/audit **17/17 PASS** (`audit-boundary-after.txt`, `audit-boundary-core-tests.txt`). Minimal production patch: `audit-boundary-provider.patch`; independent tests: `tests/paid-gateway/audit-boundary.test.mjs`. All traffic is injected synthetic transport; **zero new paid calls**, pricing and budgets unchanged. Core Lead must compose this patch and QA must independently retest before changing BLOCKED status.

## Follow-up: production default model P0

Tech Lead kept default-model inconsistency open as P0 despite the explicit-injection contract. Owner fix supersedes the earlier requirement to always manually pass the priced model: only an exact branded `createPaidTransport` now defaults entry/Mochi/CustomBlock to `PRICING.model`; ordinary offline/native transports keep `deepseek-v4-flash`. Explicit constructor model or existing entry/Mochi `DEEPSEEK_MODEL` takes priority; invalid names and old aliases still fail before reservation/network rather than silently falling back. CustomBlock retains its original no-env-read behavior. No authentication gate, pricing expiry, reservation or feature-enable policy changed.

Minimal shared helper plus four production files: `server/paid-gateway/provider.mjs`, `server/index.mjs`, `server/mochi-ai/provider.mjs`, `server/custom-block/provider.mjs`. The exact integration patch `default-model-provider.patch` is based on Core `2d6f8ce2c282803e9f39270252e8395d3b6e77cb`, preserves every Core cancellation/static/PublicOrigin hunk and requires ordinary contextual application. Three new independent model-contract tests exercise all consumers with omitted model, explicit invalid environment/constructor model, and ordinary offline defaults. This branch full gateway **23/23 PASS**; isolated exact Core patch gateway/security/model/audit plus CustomBlock Provider **39/39 PASS**, evidence `default-model-tests.txt` and `default-model-core-tests.txt`. A preliminary context-free patch experiment misplaced a line in the isolated scratch tree and failed; it was discarded and replaced with the exact contextual patch against Core, then rerun successfully. No candidate/other owner worktree was modified. Core Lead and independent QA must validate the resulting new candidate before closing P0; Docker acceptance still belongs to #46. Zero new paid calls.
