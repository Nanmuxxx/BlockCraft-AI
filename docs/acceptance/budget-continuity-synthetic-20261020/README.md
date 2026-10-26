# Synthetic budget continuity acceptance

This package is a pure planning and validation proof. It does not read, create, or migrate a real ledger, call a model provider, or alter runtime wiring.

## Contract

- The source must explicitly identify the synthetic `local-smoke` ledger v2 profile. The target is pinned to `production` ledger v1 and `budget-continuity-v1`.
- The opening debit records one consumed call and a conservative reservation of `36,658,000` nano-CNY (`CNY 0.036658`). It is bound to a sanitized receipt reference and a SHA-256 digest.
- The target ceilings are at most three cumulative calls and `20,000,000,000` nano-CNY (`CNY 20`). The planner requires the exact approved target policy and limits; it does not grant new budget.
- Re-importing a receipt digest, malformed or absent receipt data, source/target policy drift, mismatched accounting, any unknown item, or any uncertain state is rejected. The opening debit is frozen and the plan digest covers the complete plan.
- JSON round-trip testing models persistence/restart continuity only. It is not evidence that a real ledger was durably migrated or that a deployed volume has the required POSIX semantics.

## Synthetic fixture

`tests/paid-gateway/fixtures/continuity-synthetic.json` is fabricated and contains no real receipt, account identifier, key, or ledger data. The reference and digest are test constants only.

Run from repository root:

```sh
node --test tests/paid-gateway/continuity.test.mjs
node --test tests/paid-gateway/*.test.mjs
```

## Required before any real migration

Owner must privately reconcile the authoritative receipt, all existing reservations, settled usage, and uncertain attempts, then issue a separate explicit approval for a fixed migration plan. The migration must be implemented and reviewed separately against the target ledger's durable-write and restart behavior. Unknown or uncertain spend remains fail-closed. No live migration or paid call is authorized by these synthetic tests. Public paid traffic remains NO-GO.
