# Phase 3 paid gateway admission owner patch

Baseline: `8cfa37f5112adaab1e0adbb4cb4086240111d436` (main). Branch: `phase3/gateway-admission-20261019`.

## Result

PASS: the trusted per-request synchronous lease is checked immediately before durable reservation and immediately before fetch invocation. Only literal synchronous true is accepted. An invocation-local flag distinguishes proven not-sent attempts from invoked/uncertain requests. Proven not-sent reservations release money durably while preserving attempt count, request hash and original amount. Unknown sent calls retain their full reservation and halt. Settled usage is never refunded.

Production changes are limited to `server/paid-gateway/provider.mjs` and `ledger.mjs`. `gateway.patch` is the corresponding contextual patch against the baseline. No handler, shared server entry, Runtime, Viewer, ZIP or Docker files are modified. Nothing is mounted, enabled or deployed.

## Integration contract

The Core-owned handler must require exact `isPaidTransport` and `supportsPaidAdmission` WeakSet capability membership, acquire a trusted authoritative lease, pass `{ assertCurrent: () => lease.assertCurrent() }` as transport's third argument, and release the lease in finally. Phase 3 must never omit this argument. `requireAdmission: true` additionally makes omission fail for all consumers of that instance; the default false preserves the existing v1 server-code contract. The handler must reject older gateways lacking capability.

The guard must synchronously read or hold authoritative session/subject/owner/project revision/instance/selection and cancellation state. This patch cannot make an arbitrary stale boolean or asynchronous remote check authoritative. No await separates the final guard from fetch invocation; distributed state requires a real authority lock/lease in its trusted adapter. No guarantee against malicious server code is claimed.

Ledger readers must calculate retained money as `sum(reserveNano - (releasedNano ?? 0))` and attempts as `entries.length`. Existing entries remain fully retained and compatible. New not-sent entries require exact released amount, zero estimated cost and no usage. Old code rejects the new status; rollback fails closed. Crash/persistence uncertainty does not regain quota. Canonical paid ledger, pricing, expiry, monetary ceilings and six-attempt cap are unchanged.

## Verification

- PASS: `npm --prefix server run build` and `node server/custom-block/build-protocol.mjs` compile trusted validators.
- PASS: `node --test tests/paid-gateway/*.test.mjs` — 28/28 (`gateway-tests.txt`). This clean main tree does not include the old worktree's three additional real-sample tests.
- PASS: `node --test server/server.test.mjs tests/generation/*.test.mjs tests/trusted-interactive/*.test.mjs tests/custom-block-generation/provider.test.mjs tests/mochi-ai/provider.test.mjs` — 118/118 (`provider-regression.txt`).
- PASS: `git diff --check`.
- Eight new admission tests cover ordered guard checks; missing/false/throw/Promise/thenable guards; revocation before reserve; revocation/cancel between reserve and fetch; captured guard mutation; capability spoofing; concurrency/release; six non-sent attempts retaining the attempt ceiling; monetary release/reopen; sent failures retaining/halt; forged persisted release rejection.

All tests use temporary synthetic ledgers, credentials and injected offline transports. Actual additional model calls: **0**. No browser/paid end-to-end acceptance is claimed by this patch. Core handler composition, independent QA and any enablement remain pending Core ownership; do not merge or enable based solely on these gateway tests.

Prior Phase 2 actual calls remain exactly two, 3,272 tokens, estimated peak cost CNY 0.009484 and retained reservations CNY 0.188612. These are prior evidence, not new measurements or supplier-side billing guarantees. No credential or private ledger is included.
