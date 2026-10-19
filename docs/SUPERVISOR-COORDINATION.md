# BlockCraft AI — Supervisor Coordination

Coordination hub: https://github.com/Nanmuxxx/BlockCraft-AI/issues/57

## Security contract
- GitHub Actions is a **deterministic read/summary monitor**, not a reasoning agent.
- Hourly cron is best-effort and only runs after this workflow is merged into the repository default branch; cron runs can be delayed or skipped by GitHub.
- GitHub_TOKEN is scoped to read repository/PR and write Issue comments; it cannot merge, push changes, deploy, or run paid AI.
- No third-party tokens or DeepSeek key are needed.
- The monitor **does not start any Codex sessions**, generate binding technical decisions, or ingest all CI artifacts. Cross-session automation requires a separate runner/connector.
- A changed tracked PR SHA/state or new [REPORT] causes a new snapshot. A repeated identical snapshot causes no comment.
- Monitor output is informational. Supervisor human or independently launched AI reviewer must verify CI, code, security before issuing decision.
- A status of NO-GO for public paid generation remains until explicit authorized independent verification.

## Agent handshake
1. Each existing Codex Agent must receive Issue #57 URL and instructions to post its [REPORT] there.
2. Each agent reads latest [DECISION] on Issue #57 before starting new tasks.
3. If agent runtime lacks autonomous scheduling, it does not auto-run; don't claim that it does.
4. Never publish secrets, private logs, paid tokens, addresses, or personal information.

## Human approvals (always required)
Merge to main; public/prod deployment; any paid model call/limit change; key changes; production ledger/lock mutations; destructive actions; Force Push; security bypass.

## Activation
- Merge only after review of the small GitHub Actions PR.
- In the GitHub Actions tab ensure workflows enabled, dispatch manually once, inspect Issue #57 for the first auto comment.
- It is not active until that smoke test passes.
