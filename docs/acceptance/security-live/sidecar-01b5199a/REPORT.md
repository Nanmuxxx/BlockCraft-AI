# Independent sidecar audit — P0-LIVE-Q

Product #63 `01b5199a919c6a5ef8826c94d2a683f81a3d2cbc`; stable main `4a95cae50f772cd242d932cdbd93366381d1df74`. Isolated detached checkout; Node24.22.0/macOS arm64. Run2026-10-20 Asia/Shanghai. Actual model/network egress0. No production source/policy edits. QA tests use fresh private0700 temporary directories/synthetic bindingKey; local durable Mock egress marker only.

| Command | Result | Scope |
|---|---|---|
| node --test tests/paid-gateway/idempotency-sidecar.test.mjs |4/10, exit1|Native expired clock,6 failures due to pricing expiry (first assertion observes0 successes)|
| node --import ./tests/security-live/historical-clock.mjs --test tests/paid-gateway/idempotency-sidecar.test.mjs |10/10, exit0|Only isolated test process Date.now fixed2026-10-19T12:00Z|
| node --test tests/security-live/sidecar-independent.test.mjs |3/3, exit0|Separate process settled/unknown restart and native expiry probe|

Owner regression tests independently rerun: second handle denied IDEMPOTENCY_LOCKED before/after settlement; close/reopen reloads claim and rejects replay; closed old handle cannot unlock replacement; different ledgers sharing directory, symlink alias and other process cannot own concurrently. No repeats of old c1c7df0 two-reservation defect in these cases under test clock. Native time is deliberately not changed; pricing.expiresAt remains2026-10-20T00:00+08:00.

New independent cross-process regression: process1 reserve/settle/close, process2 and3 reopen same persistent files and replay; entries1/claims1, local Mock egress1. Unknown outcome process1 uncertain+halt persists to subsequent processes, replay refused, entries1/claims1/egress1. Fresh native expired case: first PRICING_EXPIRED, entries0, egress0, claims1; retry IDEMPOTENCY_REPLAY. **Not zero claim.** Stored claim before reserve is intentional observed behavior, not automatically rolled back.

These prove bounded module reservation/ownership behavior only. Local marker is not provider/HTTP egress integration. Current runtime/provider does not consume sidecar/principal, so final HTTP at-most-once, browser, image and real public model remain BLOCKED. Old63a UI evidence must not be rebound to this or future composed SHA. Production/secret injection/live NO-GO. Historical clock PASS cannot renew real prices or spending permission.

Logs: native.txt/native.exit, historical.txt/historical.exit, independent.txt/independent.exit. Tests in tests/security-live. Live plan in ../LIVE-E2E-PLAN.md. No automatic QA issue polling/wakeup verified.
