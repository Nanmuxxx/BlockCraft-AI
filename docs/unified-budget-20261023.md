# Unified AI budget — 2026-10-23

## Problem and behavior

Generation, interactive generation, field planning and Mochi previously applied independent durable and process/session limits. A feature could reject a request while the customer-facing counter still showed remaining allowance. Studio now uses one persistent ledger, with account selection exclusively from server-authenticated identity:

| Account | Shared monetary ceiling | Shared request ceiling |
| --- | --- | --- |
| customer | CNY 20 | none |
| agent-test | CNY 5 | 200 |

All features debit the same account. Tests use a separate server-derived authentication credential; a browser request cannot select an account. Existing customer credentials continue to work. The owner authorized this new epoch and reset explicitly. Legacy budget statistics are archived with a hash manifest and excluded from the active request path. The one-time signed migration receipt prevents a restart, missing ledger or interrupted migration from silently granting another allowance. Keys and business files are preserved.

## Accounting and failure rules

Reserve the maximum bounded charge durably before egress; settle using validated provider usage. Unknown outcomes remain charged at the reservation, including after restart. Inconsistent usage halts the affected account. One lease and one atomic ledger write cover reservation and idempotency claims. Persistence failure prevents further egress. Runtime never creates missing budget state. Pricing is checked against the official page at startup and periodically; unverifiable pricing disables paid requests.

The service stops when it cannot reserve a request within the remaining balance. A small positive balance can therefore remain; the ceiling is never intentionally exceeded. The UI explains this reservation behavior. Local safety rate/concurrency/consent checks remain, but legacy feature/session monetary and request caps are bypassed only in the trusted unified runtime.

## Validation

Offline fixtures cover both accounts, more than 1,000 customer requests without a request-count cap, the 200-test-call boundary, monetary ceilings, atomic persistence, restart continuity, durable duplicate claims, permissions, uncertain usage, dedicated test login, live revocation/expiry, and migration interruptions/tampering. Generation, Mochi, proactive advice, controlled edits, gallery, project ZIP and interactive regression suites are also run. No real provider request was used for this change: 0 calls / CNY 0.

Production uses Dockerfile.studio and server/unified-studio-deployment.mjs. The generic image retains its existing entry point. PR #85 stability diagnostics and intent validation are preserved; existing Studio entry UI and interactive generation wiring are included. Deployment uses an isolated fast-forward descendant of the reviewed Studio revision, preserving the shared source workspace and its unfinished changes.

## Limits and follow-up

- Durable transport idempotency rejects duplicate claims with the same authenticated principal/key. Mochi currently creates a new key for each HTTP attempt: a deliberate manual retry can make a new paid request. End-to-end network replay deduplication is not claimed. No automatic retry was added.
- Proactive event deduplication remains the existing in-memory ten-minute mechanism; an admission failure/cancellation can temporarily suppress that same event.
- The historical proactive 502 / AI_INVALID_RESPONSE root cause is not established by this budget repair. PR #85 diagnostics and offline format checks remain in place; no live model quality claim is made.
- Server state must survive container replacement. Missing/corrupt state fails closed; it does not reset allowances. Arbitrary third-party Agent calls outside this authenticated application cannot be accounted by its ledger.

## Test setup troubleshooting

An initial broad test invocation omitted the repository's custom-block protocol build prerequisite. Three files failed with MODULE_NOT_FOUND; running `node server/custom-block/build-protocol.mjs` supplied the generated dependency. Node v24.22.0 documentation: https://nodejs.org/api/modules.html#all-together. Two older assertions were updated to expect explicit BUDGET_EXHAUSTED (429) and PRICING_UNVERIFIED (503), replacing generic failure classifications. Failures and corrected runs are retained in the local release evidence.
