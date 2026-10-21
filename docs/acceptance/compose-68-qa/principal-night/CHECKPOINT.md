# NIGHT-QA-POSIX-0128 checkpoint

Candidate: d6f2cb4f110d22f665690e3af1d818249cc03b99
Base: 4a95cae50f772cd242d932cdbd93366381d1df74
Environment: local POSIX Mac; network/power ETA UNKNOWN.
Scope: Mock-only principal HTTP composition with temporary POSIX ledger and synthetic credentials.
Forbidden: real provider calls, production config/secrets/budget, product/Gateway edits, deployment, merge.
Planned checks: trusted/missing identity, invalid key, same-principal replay 409, claim-before-reserve, budget 503, native current expiry zero egress, timeout/disconnect, close-lock.
Historical-clock tests must be reported separately from native current expiry.
