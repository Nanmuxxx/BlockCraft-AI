# Phase 2 AI Core 集成候选报告

## 结论

**READY FOR REVIEW（代码审查）；BLOCKED（正式集成验收）**。

不是 merge/deploy GO：Playwright 未运行；#35 打包遗漏新静态依赖；legacy generation 准入仍需独立 paid-gateway 补丁。未合并、未部署、未改 #40 历史，未绕过 Viewer，`REAL_MODEL_CALLS=0`。

## 精确基线与候选

通过已授权 GitHub 接口核验：

| 对象 | SHA / 状态 |
|---|---|
| main | `25773e6d65e4e5a2b29d125baa2510f4a10aa343` |
| PR #40 | `692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`，open / Draft，91 commits / 378 files |
| #36 | merged，merge `d73b85915facd140ac2e17f90aca60da308b484b` |
| #41 | merged，head `e96aa6e6ba4370ee42fbd9e2e155de2ab59a8f2e`，merge 即 main |
| 临时完整组合 | `a68c6e6b3078f228283566c6b8db0867f06ca4f4`，main + 精确 #40 HEAD，零文本冲突 |
| 精简代码候选 | `4787da21ebf60bc5110bddc3f6edf1f49b34a072`，直接以 main 为 parent |

临时组合树 `642a0e568b5a081b5eea88c7e3268ec957abeb28`。完整组合与精简候选的 src/server/既有 tests 内容相同；tools、#36 host.test、#41 exporter/tests 相对 main 未变。自动验证见 `tests/phase2-core/verify-extraction.mjs`。此脚本依赖本地保留组合 commit，不能在缺少该 Git 对象的浅克隆中单独运行。

发布 HEAD 在 Draft PR 元数据中给出；它仅在代码候选上添加本报告、契约、清单、验证脚本和日志。测试日志绑定上述代码 SHA；不把文档提交称为已重新测试生产代码。

Git HTTPS fetch 缺少本机认证而失败；未索取 Token。使用授权 GitHub API 核验远端精确对象，复用本地已有 commit；发布使用 Git-data API、main parent、新分支和非 force ref。GitHub mergeable 不作为测试证据。

## 全部差异与拆分

全组合：378 files，44200 additions / 203 deletions。逐文件清单 `docs/phase2-core/PR40-FILE-INVENTORY.json`，逐提交清单 `PR40-COMMIT-INVENTORY.json` 包含全部 91 SHA、subject、paths 和模块标签。按路径分类：**19 生产文件 + 40 测试/工具文件 + 319 历史证据/文档文件**。

候选保留 59 文件、3349 additions / 203 deletions 的代码/测试补丁；319 个历史日志、截图和报告继续保留于原 #40，不进入新候选。历史报告属于当时快照；本报告的状态结论优先。源证据可通过仓库 #40 精确 HEAD 访问。

没有盲目 cherry-pick 91 个交错提交：生成取消、共享 abort、Host 生命周期与安全测试多次迭代互相修正；拆开可能重新引入竞态。本候选基于最新 main 提取完整最终路径补丁，保持既有安全边界原子性。后续可在审查通过后按模块提取，但需重跑每个组合，不能以单文件通过推断其可独立合并。

| 模块 | 生产差异 / 审核结论 | 对应测试证据 |
|---|---|---|
| DeepSeek / v1-v2 | index、trusted-interactive、ai-abort、generateApp：响应边界、取消/迟到、strict envelope；协议受控范围 VERIFIED；真实模型质量未验证 | generation 34；protocol 31；core ingress/client-boundary/gate |
| Generated Artifact | install/ui：捕获输入、session ticket、snapshot/authorization/epoch、取消和确认边界；VERIFIED（数据安装） | core generated-artifact/install、generated-artifact-ui/ui |
| CustomBlock | generator/provider/store：严格响应、取消与持久化结果边界；VERIFIED（离线） | core pipeline/provider/installation/reinstall |
| Runtime / owner / revision / CAS | 未替换 Runtime；Host/installer/source planner 复用唯一 owner；VERIFIED（测试范围） | #36 host 57；core owner/authorization/planning |
| Mochi Host / Conversation | host/modelPlanProvider、mochi-ai client/context/workshop、source providers/planning：上下文与同意生命周期、受限模型计划 seam；PARTIAL（生产 provider 未启用） | core model-plan/host-cancellation/consent-lifecycle/source-plan |
| B/C | 无 renderer 生产差异；通过既有 session projection 验证参数/版本一致性；PARTIAL（任意 TSX Viewer 未验收） | core custom-block-bc、reinstall、workshop |
| 测试/证据 | 40 文件进入代码提取；319 历史文件保留 #40；浏览器脚本存在不等于通过 | 下表、commands.jsonl、逐文件 inventory |

## 组合构建与回归

工作树：`BlockCraft-AI-phase2-core`（完整组合）及 `BlockCraft-AI-phase2-core-candidate`（精简候选），均独立于 main 原工作目录。无覆盖其他 Agent 工作树。临时组合与精简候选各跑核心 812 项，均通过。

精简候选所有命令原文、SHA、开始/结束、exit code、stdout/stderr 位于 `docs/phase2-core/logs/commands.jsonl` 及关联 txt。使用 `tests/ai-core-night/check.mjs` 记录退出码，不用管道掩盖失败。

| 命令 | exit | 结果 |
|---|---:|---|
| `node tools/project-zip-export/prepare.mjs` | 0 | 本地导出构建前置 |
| `node tests/ai-core-night/regression.mjs` | 0 | 含 server build/protocol 前置；812/812，0 skipped |
| `npm test` | 0 | 194/194 |
| `npm run build` | 0 | TypeScript + Vite production build |
| `npm run test:mochi-host` | 0 | 57/57，包含 #36 missed authorization/revision notification 与 CONFIRMING 测试 |
| `node --test tests/project-zip-export/export.test.mjs` | 0 | 63/63，#41 exporter 回归 |
| `npm run test:workshop-export` | 0 | 9/9 |
| `npm run test:generation` | 0 | 34/34，离线受控 transport |
| `npm run test:trusted-interactive` | 0 | 31/31，包含 v2 ZIP 拒绝 |
| `npm run test:generation:browser` | 1 | **BLOCKED**：Cannot find module playwright，未启动浏览器，无新截图/浏览器通过证据 |
| `node tests/phase2-core/verify-extraction.mjs` | 0 | source 等价、#36/#41 blob 保留 |

各测试集合重叠，不累加成唯一测试总数。取消、超时忽略 abort、迟到响应、owner 撤销再授权、同 revision 替换 snapshot、source-plan 与 reinstall 边界见 core-discovered 日志逐项 test name。v2 ZIP 拒绝由 trusted-interactive/export 测试确认；通过的 v1 ZIP 不能外推为 v2 可导出。

## 依赖、冲突与审核顺序

1. 先审查 main 基线保留证明与 59 文件提取；原 #40 保持 Draft，不整体合并 319 份历史证据。
2. 审查共享 `ai-abort`、generation 严格边界、v1/v2 provenance 与取消测试。
3. 审查 Artifact/store 不可逆边界、owner/CAS、Host 授权 generation、Mochi source confirm/history，再复核 #36 与 #41 组合结果。
4. 审查 `PHASE2-CORE-INTERFACES.md`，由 paid-gateway 所有者提供最小 `server/index.mjs` 准入/fetch 组合补丁。该文件的后续修改权已保留给协调方，本轮无新增生产修改。legacy 未认证入口是启用真实凭据前的阻塞，不因离线回归而消失。
5. 部署团队处理 #35，再跑新容器组合验收。#35 实时仍 open/unmerged，head `8867eac0a30129447961f3b8f6ffcc43d827e91a`；GitHub files 中 Dockerfile build/runtime 两阶段均未 COPY `server/ai-abort.mjs`，而本候选 index 等模块静态 import 它，组合预计启动失败。另 runtime COPY 未包含 build 中的 project-export，应由部署/ZIP 负责人核实完整依赖。未修改 Docker、未执行部署、未把 #35 自身验收当组合证据。
6. 在具备 Playwright 的环境补齐正式页面、取消/竞态、B/C 往返与 ZIP 浏览器验收。未完成前保留 Draft 和 BLOCKED；Viewer 团队另行验收 TSX 隔离，不可绕过。

## 后续最有价值工作

先解决入口准入、打包和浏览器三类独立验收，再决定是否将原子 Core 补丁拆为更小的独立候选；不要继续扩大生产功能。当前可证明：受控协议与唯一 owner 的离线生成/编辑/安装数据闭环；尚不能证明真实付费模型生成质量、任意 TSX 安全运行、完整浏览器流程或生产部署。无百分比完成度声明。
