# Issue #57 评论（按 Supervisor [REPORT] 格式，随 PR 一起发布）

> 发布前人工检查：读取最新评论，确认无重复分工；DECISION 仍允许 QA 文档类 PR。
> 发布记录：2026-10-20 已发布为 issuecomment-6272886459；因脚本将空 PR 列表误判为已存在，`pr:` 字段为空、PR 实际未创建，随后已创建 PR #73 并 PATCH 修正该评论。

---

[REPORT] role: QA
base_sha: 4a95cae50f772cd242d932cdbd93366381d1df74 (origin/main, verified via API + local rev-parse)
head_sha: c113d3553fac58c98b1604d9ece8454de135ce36 (QA evidence head; PR #73 head advances with docs-only commits)
pr: https://github.com/Nanmuxxx/BlockCraft-AI/pull/73 (feature/demo-qa-deliverables-4a95cae → main; docs/qa-evidence only + root README)
status: VERIFIED
completed: Demo QA & documentation deliverables on top of current main. (1) Browser demo QA (Playwright Chromium, real Vite + real local backend, offline DeepSeek fixture injection via server's documented DI point, zero paid calls): 15/15 checks PASS, exit 0, on THIS base — checks migrated to current UI: trusted-pomodoro offline mainline (source label "离线固定 Fixture，非真实 DeepSeek 调用"), B workshop 1 pomodoro block + honest disabled AI entry, C mode 25:00 timer + /app-renderer example CRUD (2→3→2 single-step delete), repeat run, failure/cancel honesty (alert keeps old app), / Mock guard + supported-request message append, three-route overflow 0px desktop+mobile, console healthy (pageerror/console.error/4xx = 0). (2) Root README.md added (was missing — verified via API 404) with facts re-checked against 4a95cae: routes, startup, offline vs v1-authorized semantics (401 admission gate), ZIP export available, Node>=22.16. (3) Deliverables: DEMO-QA-REPORT (incl. FINDING F1), DEMO-QA-DOC-ISSUES, DEMO-SCRIPT, DEMO-CHECKLIST, evidence run-log + 8 screenshots.
tests: node tests/demo/qa-demo.browser.cjs → "DONE demo-qa: 16 checks (incl. 1 FINDING), PASS=15, FAIL=0 -> none", EXIT=0 (run-log + screenshots committed). No src/server modifications; no product code changes; no merge/deploy/paid calls; live_calls=0.
blockers: NONE for this PR. FINDING F1 (for server owner, not a blocker): v1 generation fails closed (502) on CRLF checkouts — server/aiGenerationPrompt.mjs readV1GenerationProtocol() byte-exact self-check on src/model/appSpec.ts expects LF; autocrlf checkouts break includes() → "Review v1 protocol projection" → 502 for every v1 request. Blob is LF (verified via git cat-file); CI/Linux unaffected. Fix suggestion: normalize CRLF after read, or .gitattributes eol=lf. Windows-demo-impacting; offline mainline unaffected.
next: Tech Lead review of PR; server owner to adopt F1 fix and the two server/README wording updates (401 code + upstream egress wording); QA re-run on request (AUDIT_APP_DIR=<repo>; repro in DEMO-QA-REPORT §3).
approval_needed: NONE