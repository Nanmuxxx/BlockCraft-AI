# Existing Codex desktop workflow — 2026-10-28

Status: **BLOCKED / NOT OPERATIONAL** for actual inference and AI acceptance. This phase implements and tests the explicit existing-login backend; it does not prove a real model run. No Agents API migration, OSS requirement, credential copying or extra paid API is introduced.

## Fresh evidence

Remote main remains `bcb6c1a7402ad4b4514feb4865c38d769d7244d1`. Starting PR97 HEAD is `905a25573377c205c5a1f0a969961001552a39e5`, Draft/unmerged. Fresh Git fetch resolved both full SHAs. Existing-browser inspection confirmed all three old-head checks successful: [run40533708123](https://github.com/Nanmuxxx/BlockCraft-AI/actions/runs/40533708123). Issue95 body and latest S0/S1 report were reread; no inference grant or isolation PASS was found. Final updated HEAD/CI are reported on PR97 and issues95/92 after publication; the old run is not evidence for the new code.

Host: macOS26.6 arm64, Python3.14.7. `codex --version` returned `0.164.0-alpha.11.1`; `codex login status` returned `Logged in using ChatGPT`. Exec help supports read-only sandbox, JSONL, output-schema, ephemeral, ignore-user-config and strict-config. No authentication file was opened/enumerated/copied. No network authentication changes were performed. No Python distribution named openai-codex is installed in the inspected interpreter.

Public REST refresh returned HTTP403, with x-ratelimit-limit60, remaining0 and reset1793120317. This confirms anonymous rate exhaustion, not a need to read tokens or expand permissions. Stopped that path and used the existing signed-in browser to read PR97/Issue95/checks. The outer collector exited0 after reporting the failed read; no write or retry was used to diagnose it. [Official rate-limit handling](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api). Response logs committed here omit the public IP and all credentials.

## SDK first, then explicit CLI fallback

[Official Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk) now documents a stable **Python** SDK, Python>=3.10, which controls a local app-server over JSON-RPC. Registry metadata read on 2026-10-28 identifies `openai-codex==0.163.0`, depending on `openai-codex-cli-bin==0.163.0`, pydantic>=2.12 and packaging>=26.2. No SDK/runtime was installed or initialized. Its package pins a different runtime from this device's0.164 alpha CLI. `CodexConfig(codex_bin=...)` can intentionally select a local binary, but this exact SDK/binary/auth combination has **NOT_VERIFIED** compatibility. We do not label the SDK unsupported; it is unavailable in this environment and unvalidated here. No model call is needed to reach that conclusion.

This iteration therefore uses the separately selected **codex-chatgpt-exec** backend with the already installed CLI. Selecting `codex-python-sdk`, an unknown backend or an old OSS config fails with no implicit fallback. SDK adoption can be a later bounded task using its official public API and independent compatibility tests. No custom model harness is built.

[Official authentication documentation](https://learn.chatgpt.com/docs/auth) distinguishes ChatGPT subscription access from API-key usage billing. [Noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode) documents reuse of saved CLI authentication. This does not authorize unattended inference, credit purchases, account changes or extra APIs. An existing subscription still has availability/quota limits; no claim of unlimited or universally zero-cost inference is made. This runtime requires a model-specific, time-limited owner grant, zero additional API spend and no credit purchase. There is no API/Agents/OSS fallback. The plan's server-side billing settings are not changed or claimed to be enforceable by a local timeout.

Three distinct surfaces:

| Surface | What it does | What this implementation claims |
|---|---|---|
| Desktop GUI | User-facing chats and workspace UI | No GUI automation or automatic attachment/resumption of existing chats |
| Local Codex runtime | CLI/app-server harness and local tools | Existing0.164 CLI inspected; explicit adapter implemented; real run NOT_VERIFIED |
| Model inference | Requests made by runtime using the account's model access | Requires separate owner approval; not performed in this phase |

CLI creates a new runtime session, not a promise to appear in a pre-existing desktop chat. Persist `model_session_id` separately from Worker lease `session` and adapter `execution_id`. No auth file copying is needed or allowed. Each future device must sign in independently.

## Authentication and execution boundary

The trusted parent/runtime may use the operator's already signed-in CODEX_HOME through normal Codex behavior. Adapter code never reads that directory's contents. Fresh HOME for a child would lose authentication; copying auth into a task snapshot would expose it. Neither is an acceptable workaround.

A **separately installed, independently reviewed launcher is still missing**. Its ABI is `launcher WORKSPACE CLEAN_HOME -- CODEX ARGS...`. It must keep actual account auth usable by the trusted Codex runtime while preventing model-generated tools from reading auth home, keychain, SSH material, GitHub credentials, queue/grants or other workspaces. It must disable unreviewed hooks/plugins/config, forbid tool network and out-of-scope writes, and terminate the complete descendant tree. Passing HOME/CODEX_HOME or using --sandbox read-only alone is not proof of those properties. Unrestricted read-only access can expose secrets. Process groups alone do not contain a detached descendant.

`security.ExecutionPolicy` enforces: operator-owned0600 records in an owned0700 directory outside the checkout; no symlinks; owner approval reference, exact model, existing-local-chatgpt auth, both Worker/Supervisor roles, <=24h expiry, <=10 reserved attempts and <=120s deadline; no extra API spend or credit purchase. Isolation record must have independent reviewer, OS/profile/executable hashes, all required capability evidence and a verified existing-login/tool credential boundary. MOCK, missing, stale, changed-binary and unsupported Windows ACL records fail before any runtime subprocess or auth access. Records are operator trust artifacts, **not signatures and not proof by themselves**; fabricated JSON is not independent QA. No command generates or approves them.

Count reservations are atomic and consumed before attempting execution; uncertain failure is not automatically retried/refunded. This limits execution attempts, not ChatGPT's billing system. No real authorization or isolation record was created in this phase. Examples in tests are synthetic, only in temporary directories, and never passed to actual Codex.

After gates pass, adapter runs `codex login status` through the reviewed launcher and accepts only ChatGPT status. API-key/expired login blocks without model execution. Inference uses explicit model, forced_login_method=chatgpt, model_provider=openai, strict-config, read-only, ephemeral, ignore-user-config, approval_policy=never and an empty task shell environment. No API keys, agent sockets or proxy secrets are inherited. Existing auth path is supplied only to the trusted launcher, which must keep it out of tools. The launcher remains necessary even with these flags.

## Native offline probe and known failure

`python3 -m tools.supervisor_v2.offline_jail` is an **experimental no-auth offline probe**, not the above authenticated launcher. It uses only synthetic credentials and a synthetic loopback server, denies all network, and checks allowed workspace access plus denied outside reads/writes and inherited child restrictions. It cannot run logged-in Codex because it also denies auth-home access.

Actual host result: **BLOCKED**. First profile exited nonzero with empty stderr; original output retained. Read-only source inspection of OpenAI's [Seatbelt platform defaults](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt_read_only_platform_defaults.sbpl) showed separate executable mapping requirements. Adding narrowly scoped loader mappings did not resolve it: inner process exit **-6 / SIGABRT**, empty stderr, harness exit1. Exact root cause is unconfirmed; no more permission relaxation/retries were attempted. [Related maintainer report](https://github.com/openai/codex/issues/41493) shows constrained bootstrap can fail, but is not proof of the same root cause. No security setting or certificate validation was disabled. The helper now reports BLOCKED rather than a success claim when the child fails. Its mocked negative tests are not native isolation proof. Windows/Linux authenticated launcher and descendant containment remain NOT_VERIFIED.

## Receipts and independent acceptance

A successful actual model run must supply exactly one thread.started session and a turn.completed event, no error/turn.failed event, exit0, bounded valid schema output and a model artifact digest. Missing/invalid output, API-key auth, cancellation, deadlines, heartbeat expiry or failed cleanup block the task and produce no success receipt. Raw prompts/model event streams/runtime diagnostics are withheld from public receipts; bounded findings are redacted before hashing.

Independent replay validates task/Worker/session identity, exact base/head/test SHA, receipt hash, exact Git command outputs, no dirty files, no unsupported PR claim and, for model tasks, actual completed model-run structure. A receipt's own hash is not independent proof. Supervisor uses a fresh review workspace and new model execution/session, bound to the exact receipt digest. MOCK reviewers, same-session self-review and mismatched subjects cannot ACCEPT model work. MOCK decisions are explicitly logged as Supervisor/MOCK. A failed evidence item does not prevent assignment of an unrelated safe task. REWORK remains a bounded new assignment with original owner, criterion and retest; rejected dependencies stay held pending explicit lineage reconciliation.

**NOT_VERIFIED:** actual Worker model inference; actual independent model QA; real ACCEPT/REWORK/next-dispatch sequence. Offline fixtures cover these interfaces and failure gates, not real AI acceptance. Code-writing jobs, arbitrary repository tests, PR acceptance and auto-publishing remain disabled.

## Unique next step and rollback

**Owner** must approve a concrete read-only task on their own device, exact available model, plan-quota usage and attempt/deadline cap with no additional API/credit spend. **Independent security QA/Runtime Engineer** must resolve and validate the existing-login/runtime/tool isolation boundary and provide actual evidence for the reviewed launcher. Approval alone cannot override a failed isolation gate. Until both exist, all actual model runs remain BLOCKED. No second-device implementation starts before the single-device real loop passes.

Rollback: stop the operator-local queue; confirm all child processes are terminated; preserve evidence; leave PR97 Draft/unmerged or close it. No production configuration, credential, account permission, budget setting or product state has been changed. Old OSS configuration is now explicitly rejected; migrate only the operator's backend selection after review, never their authentication files.
