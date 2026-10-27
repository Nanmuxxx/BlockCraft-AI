# Supervisor V2 — S1 local pilot

Requires Python 3.12+, Git, no extra packages. State must be outside the repository, owned by the operator with mode 0700. The structured queue is the S1 source of task assignment. This pilot has no network broker and is not a multi-user authentication service.

## Run the harmless proof

From repository root:

```sh
python3 -m unittest discover -s tests/supervisor-v2 -v
python3 -m tools.supervisor_v2.proof --output /absolute/private/output.json
```

The proof creates a private queue, registers a UUID worker, explicitly assigns a read-only task at the current full commit SHA, launches a separate CLI worker process, observes CLAIMED/RUNNING/REVIEW events, then independently reruns Git checks from a second clone. It changes no production files, executes no repository scripts, makes no network/model request, and leaves the task in REVIEW. It never converts OFFLINE proof into AI acceptance. JSON includes actual command output, exit codes, worker/session/task IDs, timestamps and receipt hash.

For manual operation (replace placeholders):

```sh
python3 -m tools.supervisor_v2.cli --state /private/operator/queue register --name mac-owner
python3 -m tools.supervisor_v2.cli --state /private/operator/queue enqueue /private/operator/task.json
python3 -m tools.supervisor_v2.cli --state /private/operator/queue assign TASK_ID WORKER_ID
python3 -m tools.supervisor_v2.cli --state /private/operator/queue worker WORKER_ID --once
python3 -m tools.supervisor_v2.cli --state /private/operator/queue verify TASK_ID
python3 -m tools.supervisor_v2.cli --state /private/operator/queue snapshot
```

Task JSON: `{"kind":"git-smoke","issue":95,"base_sha":"FULL_40_HEX_SHA","files":["docs/supervisor-v2"],"acceptance":"Assigned HEAD and clean snapshot; fixed Git checks exit 0","risk":"NONE","priority":100,"depends":[]}`. Only `git-smoke` and read-only `codex-audit` exist; code-writing jobs, arbitrary commands and PR delivery are deliberately unsupported until isolation and independent product gates are implemented. Supervisor decides file ownership before execution. Scope is a literal prefix, never a glob. Symlink scopes are blocked in the snapshot.

`worker` without `--once` polls only its own assignment. Each invocation executes at most one task and returns DONE after receipt. A service manager may restart it after acceptance resets registration to READY. Starting the same active registration twice fails. No unassigned-task races.

## Stop / recover

```sh
python3 -m tools.supervisor_v2.cli --state /private/operator/queue stop
python3 -m tools.supervisor_v2.cli --state /private/operator/queue reconcile
# Inspect events and confirm the old process and all descendants are terminated FIRST:
python3 -m tools.supervisor_v2.cli --state /private/operator/queue resume
python3 -m tools.supervisor_v2.cli --state /private/operator/queue recover TASK_ID --termination-evidence 'verified PID/session exited; evidence path or operator record'
```

Stop remains durable across restarts. Resume before recover if stop is active; resume does not clear BLOCKED reservations. Never acknowledge termination based on heartbeat age alone. Recovery creates a new task ID, original session stays fenced, max two retries. Assign the retry to a fresh READY worker. Worker's default TTL is 30 seconds and active subprocess pulse is 50 ms; queue/process failures stop execution. A separate periodic `reconcile` or running Supervisor is needed to detect missing workers while the worker machine sleeps. No process can report during its own host shutdown.

## Codex execution and decision loop

Existing Codex CLI is reused; no model executor is reimplemented. CLI invocation is `codex exec --oss --local-provider ollama|lmstudio --model EXPLICIT_LOCAL_MODEL --sandbox read-only --ephemeral --ignore-user-config ... --output-schema ...`. Cloud/account/API execution is absent. A local model must already be running and available; the runtime never downloads one or changes a budget. This host has no ollama/lms in PATH, so live inference is NOT validated.

An operator-owned JSON config **outside the checkout** contains absolute `executable`, absolute `launcher`, `provider`, `model`. Launcher must be installed outside the repo, executable, not writable by other users. ABI: `launcher WORKSPACE CLEAN_HOME -- CODEX ARGS...`. This is a trusted deployment prerequisite, NOT an arbitrary task-supplied command. Before installing one, independently validate it confines the full process tree to workspace/clean home, denies access to real home/keychain/SSH/GitHub credentials/control DB/other workspaces, permits only the local model socket, and cleans descendants on cancellation/exit. Changing HOME alone is not sufficient. No launcher is bundled or implicitly trusted. Windows is explicitly blocked for model execution until a validated outer jail exists; use a separately reviewed WSL/Linux installation later. Do not grant more privileges to make a launcher work.

```sh
python3 -m tools.supervisor_v2.cli --state /private/operator/queue supervise --codex-config /private/operator/local-codex.json
```

Each round reconciles liveness, reads #91/#92/#95 and current PR93/94 files/checks/HEAD, independently replays read-only receipts, calls Codex for a schema-constrained decision, then applies only if the queue version is unchanged. Failed API/model/JSON/isolation reads stop that round; no fixed-format decision fallback. Acceptance requires exact SHA/clean/hash/exit-code gates plus Codex decision. ACCEPT/REWORK are tested with explicitly MOCK decision providers; they are not live model evidence. REWORK creates a bounded child task assigned to the same owner with criterion and retest. Dependencies on a rejected task remain held for operator reconciliation, never silently satisfied by a child. Next poll chooses the next unblocked task. Other READY tasks can proceed despite a held risk-gated task. PR/code acceptance is unsupported, so no CI can be silently waived as "not required" for code delivery.

## Permission and publication boundary

Runtime children inherit only an allowlisted environment with fresh HOME/CODEX_HOME and no Git config, token, API key, proxy or agent socket. Snapshots use clone --no-local, disable hooks, remove origin, and never execute package scripts. Existing Codex auth is neither read nor copied. Cross-person authentication, task transport, automated Worker Draft PR publishing and GitHub report outbox are remaining work, not claimed features. The operator publishes this implementation Draft PR and phase reports through existing Desktop/browser authentication. No GitHub write identity is passed to a Worker. Do not run PR-controlled code with write tokens. The CI workflow has contents:read and persist-credentials:false; it invokes only offline tests, no model.

## Status

S0 audit/protocol: delivered. S1 local queue/actual no-model worker execution: verified by included receipts/tests. S1 live Codex worker with external isolation: BLOCKED on installed local model + validated launcher. Cross-machine/two independent identities, Windows runtime verification and S2 autonomous AI review: pending. System status remains NOT OPERATIONAL. [Audit](S0-AUDIT.md), [protocol](PROTOCOL.md), [evidence](EVIDENCE.md).
