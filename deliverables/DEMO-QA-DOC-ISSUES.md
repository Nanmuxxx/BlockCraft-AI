# 文档问题与修复清单（Demo QA & Documentation Agent）

- 日期：2026-10-19
- 执行人：Demo QA & Documentation Agent（Cline）
- **审计对象：origin/main @ `4a95cae50f772cd242d932cdbd93366381d1df74`**（本机 clone，SHA 经 GitHub API + git 双重核实；上一版清单以本地 a1fa755 树为对象，其结论已按最新 main 复核并更新）
- 参照物：桌面旧工作副本（`feature/onboarding-qa` 分支旧检出，代码早于 main——这解释了它为何"过时"）

## 0. 协作与版本前提（此前 BLOCKED，现已解除）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| GitHub 可达 | **已恢复** | 网页 HTTP 200；REST API 正常 |
| 远端 main SHA | **已核实** | `4a95cae50f772cd242d932cdbd93366381d1df74`（API /commits/main 与本地 rev-parse 一致；pushed_at 2026-10-19T15:33Z，PR #58 已合并） |
| 开放 PR | **已核实** | 15 个开放 PR；无演示 QA/README/文档类重复工作（PR #59、#62 为其他 QA 的真实循环验收，范围互补） |
| Issue #57 | **已读取** | Supervisor 协调中心；本轮按 [REPORT] 格式发布 |
| 提交 PR / Issue 评论 | **本轮完成** | 分支 `feature/demo-qa-deliverables-4a95cae`；PR 与评论见 Issue #57 |

## 1. 问题清单（按优先级，均已在 4a95cae 上复核）

### P0-1 仓库根没有 README.md（远端 main 实测缺失）

- **证据**：GitHub API `GET /contents/?ref=4a95cae` 实测——根目录 7 个 `*.md` 全部为阶段报告（AGENT-B-NIGHT-QUEUE、PHASE2-*、PR49-*、NIGHT-AGENT-B），无 README；`GET /contents/README.md` 返回 404。
- **影响**：评委/新成员无法从仓库根获得启动命令、演示入口（`/ai-create`）与能力边界；`server/README.md` 质量好但藏在子目录。
- **修复**：本 PR 直接提供根 `README.md`（内容与 4a95cae 事实逐项核对过：路由、命令、番茄钟离线主线、401 授权门、ZIP 可导出、Node>=22.16）。

### P1-1 生成入口语义已升级（401 授权门），文档未跟进

- **证据**：`server/index.mjs:269` `authorizeGeneration(...)` → 未授权 **401 UNAUTHORIZED "生成接口需要服务端授权。"**（v1/v2 均先鉴权）；浏览器实测 alert "生成失败（HTTP 401）"。503 AI_NOT_CONFIGURED 仅在鉴权通过后无 key 时出现（`index.mjs:315` 附近）。
- **影响**：任何仍写"未配密钥=503"的文档/口径都会误导演示者与部署者；部署需要注入 generationAccess（Trusted deployment injection only）。
- **修复**：新 README 已按新语义描述；详细措辞请 server 负责人在 server/README 同步。

### P1-2 ZIP 导出已实现，旧"未接入"口径作废

- **证据**：`src/integrations/project-export/ExportProjectButton.tsx` 存在；浏览器实测 Workshop 出现"导出 React 项目"按钮（Q6 状态页按钮清单）；`docs/project-zip-export.md`、`tools/project-zip-export/`、`test:workshop-export` 均在 main。
- **修复**：新 README/演示脚本改为"可导出 React 项目（ZIP）"；旧"后续版本提供"文案不再使用。

### P1-3 环境要求未在根级声明

- **证据**：`server/package.json` engines node>=22.16.0；根 `package.json` 无 engines；main 的 devDependencies **不含 playwright**（浏览器测试需自行 `npm i --no-save playwright@<ver>`，本轮 1.64.1 实测通过）；server 需先 `npm --prefix server run build` 生成 `.generated/`（harness 实测缺它则 ESM 导入失败）。
- **修复**：新 README 集中声明（含 harness 前置步骤）。

### P2-1 三路由演示主线无文档

- **证据**：`src/main.tsx` 按 pathname 渲染 `/`（旧学习 Demo，MochiPanel Mock）、`/ai-create`（正式主线，**新增创建方式下拉：AI 应用（原有 v1）/ 可信番茄钟（离线演示）**）、`/app-renderer`（示例页）。
- **修复**：新 README 路由表 + 演示脚本口径。

### P2-2 server/README 过时表述（交 server 负责人，不代改）

- 既有两句（"本阶段不修改前端或自动连接前端"、"本轮未修改 Vite 配置"）——前端已同源 `/api` 代理接入（harness 实际联通验证）。
- **新增**：错误码表未含 401 UNAUTHORIZED（授权门）；建议补充 v1 投影自检的行尾敏感性说明（见 FINDING F1，DEMO-QA-REPORT §2）。

## 2. 修复落实状态

| 问题 | 本轮动作 | 状态 |
| --- | --- | --- |
| P0-1 无 README | 根 `README.md` 随本 PR 提交（proposed-README 更新版） | 本 PR |
| P1-1 401 语义 | 新 README + DEMO-SCRIPT/CHECKLIST 口径更新 | 本 PR |
| P1-2 ZIP 可导出 | 新 README/脚本改写 | 本 PR |
| P1-3 环境要求 | 新 README（含 playwright/server build 前置） | 本 PR |
| P2-1 路由主线 | 新 README 路由表 | 本 PR |
| P2-2 server/README | 仅记录，交 server 负责人 | 待转发 |
| FINDING F1 CRLF | DEMO-QA-REPORT §2 完整根因+复现+修复建议 | 交 server owner |