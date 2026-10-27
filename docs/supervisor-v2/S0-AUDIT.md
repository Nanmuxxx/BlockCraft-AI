> Historical S0/S1 record (2026-10-27). Current existing-ChatGPT backend, gates and limitations: [DESKTOP-WORKFLOW.md](DESKTOP-WORKFLOW.md). OSS-only statements below describe the earlier candidate, not current team requirements.

# S0 — capability audit and architecture decision

Audit started 2026-10-27 Asia/Shanghai; sources fetched fresh, not inferred from old reports.

| Object | Exact revision / observed state |
|---|---|
| remote main | bcb6c1a7402ad4b4514feb4865c38d769d7244d1 |
| original local checkout | bed79e289442ffde9570190ff8210edd5381cc60 (not used for implementation) |
| PR 93 | 285e061a7820f2b2022bd31d4c1040aa4e1be32d; Draft/open; zero exact-head check-runs |
| PR 94 | 79080e450ff667eae7c2c8acd700b7b367752f12; Draft/open; Docker acceptance SUCCESS |

Sources: [95](https://github.com/Nanmuxxx/BlockCraft-AI/issues/95), [92](https://github.com/Nanmuxxx/BlockCraft-AI/issues/92), [91](https://github.com/Nanmuxxx/BlockCraft-AI/issues/91), [93 diff](https://github.com/Nanmuxxx/BlockCraft-AI/pull/93/files), [94 diff](https://github.com/Nanmuxxx/BlockCraft-AI/pull/94/files), [94 CI](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40526326955). REST issue bodies/comments, PR metadata, check-runs and workflow runs were read via certificate-verifying system curl; full PR refs fetched and changed files inspected locally. Combined status API says pending with no legacy statuses; it is not a failed check nor a substitute for check-runs. Main scheduled monitor success is observer evidence only. Workshop's latest ACK explicitly says same-chat interface review, not independent review; production tasks remain outside this runtime change.

## Actual host capability

- Darwin arm64, Git 2.50.1 (Apple Git-155), Node v24.22.0, npm 11.19.1, Python 3.14.7.
- React 19.3.1 / TypeScript 5.9.3 / Vite 8.3.4; Node server >=22.16.0; npm lockfile. Node built-in tests, CJS/MJS browser scripts, Docker acceptance. No Codex SDK dependency in manifests; no new SDK dependency needed.
- `codex --version`: 0.164.0-alpha.11.1; `codex login status`: logged in using ChatGPT. Only status queried; no auth.json/token/key contents read. CLI help confirms exec, --oss, --local-provider, --sandbox, --json, --output-schema, --ephemeral, --ignore-user-config. A login is neither proof of free usage nor permission to bill.
- gh not available in PATH or conventional install locations. GitHub Desktop is installed and already authenticated; publication can use its normal UI. No credentials extracted or shared. Git fetch works; Git push authentication is not assumed from fetch.
- No Docker executable in PATH. Local model provider availability is not established; do not download models or silently fall back to cloud.

## Decision ADR-001

Use Python standard library / SQLite transactions for a structured local task queue (expressly allowed in S1), one explicitly selected Supervisor and polling worker processes. GitHub issues are coordination/evidence, not a distributed lock. Queue directory is operator-owned, outside task workspaces. Task processes never receive the database or GitHub write credentials. No HTTP listener, shared network database or claim that the local SQLite file is a multi-person authentication service. Remote broker with authenticated identities is later work; do not copy the queue or auth.json to teammates.

Choose existing `codex exec` as the model execution interface. During this no-paid proof only an explicit local OSS provider is eligible; cloud execution is disabled. Default harmless executor invokes fixed Git commands, not model inference or repository scripts. The Codex adapter must fail closed without an external OS isolation launcher; clearing environment alone is not isolation. Each person's eventual paid/account execution requires that person's own authentication and separately approved usage policy. Never centralize credentials.

Model decisions are validated against deterministic safety/identity/SHA gates. They cannot select commands, change policy, accept missing CI, merge or deploy. Independent evidence is collected outside the Worker snapshot. Model review is required for autonomous ACCEPTED; offline smoke verification is recorded as such, not AI acceptance. S2/S4 full operational acceptance is NOT claimed by S1.

## Portability and liveness

macOS: Python/Git subprocess and SQLite MVP feasible and tested here. Codex native sandbox available per CLI; credential-safe outer isolation still required before repository code/model tools can run. Windows: Python/Git and SQLite portable; Codex documents a Windows sandbox, but this host cannot verify Windows behavior. Prefer an isolated WSL/Linux identity or audited Windows restricted-token runner; no unsupported fallback to unrestricted Windows execution. A future transport must authenticate each worker and fence old sessions. Do not put SQLite WAL on network shares.

A laptop is not 24/7 hosting. Sleep/kill/network/auth failures stop useful work; Supervisor marks heartbeat expiry OFFLINE/BLOCKED, retains file locks, and requires confirmed termination before retry. If Supervisor sleeps too, no observer can emit an offline event until it resumes; persisted lease times are reconciled before more work. Hosted runners require separate security/cost approval; GitHub Actions run repository tests only without persisted checkout credentials, never model inference or write tokens.

## Troubleshooting record

1. `git status --short` from workspace container: exit 128, full error `fatal: not a git repository (or any of the parent directories): .git`. Read-only inspection found actual child repository. Used explicit cwd and created a separate worktree at fresh origin/main. Verified fetch/rev-parse. [Git -C documentation](https://git-scm.com/docs/git).
2. `gh --version`: zsh `command not found: gh`, exit 127. `command -v`, conventional paths and app inspection confirm unavailable CLI, not an authentication failure. Use existing authenticated Desktop/browser UI, no credential changes. [gh manual](https://cli.github.com/manual/).
3. Python 3.14 urllib GET: exit 1; `ssl.SSLCertVerificationError: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1082)` then `urllib.error.URLError`. Likely framework Python trust-store configuration; exact missing root unconfirmed. No certificate verification disabled and no system trust store modified. System curl 8.7.1 / SecureTransport verified the same public GitHub API and succeeded. [CPython macOS certificate setup](https://github.com/python/cpython/blob/main/Doc/using/mac.rst), [maintainer issue](https://bugs.python.org/issue28150).

## Primary implementation references

- [Codex noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode): CLI execution, JSONL and schema output.
- [Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox): platform capability is documentation, not local Windows verification.
- [Official iterative repair example](https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex): reuse exec, bounded structured decisions and independent verification.

4. Initial runtime test `python3 -m unittest discover -s tests/supervisor-v2 -v`: exit 1, 21 pass / 1 error. After deliberate output overflow, cleanup raised `PermissionError: [Errno 1] Operation not permitted` at `os.killpg(p.pid, signal.SIGKILL)` and a subprocess ResourceWarning. Read-only `ps` found no live affected child. Python documents process-group signalling and Popen.poll reaping; macOS exited/unreaped-group behavior is a plausible cause, not permission to ignore live-process failures. Repair reaps an already exited child before signalling, tolerates the race only if a subsequent poll confirms exit, and still blocks on live EPERM. Subsequent timeout/output/stop tests and full suite pass. [Python subprocess](https://docs.python.org/3/library/subprocess.html), [os.killpg](https://docs.python.org/3/library/os.html). Full original error is retained in evidence/initial-tests.txt.
5. Adapter contract test initially used this host's framework Python as fake Codex executable. The minimum-permission gate rejected its group-writable mode: `GateError: executable writable by another identity`, exit 1, 25 pass / 1 error. This is an expected policy rejection; no permissions were changed or gate weakened. Replaced test input with a dedicated 0700 fake executable outside the repo; 26 tests pass. Original output retained in evidence/adapter-gate-tests.txt.

Further read-only checks: `ollama`, `lms`, `docker`, `bwrap` absent from PATH; `/usr/bin/sandbox-exec` exists but no audited launcher installed. Runtime's own public GitHub evidence collector completed with TLS verification: main/PR heads match above; current #92 comments include Workshop ACK. No inference or external Worker authentication verified.
