# S1 evidence and remaining gates

Implementation tested at **96b2694ef5115fde7c8c61d95f673bddf8f1a779** (later scope-case hardening is retested in the final PR checks). Evidence files are immutable records for the named SHA, never silently relabelled as a later commit.

- `python3 -m unittest discover -s tests/supervisor-v2 -v`: exit **0**, **26** tests; Darwin arm64, Python 3.14.7 / Git 2.50.1. [Full output](evidence/exact-tests.txt).
- `python3 -m tools.supervisor_v2.proof --output /tmp/supervisor-v2-audit/real-worker-proof.json`: exit **0**. A real separate CLI worker process performed registration-bound assignment → CLAIMED → RUNNING → real Git subprocess checks → durable REVIEW receipt. Supervisor independent replay used another clone and passed. [Full receipt/events/output](evidence/real-worker-proof.json).
- Worker ID `4351406e-49ff-4c88-8641-22bef967eadb`; task `b7e6d4ef-92ab-4a33-8f84-6af6f3692766`; tested and independently reviewed SHA both `96b2694ef5115fde7c8c61d95f673bddf8f1a779`. Fixed commands `git rev-parse HEAD` and `git status --porcelain=v1 --untracked-files=all` both exit 0. Task remains **REVIEW**; **AI acceptance NOT_RUN**.
- Concurrent assignment/session tests, disjoint/overlapping ownership, duplicate task, expiry retention, failed checkout, confirmed-stop retry, SHA tampering/stale source, emergency stop, timeout/output bounds and OS Supervisor lock are exercised. MOCK decisions test ACCEPT → next dependency dispatch, specific REWORK ownership/retest, stale-decision CAS and refusal to waive a failed objective gate. Fake launcher tests CLI argv/schema/environment plumbing only; no real Codex/model execution is represented by these tests.
- Runtime collector independently reread public #91/#92/#95, PR93/94 files/heads/checks; no network/model requests in the proof or unit tests. Remote evidence is [captured separately](evidence/remote-audit.json). Python test logs include original failures and subsequent passing result.

## Capability status

| Capability | Status |
|---|---|
| Operator-local UUID registration, explicit assignments, fenced claim/heartbeat/report | VERIFIED with real subprocess |
| Duplicate/conflict/expiry/stop/recovery gates | VERIFIED offline automated tests |
| Independent read-only SHA/check replay | VERIFIED with separate clone |
| Codex exec local OSS adapter / structured decision-loop code | IMPLEMENTED; argv plumbing MOCK tested; live inference BLOCKED |
| Live model-generated accept/rework and next-task loop | NOT VERIFIED; requires installed local model and audited outer launcher |
| Two separately authenticated owner/teammate workers / remote transport | NOT IMPLEMENTED |
| Code-writing workers, arbitrary repository tests, automated Worker PR publishing | NOT IMPLEMENTED pending isolation and full PR/CI gates |
| Windows runtime | CI matrix added; not locally verified; model execution explicitly blocked |
| GitHub phase updates / runtime Draft PR | Operator publication via existing Desktop/browser; no credential extraction |
| Always-on hosting / deployment / auto-merge | DISABLED, no approval requested |

System remains **NOT OPERATIONAL** for #95 S2/S4. S1 local no-model chain is real; S1 fully isolated Codex worker is partial. No paid call, merge, deployment, secret change or product-code change occurred. These limitations are release gates, not claims to be fixed by configuration alone.

**Unique next step:** install/validate an operator-owned outer isolation launcher and an already available local OSS model, then run one read-only Codex Worker + actual Codex Supervisor review under the same evidence gates. No cloud fallback or account credential copying. After that, add an authenticated remote broker and independently provision the teammate before two-machine acceptance. No request to spend or expand permission is made here.

Rollback: stop the local queue, confirm child termination, preserve queue/evidence for audit, and close the unmerged Draft PR. No product state migration or deployment exists to undo. [Run/stop instructions](README.md).
