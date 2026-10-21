# Core offline regression against PR #75

Base: `5942311725a3d5fbb413eca8b537630e5164d2e3`.
Independent worktree: `BlockCraft-AI-core-pr75-regression`.

All provider traffic is synthetic Mock. No real key or private ledger was accessed; paid calls = 0.

| Failure class | Cause | Test-only correction |
| --- | --- | --- |
| server valid completion returned 502 | Mock still asserted 8192 after Core capped requests to 2048 | Assert 2048; preserve endpoint/model/auth/JSON/protocol assertions |
| lifecycle upstream wait timed out; positive HTTP returned 401 | Isolated smoke runtime no longer supplies `appServerOptions`; compatibility test constructed no explicit HTTP identity/transport adapter | Add explicit test adapter with synthetic key, controlled transport and test-only authorization; default-closed and identity-negative tests retained |
| lifecycle reopened ledger rejected | Smoke runtime writes version 2 local-smoke state; test reopened production profile | Reopen temporary test ledger with exact SMOKE_POLICY/local-smoke profile; retain lock/settled/uncertain checks |
| expiry test assumed wall clock was expired | Candidate has a newly approved short-lived pricing snapshot | Test deterministically at installed expiry boundary; positive paths use expiry minus 60 seconds, with advancing clock for signal deadlines |
| suite remained alive after failed positive assertion | Missing server cleanup on failing Mock success assertion | Register shutdown before assertion; reject immediately if request ends before expected Mock egress |

Baseline command: `node --test --test-timeout=15000 tests/generation/*.test.mjs`.
The historical-contract failures reproduced, then the run remained alive despite per-test deadlines. Only its identified runner/lifecycle processes were terminated after approximately 64 seconds. Raw output is `baseline-generation.log`; it is NOT PASS.

Final commands:

- `npm run test:generation`: TypeScript build PASS, 65/65 PASS, 0 failures/skips; test runner 1464 ms.
- `npm --prefix server test`: TypeScript build PASS, 39/39 PASS, 0 failures/skips; test runner 284 ms.
- `git diff --check`: PASS.

Raw final logs are `generation.log` and `server.log`. Lock ownership during drain, idempotent shutdown, SIGTERM/SIGINT child process behavior, settled/uncertain states, expiry rejection with zero egress, identity rejection, and configured call-cap rejection remain asserted. Production/Gateway policy and application source are unchanged. This is not a Docker image build, deployment, browser rerun, full Gateway suite, or real DeepSeek test. The deterministic expiry test replaces a calendar-dependent native-clock test; it is not evidence of current production pricing expiry.
