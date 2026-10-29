# BlockCraft AI — Supervisor Coordination

Coordination hub: https://github.com/Nanmuxxx/BlockCraft-AI/issues/57

## Security contract
- GitHub Actions is a **deterministic read/summary monitor**, not a reasoning agent.
- Hourly cron is best-effort and only runs after this workflow is merged into the repository default branch; cron runs can be delayed or skipped by GitHub.
- GitHub_TOKEN is scoped to read repository/PR and write Issue comments; it cannot merge, push changes, deploy, or run paid AI.
- No third-party tokens or DeepSeek key are needed.
- The monitor **does not start any Codex sessions**, generate binding technical decisions, or ingest all CI artifacts. Cross-session automation requires a separate runner/connector.
- A changed tracked PR SHA/state, new [REPORT], or explicit review-request/ACK state causes a new snapshot. A repeated identical snapshot causes no comment.
- Monitor output is informational. Supervisor human or independently launched AI reviewer must verify CI, code, security before issuing decision.
- A status of NO-GO for public paid generation remains until explicit authorized independent verification.

## Agent handshake
1. Each existing Codex Agent must receive Issue #57 URL and instructions to post its [REPORT] there.
2. Each agent reads latest [DECISION] on Issue #57 before starting new tasks.
3. If agent runtime lacks autonomous scheduling, it does not auto-run; don't claim that it does.
4. Never publish secrets, private logs, paid tokens, addresses, or personal information.

## Review intake (Issue #57 is the only shared task record)

- Request: start a standalone comment with `[REVIEW REQUEST][PR #55]` (replace number), full product/evidence HEAD, latest main, CI/evidence links and requested decision.
- Supervisor checks **all outstanding requests**, not just comments after a last-seen cursor. Triage these before routine status reports; a read cursor never counts as acknowledgement.
- Supervisor posts `[ACK][PR #55]` with `request_id: <source comment ID>` or its exact comment URL, task ID, named reviewer, scope, ownership, acceptance criteria and next action. Record `DISPATCH_PENDING` until the real chat-send tool succeeds; record tool failure as `DISPATCH BLOCKED`.
- Actual send success is `DELIVERED`, not reviewer acceptance. Require the target reviewer to publish its own standalone ACK with task ID and request reference. If it cannot write GitHub, Supervisor may transcribe its actual chat acknowledgement with provenance; never invent receipt.
- Reviewer binds final review to fresh full SHAs, actual CI checkout/results, independently checked evidence and remaining risks. Author reports are not independent test passes. Technical review never authorizes merge or deployment.
- At each heartbeat, reconcile pending dispatches and missing receiver ACKs before new work. Retry only failed/undelivered actions; for a delivered task inspect receiver progress before sending a duplicate. After one hourly cycle with no receiver ACK, record the failure and take a bounded follow-up. Never promise immediate event-driven response from an hourly poller.
- The deterministic monitor exposes `PENDING_ACK` and `ACK_RECORDED`, includes requests in its dedupe hash and refuses silently truncated pagination. `ACK_RECORDED` proves only a linked comment exists; it does not authenticate an author, prove delivery, or grant approval. Nonstandard requests embedded in reports still need Supervisor triage.
- This patch does not add a GitHub-to-Codex receiver. Use the already-authorized existing-chat connector from the local Supervisor heartbeat. If the app/host or connector is unavailable, report that gap; do not mark dispatch successful.

Offline regression command (no real token, model or GitHub writes):

```sh
python3 -m unittest discover -s .github/scripts -p 'test_supervisor_monitor.py' -v
```

## Human approvals (always required)
Merge to main; public/prod deployment; any paid model call/limit change; key changes; production ledger/lock mutations; destructive actions; Force Push; security bypass.

## Activation
- Merge only after review of the small GitHub Actions PR.
- In the GitHub Actions tab ensure workflows enabled, dispatch manually once, inspect Issue #57 for the first auto comment.
- It is not active until that smoke test passes.
