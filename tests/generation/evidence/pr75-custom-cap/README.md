# PR75 CustomBlock provider cap compatibility

Base: `d9ec5b36e633748e5be4d9657cb95ccfe2eb3d3c` (PR #75).
Scope: Core-owned provider request cap and its existing request assertion only.

The CustomBlock provider requested 8192 output tokens against the controlled
Gateway's 2048 cap. Set the request to 2048 without changing Gateway policy,
schema admission, error mapping, cancellation, timeout, or truncation rejection.

All results below are **Mock/offline**. Real DeepSeek: **NOT TESTED in this
patch**, paid calls: **0**. Synthetic credentials, injected transports and
temporary test ledgers only. No generated component source was compiled or
executed. Existing CustomBlock experiments remain outside the P0 feature scope.

Preparation:

```sh
npm --prefix server run build
node server/custom-block/build-protocol.mjs
```

The initial unprepared worktree lacked generated protocol artifacts; that
module-loading failure is not the product baseline. After preparation:

| Command | Before | After | Raw evidence |
| --- | --- | --- | --- |
| `node --test tests/paid-gateway/model-contract.test.mjs` | 3/5 PASS; two CustomBlock paths fail `UPSTREAM_INVALID` | 5/5 PASS | `model-contract-before.log`, `model-contract-after.log` |
| `node --test tests/custom-block-generation/*.test.mjs` | Not rerun before patch | 98/98 PASS | `custom-generation.log` |

The latter retains default denial, invalid/truncated envelope rejection,
byte limits, schema/static admission, inert storage, timeout, late-body cleanup,
cancellation, concurrency and failure recovery coverage. The integration suite
checks shared audited call ceilings and invalid models failing before egress.
No Gateway-owned test or policy was edited; other Gateway regression work is
owned separately. `git diff --check`: PASS.

No browser/ZIP/Docker/production acceptance claim is made for this narrow patch.
Rollback: revert this patch commit; this restores the known 8192/2048 mismatch.
Production enablement, merge and deployment still require owner approval.
