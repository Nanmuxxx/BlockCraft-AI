# Existing-login backend phase evidence

Code tested at full SHA **5652c16882b8548fb2930f600eb01274f0081094**. Later evidence-only commits do not relabel these records; final-head CI and local proof are reported separately on PR97 and issues95/92.

- `python3 -m unittest discover -s tests/supervisor-v2 -v`: exit0, **51** tests, macOS26.6 arm64, Python3.14.7/Git2.50.1. [Full output](exact-tests.txt). Model adapter responses, approval files and QA manifests in tests are explicitly MOCK fixtures; no actual Codex inference is made.
- `python3 -m tools.supervisor_v2.proof --output /tmp/supervisor-v2-next-audit/exact-offline-proof.json`: exit0. [Real separate Worker process/receipt/events and independent clone replay](offline-proof.json). Worker d52b7487-5d56-47da-9ef7-85847313b443, task16237c60-ca12-42b8-a659-1dbf46fba628. Tested/reviewed SHA is5652c16882b8548fb2930f600eb01274f0081094, task REVIEW, AI acceptance NOT_RUN.
- `git diff --check`: exit0.
- [Capability audit](capability-audit.json) records the freshly inspected original remote main/PR97 SHA, existing-login status, SDK absence and old-head CI. Old CI is not evidence for this update.
- Native experimental offline jail failed: [original output](native-probe-initial.txt), [loader-rule follow-up](native-probe-loader.txt). Final inner status -6/SIGABRT; root cause unconfirmed. It is not an authenticated launcher and its actual isolation remains NOT_VERIFIED. No fallback to broader permissions.

Controls tested: explicit backend/no silent OSS/API/SDK fallback; no subprocess before grant+QA; auth files rejected as control inputs; expiry/model/role/attempt/deadline/spend restrictions; private control ownership/no symlinks; binary/profile binding; atomic run reservations; ChatGPT-only preflight; nonzero/missing/invalid/oversized-schema response; session/completion/error event requirements; cancellation; no success before cleanup; descendant output handles; receipt identity/digest/exact command evidence; same-session or wrong-receipt QA rejection; source HEAD changes during model review; safe unrelated task continues; plus previous duplicate/conflict/heartbeat/stop/recovery tests.

Actual model execution, SDK/runtime compatibility, credential-safe authenticated outer launcher, actual independent AI ACCEPT/REWORK/next-task sequence and multi-device execution remain **BLOCKED/NOT_VERIFIED**. [Current full audit and next gate](../../DESKTOP-WORKFLOW.md). This evidence does not claim Supervisor V2 operational status.
