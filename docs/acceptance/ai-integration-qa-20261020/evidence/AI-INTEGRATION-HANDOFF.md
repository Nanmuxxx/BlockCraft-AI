# AI integration QA — power-loss checkpoint

Status: IN PROGRESS. Product fixes: none. Real model calls: 0.

Repository: https://github.com/Nanmuxxx/BlockCraft-AI
Lead coordination: https://github.com/Nanmuxxx/BlockCraft-AI/issues/57
Tested candidate: PR #68, d6f2cb4f110d22f665690e3af1d818249cc03b99.
Parent composition: Core #61 84e61496868b6dea161782c8c3b821df3a0d039f plus Gateway #63 1c0bd2672a53756ac9a0e8f537cf3320b6c2e01f.

## Independent Windows checkpoint

Node v24.22.0, locked dependencies installed with npm ci --ignore-scripts.
Application credentials excluded from test environment. External fetch/http(s) requests denied by preload; injected Mock transports only. This is defense in depth, not a full network sandbox.

| Check | Result |
| --- | --- |
| Server TypeScript / trusted protocol build | PASS |
| Root AppSpec, Runtime, workbench and related units | 205/205 PASS |
| TypeScript project / Vite production build | PASS |
| Generation suite | 29 PASS, 29 FAIL, 1 SKIP; not acceptance PASS |
| Paid Gateway suite | 4 PASS, 37 FAIL; not acceptance PASS |
| Server suite | 120s runner timeout; partial log only |
| Principal/ledger HTTP composition | BLOCKED on Windows POSIX permission gates |
| Browser, ZIP | NOT TESTED at checkpoint |
| Real DeepSeek | NOT TESTED; NO-GO |

## Blockers and investigation

- Windows filesystem cannot satisfy existing private POSIX0700/0600 ledger and opaque-session checks. Do not bypass guards. Use a stable Linux/macOS supervisor or existing authorized CI for independent retest.
- Additional generation/server failures include `Review v1 protocol projection` at server/aiGenerationPrompt.mjs:19. Initial inspection finds exact LF matching against CRLF checkout (core.autocrlf=true). This is distinct from ledger permissions and needs isolated reproduction before assigning severity. No source changes made.
- Pricing validity expired at 2026-10-20 00:00 Asia/Shanghai. Current-date refusal must remain closed; historical Mock tests are not live pricing approval.
- CLI bindingKey injection/readiness requires explicit review. Do not invent a new secret source or read production keys.
- Latest #68 CI and exact checked-out merge/head SHA still need inspection. Owner test claims are not independent verification.

## Minimal takeover

1. Read latest Lead decisions and assignments in Issue #57. Do not merge or deploy.
2. Fetch PR #68 and verify exact HEAD before comparing results. Retest only changed SHA; preserve this checkpoint as Windows/CRLF evidence.
3. For these archived scripts, put run-qa.cjs and deny-external.cjs in a scratch directory with the tested checkout named BlockCraft-AI beside them. The runner writes to ../outputs relative to scratch.
4. Run npm ci --ignore-scripts in checkout, then node ../run-qa.cjs buildServer protocol root tsc vite generation gateway server. Scripts do not enable paid traffic; inspect any new test additions before execution.
5. On POSIX, independently run principal-gateway HTTP, budget/idempotency/auth/cancel/storage tests. Record OS, Node, exact SHA, raw logs and counts. Current-date pricing must fail before upstream egress.
6. Reproduce LF/CRLF protocol issue without product changes; request Lead assignment before any fix.
7. Finish browser B/C CRUD/error/cancel and archive scope checks with Mock only. Distinguish legacy injected-HTTP browser coverage from principal-runtime/ledger coverage.
8. Publish matrix, evidence and next task only to Lead via Issue #57. Real DeepSeek remains NOT TESTED.

No recurring automation or stable-supervisor migration has been established by this agent. This checkpoint does not claim background monitoring. Existing CI may be inspected; no new scheduled workflow, paid resources, production changes, budget changes or pricing authorization.
