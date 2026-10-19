# QA Guardian 持续回归矩阵（v1 审查稿）

- 发布角色：QA Guardian（由 Demo QA 转任的持续回归与质量守门 Agent）
- 基线：main @ `4a95cae50f772cd242d932cdbd93366381d1df74`；演示 QA 证据 HEAD：`c113d35`（PR #73）
- 硬约束：`REAL_MODEL_CALLS=0`；不自动合并、不部署；不使用真实 DeepSeek Key；不修改 `src/**`、`server/**`

## A. 回归矩阵

| # | 检查项 | 内容与命令 | 归属 | 触发 | 环境 | GO/NO-GO 权重 |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | 演示主线全量回归 | `node tests/demo/qa-demo.browser.cjs`（15 项检查 + DONE 行） | **Guardian 独有**（`tests/demo/**`） | main 前进后每轮 | 本地 Node ≥22.16 + Playwright Chromium + 真实本地后端 | GO 必要 |
| G2 | 根目录单测 | `npm test`（205/205） | 复用现有脚本 | 每轮 | 本地 | GO 必要 |
| G3 | server 侧测试 | `npm --prefix server test`（generation 34/34、gateway 20/20） | Server Owner 拥有，Guardian **只读结果** | `server/**` 变更后 | 本地 | GO 必要 |
| G4 | Workshop ZIP 导出 | `npm run test:workshop-export*`（9/9） | Workshop Owner 拥有，Guardian **只读结果** | 导出相关变更后 | 本地 | GO 必要 |
| G5 | F1 Windows 探针 | CRLF 检出 → v1 生成 502 fail-closed 只读探测（复现命令见 DEMO-QA-REPORT §F1） | **Guardian 独有**（只读探测，不改 `server/**`） | 每次 G1 附带 | 本地 Windows | 观察项（修复后转绿；当前不阻塞离线演示主线） |
| G6 | 构建健康 | `npm run build` + `npm --prefix server run build` | 复用现有脚本 | 每轮 | 本地 | GO 必要 |

## B. 与 AI 集成 QA 的去重边界

- AI 集成 QA 拥有：`tests/generation/real-loop*`、`docs/acceptance/real-loop-qa/**`；覆盖 503/504 预算与取消语义、真实临时账本注入、响应重放校验。
- Guardian **不重复**：不重写 real-loop 场景、不做预算账本测试、不做响应重放；只消费其 `[REPORT]` 结论（VERIFIED / PARTIAL / BLOCKED）作为 G2/G3 的输入与 GO/NO-GO 参考。
- 代码区域所有权：Guardian 仅 `tests/demo/**`、`deliverables/**`（含本矩阵）、`audit-evidence/demo-qa/**`；`src/**`、`server/**` 归各 Owner。**禁止 Guardian 与 AI Core/Gateway Owner 同时修改同一代码区域**；冲突先在 Issue #57 协调。

## C. CI 现状与治理（2026-10-20 经 GitHub API 核查）

- 现有工作流（`state=active`，共 2 个）：
  1. **Docker acceptance**（`.github/workflows/docker-acceptance.yml`）：pull_request 仅在 `Dockerfile`、`.dockerignore`、`ms_deploy.json`、`package*.json`、`index.html`、`vite.config.ts`、`tsconfig.json`、`src/**`、`public/**`、`server/**`、自身路径变更时触发，另支持 workflow_dispatch。**本 PR（仅 README/deliverables/tests-demo/audit-evidence）按路径过滤不会触发**——head `c113d35` 实测 runs=0，一致。
  2. **Supervisor Coordination Monitor**（`.github/workflows/supervisor-coordination.yml`）：每小时 cron 协调快照（issues:write），不执行测试。
- 结论：**优先复用现有 CI**。G1–G6 当前全部以本地脚本 + 证据推送方式运行（PR #73 内 run-log 为证），本轮**不新增**云端自动化。
- 未来如需云端自动化（如夜间 G1）：必须**独立 PR + Tech Lead 审查**通过后方可启用；启用前一律标注 `PLANNED`，**不得标注 `ACTIVE`**。GitHub Actions 只执行已配置的测试与脚本，**不承担自主 Agent 决策**。

## D. GO/NO-GO 集成

- Guardian 每轮产出 `[QA-GUARDIAN][REPORT]`：DONE 行、PASS/FAIL 汇总、G5 探针结果、`REAL_MODEL_CALLS=0`、证据链接。
- GO 必要条件：G1/G2/G4/G6 全绿 + G3（Server Owner 结论）非 NO-GO + AI 集成 QA 结论非 NO-GO + F1 不阻塞演示主线（当前不阻塞：离线主线不受 v1 502 影响）。
- 最终 GO/NO-GO 由 Tech Lead 汇总各方 `[REPORT]` 裁决；Guardian 结果为**必要输入之一**。

## E. 断电与恢复协议

- 本地断电/离线：协调**不等本地 Agent**；事实来源 = GitHub（Issue #57、相关 PR、已推送证据）。仅存在于本机的状态一律视为丢失。
- Lead Agent 恢复在线：**先重读 Issue #57 全部评论 + 相关 PR 状态 + 最新 `[DECISION]`**，再恢复任务调度；禁止凭本地记忆恢复调度，避免重复派工。

## F. 真实执行环境与恢复状态记录

- 环境：Windows 11（win32）、Node 24.21、MinGit 2.56.0.2、Playwright 1.64.1（Chromium）、真实 Vite dev + 真实本地后端（127.0.0.1:3001）。
- 网络：经本地代理 `127.0.0.1:7897`（git 需显式 `http.proxy`，直连 github.com:443 会被重置；API 走代理正常）。
- 凭证：Windows 凭证管理器（进程内读取、日志打码、未落盘）。
- 恢复状态：本会话经历两次瞬时网络中断（push 两次失败），改走代理后成功；PR #73 创建时修正了空响应解析 bug（脚本将空 PR 列表误判为已存在），相关评论已 PATCH 修正——详见 Issue #57 `[QA-GUARDIAN][ACK]`。
