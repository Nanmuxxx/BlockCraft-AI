# PR #68 principal-night POSIX Mock QA

- Candidate: `d6f2cb4f110d22f665690e3af1d818249cc03b99`
- Base: `4a95cae50f772cd242d932cdbd93366381d1df74`
- Environment: local POSIX Mac; temporary ledgers and synthetic credentials; controlled Mock provider only.
- Command: `node --test tests/generation/principal-gateway-http.test.mjs tests/generation/principal-entry.test.mjs tests/generation/lifecycle.test.mjs tests/paid-gateway/principal-runtime.test.mjs tests/paid-gateway/idempotency-sidecar.test.mjs`
- Result: **42/42 PASS**, exit 0.

Covered: trusted and missing identity; invalid identity/key; same-principal replay and payload conflict; claim-before-reserve and zero egress on rejection; budget 503; timeout/disconnect uncertain claims and halt; native current pricing expiry before reserve/egress; POSIX close/reopen and lock ownership; shutdown drain/close ordering; authenticated Mock HTTP AppSpec composition.

The `native-clock` cases are distinct from historical-clock sidecar evidence. No pricing or clock was changed. No real DeepSeek request, production key, real budget, deployment, or product source edit occurred.

Uncovered: public Studio origin/revision, real trusted identity provisioning, real provider evidence, and live novel-demand acceptance remain blocked/unauthorized. Browser and ZIP suites were already run for this unchanged candidate and were not repeated for this focused task.
