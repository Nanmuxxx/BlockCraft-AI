# MVP POMODORO QA checkpoint

Candidate Core: 8aedff514dce3a2d2882a37bb29888892a0a376f
Base: 4a95cae50f772cd242d932cdbd93366381d1df74
Scope: Mock-only actual generation entry -> auth/idempotency -> Mock transport -> AppSpec -> Runtime.
Acceptance: duration=1500 seconds; start/pause freezes countdown; reset returns 1500; invalid schema/timeout retain existing app; provider mock count; zero external requests.
Forbidden: real API key, paid call, deployment, product/protocol edits.
Evidence owner: docs/acceptance/compose-68-qa/pomodoro-mvp/
Status: checkpoint saved before test; exact candidate checkout pending.
