# P0-LIVE-Q: public real DeepSeek E2E plan — NOT EXECUTED

2026-10-20 Asia/Shanghai. Task P0-LIVE-Q, decision6271584562. live_calls=0. This document requests no implicit permission. Merge, deployment, Secrets injection, paid calls, real budget changes and account permissions remain unauthorized.

## Preconditions and evidence identity

Before any owner-approved live smoke, record one immutable composed product SHA, CI actual checkout/merge SHA, image digest, Studio deployed revision, public HTTPS URL and timestamp. Final Mock HTTP/B/C/canary/image acceptance and independent Tech Lead sign-off are required; old63a replay is regression only. Owner must separately approve exact target, maximum calls/cost and live window, and arrange runtime-only Secrets. QA never reads the key or bindingKey. Price/authorization is currently expired; only owner-approved refreshed policy can permit live use, never a historical clock.

Verify server-trusted principal/session and user authorization, explicit default-off startup, durable private single-instance POSIX ledger+sidecar, restart persistence, rollback digest and emergency disable owner. No public shared anonymous principal, Origin/IP/header-derived identity or in-memory budget fallback. No real failure injection that risks ambiguous billable calls. If platform/identity/image evidence is absent: BLOCKED, not READY.

## Proposed paid scope and maximum cost — approval still required

Proposal: **2 upstream attempts total**, sequential, one fresh task at1440x900 and a second fresh task at390x844. No automatic retry; timeout/error/unknown outcome stops the run. Replay/refresh/restart of either idempotency key must add0 upstream attempts. Additional calls require separate approval. Failure/security matrix runs Mock-only before live.

Per attempt conservative bound: input65536 UTF-8 bytes +8192 framing =73728 input tokens (byte-as-token upper bound), output8192 tokens; total81920. Two attempts:147456 input +16384 output =163840 tokens. Using archived cache-miss/peak CNY rates (input¥2/M, output¥8/M): per attempt¥0.212992, two¥0.425984; proposed hard maximum **¥0.43**. These prices are historical and expired, not a current quote or spending authorization. Gateway/Tech Lead must reverify model/tokenizer/envelope bound and official current peak/cache-miss prices; recompute ceiling before approval. If token framing cannot be bounded or current cost exceeds approved cap, do not call. Never alter existing real budget to make the test pass; actual existing remaining budget must also suffice.

## Unpreset demand and no Fixture fallback

After target is frozen, judge/owner supplies a new natural-language demand not present in repo/fixtures/source44. Do not publish predetermined final prompt in this plan. Use two different domains, within supported AppSpec capabilities (forms/lists/metrics, text/number/date/boolean). Record sanitized prompt, SHA256 and exact byte count; no personal/secret content. Ask judge to include distinctive entity/field/metric requirements so response can be compared semantically. Do not embed expected AppSpec or preselect response. A random nonce alone does not prove novel generation.

Use production UI real-generation path with explicit live status; prohibit Gallery, prerecorded JSON, local provider overrides and fallback. Show honest error if live fails. Record UI request correlation ID, idempotency-key hash, principal HMAC/tag, canonical semantic payload hash, reservation ID, UTC times, fixed upstream host/model, sanitized upstream request ID, returned usage and settlement. Trusted server audit must correlate these without exposing Authorization/cookies/raw principal/bindingKey or provider headers wholesale. Browser output alone does not prove real upstream. Preserve sanitized raw assistant content and SHA256; validate local schema separately. Provider returned request ID is supporting evidence, not sole proof. Keep full secret-bearing network traces/HAR out of shared artifacts; use allowlisted extracts only.

## Public browser sequence

For each demand: authenticate with owner-provided approved test session; capture existing project sentinel records/revision. Submit once, show loading and generation success; confirm live provenance and upstream correlation. Validate AppSpec entities/fields/relations/block IDs and bindings, then ProjectState. Check demand compliance; structurally valid but semantically wrong is FAIL. Enter B, select each block, edit display parameters and add supported optional field. Enter C, create/read/update/delete records and verify count/sum/average where specified. Three B/C round trips must retain fields/rows. Capture viewport screenshots with immutable target and provenance in report. No arbitrary TSX/Mochi feature in scope.

Test second generation replacement behavior: no silent overwrite before explicit user action; cancel retains sentinel. Approve replacement only on test project, verify no old-field/data leakage. Refresh/re-entry behavior must match declared persistence contract; report in-memory-only loss rather than claim persistence. Repeat same idempotency request through controlled test client only after review: HTTP409 or documented duplicate result, zero second reservation/egress. Do not manufacture extra live requests to test retries. Owner performs approved process restart on synthetic/live test state only if separately approved; current task grants no deployment/restart permission.

## Required final-SHA safety matrix (Mock-only)

| Case | Required result and evidence |
|---|---|
| Missing/invalid session, missing resolver, key only, key+ledger, boolean identity |401/default closed; zero factory/claim/reserve/egress as appropriate|
| Invalid/timeout/exception principal resolver |bounded fail-closed; no raw principal; zero reserve/egress|
| Missing/malformed key or payload conflict |documented4xx; no extra reserve/egress; stable semantic payload binding|
| Duplicate, concurrent, distinct users, per-request context |same pair at most1 reserve/egress; no principal crossover|
| Multi-handle, same directory different ledger, aliases, close/reopen, OS restart |exclusive ownership/replay refusal; durable claim; entries at most1|
| Corrupt/full/unwritable sidecar/ledger, key rotation mismatch |503/fail-closed before egress; no auto recovery/deletion|
| Budget exhausted/expired, concurrent limit |503/zero additional reserve/egress; expiry may persist claim, record exact count|
| Timeout/disconnect/unknown upstream/shutdown mixed OS signals |abort; preserve claim; uncertain+halt; drain before sidecar/ledger close; no retry|
| Upstream non2xx, redirect, oversized/malformed response, invalid AppSpec |safe error; current project preserved; fixed URL/redirect:error/retries0|
| Late generation/cancel/unmount/race with edited project |no stale overwrite; revision protection|
| Canary hostile metadata/body/error plus auth error |no synthetic key/principal/bindingKey in body/header/errors/log/browser/ZIP/dist/image; separately report each|
| ZIP supported generated project |actual UI download; scaffold guard; independent clean install/build; no secret/dependency leakage|

Mock tests are not real-model PASS. Actual live smoke cannot safely force billed timeouts/invalid output; those rows remain Mock evidence. Stop on any unknown outcome, inconsistent usage/claim/ledger, unexpected network or secret leak. Preserve evidence, disable through owner runbook, no automatic retries/reset/rollback by QA. No screenshot with secret values.

## Final delivery / verdict

Report LIVE / RECORDED REPLAY / FIXTURE separately, exact SHA and immutable deployment identity, commands/env/raw exits, schema and semantic results, browser screenshots, sanitized audit correlations, token usage/cost, ledger deltas, failures/repro and remaining platform gaps. Only both novel-demand actual public runtime cases plus all mandatory safety prerequisites can support P0 live GO. Current verdict **NOT EXECUTED / NO-GO pending final candidate, platform evidence and explicit owner approvals**.
