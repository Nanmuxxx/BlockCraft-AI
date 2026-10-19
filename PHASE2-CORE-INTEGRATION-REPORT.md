# Phase 2 Core remediation candidate

结论：**BLOCKED，禁止合并**。入口冲突已按单一所有者交付补丁解决，Core 和独立安全测试通过；Docker 缺失依赖尚未修复，独立 QA 正式组合浏览器证据仍在等待。

## 精确版本

| 对象 | SHA |
| --- | --- |
| 实时 main | b56a26a9803718d806bac3ddbd7fbe19e0c495c6 |
| 原 #42 Draft | 764f2dd023d3e3ca54af755f6291e142e0ccb915 |
| 历史 #40 Draft | 692b7f56e1df094f4db95e35cc3be1fc72cc3dfc |
| 安全 owner 来源提交 | 68ab4564b13a5f4b94b5d0c75a1f6d6eac66d356 |
| 本地组合代码 SHA | 63197299ab85330a63dc9af8525d5c5e8d78b48c |
| 本地组合 tree | ba8e37824ec0a4e2a5bfab77dbdf120b637faa35 |

工作树 `/Users/nanmuxun/BlockAI/BlockCraft-AI-phase2-core-remediation`；分支 `integration/phase2-core-remediation-20261019`。后续仅证据/文档提交不改变生产代码，远端 Git-data SHA 映射见 PUBLICATION.json。#40 和 #42 保持 Draft 历史参考，不与新组合同时申请合并。GitHub mergeable 不作为验收证据。

## 组合过程与所有权

从 main 创建隔离工作树，merge #42 时唯一文本冲突为 server/index.mjs admission；原始冲突保存于 remediation-logs/unresolved-entry-*。入口/安全 owner 明确拥有该文件单一修改权，其基于 #42 的精确 patch 保存为 OWNER-ENTRY-COMPOSITION.patch。先在临时 #42 文件验证 patch，再从合并结果按 hunks 组成，最终与 owner 目标逐字节一致，没有全文件 ours/theirs 选择。

保留 #42 strict envelope、UTF-8、取消/迟到 body、admission close/signal/finally，保留 #35 static/path/PublicOrigin/production listen；加入 v1/v2 都需 generationAccess 及受控 egress。默认认证失败关闭。安全来源现已发布为 Draft #44，远端 HEAD da212774b7022f95c036b1167ae2d204f65080bc；组合只取最小安全模块与测试，不整合其 live runner/证据。Mock harness 显式注入测试授权，模拟时钟等异步认证进入 readInput 后再推进；没有放宽生产校验。

从 owner 来源提交只整合五个 paid-gateway 模块、README、独立 security.test.mjs 及两 provider 的 native-egress 门禁 hunks，未带入 live runner、密钥、私密预算台账或真实样本。未修改 Docker/工作流/部署配置、ZIP 模板/导出器、Viewer 生产文件。main 既有 Docker 文件随 merge 保留，并非本轮编辑。

## 回归证据

完整命令、时间、HEAD、未提交代码及退出码位于 `docs/phase2-core/remediation-logs/commands.jsonl`。多数测试在组合提交前执行，日志列明工作树变更；6319729 包含当时全部代码。baseline 在该提交上运行。集合重叠，不累加。

| 命令（通过 tests/ai-core-night/check.mjs 记录） | 退出码 | 结果 |
| --- | --- | --- |
| npm --prefix server run build | 0 | 协议验证器 |
| npm run build | 0 | TS + Vite |
| node tests/ai-core-night/regression.mjs | 0 | 812/812，v1/v2、取消迟到、Artifact、Mochi、owner/CAS、v2 ZIP 拒绝 |
| node --test tests/paid-gateway/security.test.mjs | 0 | 11/11（先运行10项，再补金额上限测试），认证、默认失败关闭、native 出口、持久预算、并发、超时取消迟到、租约 |
| npm run test:mochi-host | 0 | 57/57，#36 授权 CAS |
| node --test tests/project-zip-export/export.test.mjs | 0 | 63/63，#41 |
| npm run test:workshop-export | 0 | 9/9，本地隔离导出 |
| npm test | 0 | 194/194 |
| node tests/phase2-core/audit-server-packaging.mjs | 1 | BLOCKED：ai-abort 与 gateway 启动闭包缺少两阶段 COPY |

早期编译日志发生于入口仍有冲突时，不能单凭该 build 声称服务端通过；随后 Core/security 测试使用已组成入口。

## 浏览器及打包阻塞

独立 QA 报告 Playwright 1.64.1、Chromium 156.0.8078.4、1366/390px 启动操作退出0。**环境 readiness 不等于组合正式页面通过**。已交付精确 6319729 给独立 QA，等待 /ai-create、B/C、Mochi、取消迟到、ZIP/v2拒绝日志和截图。旧 #42 missing-playwright 记录仍为历史 BLOCKED；#43 容器通过不能作为本候选证据。

完整启动闭包及 Docker 所有者补丁建议见 SERVER-PACKAGING-HANDOFF.md。ai-abort 和 paid-gateway 需上下文白名单及两阶段 COPY，显式 transport 使用还需 ledger 和安全状态契约。本轮不跨所有权修改 Docker，未声称容器通过。

## 审核顺序

1. 审查 OWNER-ENTRY-COMPOSITION.patch、安全认证/预算测试及默认关闭行为。
2. 审查共享 abort、v1/v2 响应验证、Artifact 存储不可逆边界和安装 CAS；保留 #42 成果，无新协议或 Runtime。
3. 审查 Host/Mochi 生命周期、授权撤销再授予、source-plan/reinstall；核对 #36/#41 回归。
4. 部署 owner 最小打包补丁，真实构建并启动无凭据容器，验证 health、未授权 v1/v2 零 provider 访问。
5. 独立 QA 对相同生产代码完成正式浏览器回归，再交 Tech Lead 裁决。不自动 merge/deploy。

跨团队接口见 PHASE2-CORE-INTERFACES.md。原 #40 分类与91提交清单保留于 PR40-*INVENTORY.json；旧报告归档为 PRE-REMEDIATION-REPORT.md，只作历史快照。

本聊天 `REAL_MODEL_CALLS=0`。没有沿用其他聊天付费授权、运行 live CLI、访问私密台账、执行不可信 TSX、Merge、Force Push 或部署。离线回归不证明真实模型质量、任意 TSX 安全执行或生产交付；不提供主观完成百分比。
