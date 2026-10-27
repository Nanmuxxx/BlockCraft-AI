# Supervisor V2 — existing local Codex/ChatGPT workflow

**Current status: BLOCKED / NOT OPERATIONAL for model execution.** The no-model local queue/Worker chain is verified. T1/T2 backend and fail-closed interfaces are implemented/MOCK-tested; actual Codex inference and independent AI acceptance are NOT_VERIFIED. No Agents API or OSS requirement. [Current audit and boundaries](DESKTOP-WORKFLOW.md); [remote design only](CROSS-DEVICE-DESIGN.md); [original protocol](PROTOCOL.md); [historical evidence](EVIDENCE.md).

Requires Python3.12+, Git; offline tests need no packages, models, network or auth files. Keep operator state outside the repository in an owned0700 directory.

```sh
python3 -m unittest discover -s tests/supervisor-v2 -v
python3 -m tools.supervisor_v2.proof --output /absolute/private/offline-proof.json
```

Proof creates an operator-local UUID Worker, explicitly assigns a fixed-SHA read-only task, runs a **separate CLI Worker process**, records claim/run/receipt, and independently replays Git checks in another clone. It changes no production files, executes no repository script and makes no model request. Task remains REVIEW; AI acceptance NOT_RUN. Claims, heartbeats, receipts, duplicate/conflict/expiry controls are real process/protocol behavior, not model execution evidence.

## Operator-local commands

```sh
python3 -m tools.supervisor_v2.cli --state /private/operator/queue register --name mac-owner
python3 -m tools.supervisor_v2.cli --state /private/operator/queue enqueue /private/operator/task.json
python3 -m tools.supervisor_v2.cli --state /private/operator/queue assign TASK_ID WORKER_ID
python3 -m tools.supervisor_v2.cli --state /private/operator/queue worker WORKER_ID --once
python3 -m tools.supervisor_v2.cli --state /private/operator/queue verify TASK_ID
python3 -m tools.supervisor_v2.cli --state /private/operator/queue snapshot
```

Task spec: `{"kind":"git-smoke","issue":95,"base_sha":"FULL_40_HEX_SHA","files":["docs/supervisor-v2"],"acceptance":"Assigned HEAD and clean snapshot; fixed Git checks exit0","risk":"NONE","priority":100,"depends":[]}`. Only `git-smoke` and read-only `codex-audit` are supported. No code-writing, arbitrary repo commands or PR acceptance. Literal conservative file reservations are assigned before Worker execution. Workers never race for unassigned tasks. `worker` without `--once` polls only its own assignment; one task per invocation, no hidden replay.

## Existing-login model backend (gated; not enabled)

First evaluated official Python `openai-codex` SDK. It is not installed in this interpreter; published0.163 runtime compatibility with the device's0.164 alpha is NOT_VERIFIED. This iteration explicitly selects the existing CLI fallback. No implicit installation, unsupported API claim or backend fallback. [Evaluation and official sources](DESKTOP-WORKFLOW.md).

Model config must be an operator-owned0600 JSON in a0700 directory **outside the checkout**. Required fields: `backend:"codex-chatgpt-exec"`, absolute `executable`, absolute independently reviewed `launcher`, exact owner-approved `model`, existing `auth_home`, `grant_file`, `isolation_file`. Do not put authentication contents in this config. The adapter never opens/enumerates/copies auth_home. Omitted grant/QA blocks before any subprocess. Legacy OSS/Agents/unknown backend selection is rejected. No live config/grant is supplied in the repository.

Grant has owner/reference, exact model/auth/roles, expiry<=24h, attempts<=10, timeout<=120s, zero additional API spend and no credit purchase. QA record requires independent reviewer, matching OS, profile/runtime/launcher hashes, all capabilities and verified runtime/tool credential separation. Profile is an operator-owned JSON at `profile_file`, hash-bound to QA and passed only to the trusted launcher as `SUPERVISOR_ISOLATION_PROFILE`. A launcher must actually enforce that reviewed profile; a manifest alone is not isolation proof. MOCK/stale/missing records cannot authorize. No helper generates or approves these records.

After separate owner approval **and** passing independent isolation QA:

```sh
python3 -m tools.supervisor_v2.cli --state /private/operator/queue worker WORKER_ID --once --codex-config /private/operator/codex.json
python3 -m tools.supervisor_v2.cli --state /private/operator/queue supervise --codex-config /private/operator/codex.json
```

Normal Codex runtime authenticates using that operator's existing ChatGPT login. It is a local harness making model requests, distinct from both desktop GUI and cloud inference. New runtime threads are not promised to appear in an existing GUI chat. Preflight accepts only ChatGPT login status. API keys, extra APIs, cloud execution/Agents API, OSS and credit purchases are not fallback paths. Model errors, auth changes, malformed/schema-invalid output, missing session/completion, failed cleanup, cancellation or expired heartbeat block with no success receipt. Model logs/prompts are withheld; bounded summaries are redacted.

Independent review reruns checks from another clone, checks receipt identity/hash/actual SHA/output, and requires a different completed Codex model session bound to the exact receipt for model ACCEPT. Mock tests are logged Supervisor/MOCK. REWORK includes owner, criterion and retest; rejected dependencies remain held. The real ACCEPT/REWORK/next-task loop remains NOT_VERIFIED until approved runs demonstrate it.

## Stop and recovery

```sh
python3 -m tools.supervisor_v2.cli --state /private/operator/queue stop
python3 -m tools.supervisor_v2.cli --state /private/operator/queue reconcile
# Inspect events and independently confirm the old process AND descendants exited.
python3 -m tools.supervisor_v2.cli --state /private/operator/queue resume
python3 -m tools.supervisor_v2.cli --state /private/operator/queue recover TASK_ID --termination-evidence 'confirmed process/session exit; evidence reference'
```

Stop is durable. Resume does not clear BLOCKED reservations. Expiry retains ownership until confirmed termination, never steals leases; retry creates a new task ID, fences the old session and allows max two retries. Default heartbeat TTL30s. Separate Supervisor/reconcile must observe sleeping Workers; no machine reports while shut down. Process-group cleanup cannot prove containment of detached processes; authenticated outer launcher QA is still missing. Windows model execution is blocked pending ACL/process-tree verification, although offline CI runs on Windows.

`python3 -m tools.supervisor_v2.offline_jail` is an experimental **OFFLINE synthetic probe only**, not an authenticated launcher. On this host its native child exited SIGABRT; result is BLOCKED. It denies network/auth-home reads and cannot launch signed-in Codex. Do not treat mocked probe tests or a generated profile as completed isolation.

Rollback: stop, confirm child termination, preserve operator queue/evidence, leave Draft97 unmerged or close it. No production migration/configuration or credential change exists. See current audit for exact blockers, sources, troubleshooting and the owner/security-QA responsibilities for the unique next step.
