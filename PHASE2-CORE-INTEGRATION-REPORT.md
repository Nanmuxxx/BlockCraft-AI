# Phase 2 Core remediation candidate

结论：**BLOCKED，禁止合并**。入口冲突已按单一所有者交付补丁解决，Core 和独立安全测试通过；Docker 缺失依赖尚未修复，独立 QA 两项网关边界缺陷已按 owner 补丁修复，待独立复验；新候选最终验收仍在等待。

## 精确版本

| 对象 | SHA |
| --- | --- |
| 实时 main | b56a26a9803718d806bac3ddbd7fbe19e0c495c6 |
| 原 #42 Draft | 764f2dd023d3e3ca54af755f6291e142e0ccb915 |
| 历史 #40 Draft | 692b7f56e1df094f4db95e35cc3be1fc72cc3dfc |
| 安全 owner 来源提交 | 68ab4564b13a5f4b94b5d0c75a1f6d6eac66d356 |
| 原组合代码 SHA | 63197299ab85330a63dc9af8525d5c5e8d78b48c |
| 最新本地代码 SHA | 2d6f8ce2c282803e9f39270252e8395d3b6e77cb |
| 模型契约本地代码 SHA | a8ba5062066bb2bfae354337233ddecda554ab01 |
| #44 最终安全修复远端 HEAD | 032ffa19adcdc20b066e0d5fcee70136f4492119 |
| #44 模型契约远端 HEAD | 8ddac045125506f7129593b9d07fb0d50f9d72d3 |
| 本地组合 tree | ba8e37824ec0a4e2a5bfab77dbdf120b637faa35 |

工作树 `/Users/nanmuxun/BlockAI/BlockCraft-AI-phase2-core-remediation`；分支 `integration/phase2-core-remediation-20261019`。远端 Git-data SHA 映射见 docs/phase2-core/PUBLICATION.json。模型契约代码提交只纳入 owner 精确单行 allowlist 修复；未改入口。#40 和 #42 保持 Draft 历史参考，不与新组合同时申请合并。GitHub mergeable 不作为验收证据。

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
| node --test tests/paid-gateway/security.test.mjs tests/paid-gateway/model-contract.test.mjs tests/phase2-core/gateway-composition.test.mjs tests/custom-block-generation/provider.test.mjs | 0 | 36/36；精确模型、三消费者共享预算、v1/v2认证及预算耗尽、Mochi建议、Core取消测试 |
| node --test tests/paid-gateway/security.test.mjs tests/paid-gateway/model-contract.test.mjs tests/paid-gateway/audit-boundary.test.mjs tests/phase2-core/gateway-composition.test.mjs tests/custom-block-generation/provider.test.mjs | 0 | 40/40，追加审计超时/取消迟到/假密钥元数据及错误脱敏 |
| node tests/phase2-core/verify-remediation.mjs | 0 | 受保护文件、原始SHA祖先、入口blob与owner一致 |
| node tests/phase2-core/audit-server-packaging.mjs | 1 | BLOCKED：ai-abort 与 gateway 启动闭包缺少两阶段 COPY |

早期编译日志发生于入口仍有冲突时，不能单凭该 build 声称服务端通过；随后 Core/security 测试使用已组成入口。

## 浏览器及打包阻塞

独立 QA 已在 6319729 上完成 /ai-create 生成、B/C、取消迟到、Mochi 聊天、可信离线番茄钟、ZIP 及独立导出 CRUD 的正式页面操作，退出0。原始证据位于独立工作树 /Users/nanmuxun/BlockAI/BlockCraft-AI-phase2-qa631/evidence/phase2；命令 JSON 记录精确 SHA、环境、退出码，generation/workshop/pomodoro/mochi-host/pr44-replay 保留报告和截图。Mochi 修改只验证 Fixture Host，正式修改入口仍禁用。新模型补丁及后续安全修复不能自动继承旧 SHA 验收。旧 #42 missing-playwright 记录仍为历史 BLOCKED；#43 容器通过不能作为本候选证据。

独立 QA 的 gateway-independent 补充测试退出1，复现 onResponse 审计回调无界等待及上游 model 回显假密钥哨兵的问题。已交安全 owner 最小修复，未发生真实密钥泄露声明。两项已纳入 owner 精确补丁 OWNER-AUDIT-BOUNDARY.patch，固定模型元数据并使异步审计共享截止时间；最新代码 2d6f8ce，40/40开发方回归通过，原独立失败仍保留并待独立QA复验。Docker 阻塞仍待解决；不得将原有11项安全通过描述为全部安全验收完成。

完整启动闭包及 Docker 所有者补丁建议见 SERVER-PACKAGING-HANDOFF.md。ai-abort 和 paid-gateway 需上下文白名单及两阶段 COPY，显式 transport 使用还需 ledger 和安全状态契约。本轮不跨所有权修改 Docker，未声称容器通过。

## 模型与出口契约

正式 #44 源码及补丁八项 blob 与初始候选逐项相符，见 FORMAL-SECURITY-SOURCE.json。付费组合必须显式 model:PRICING.model 并对三消费者共用同一 branded transport 与 canonical ledger。旧默认模型保留且在网关前失败关闭，不做隐式映射。allowlist 单行修复见 OWNER-MODEL-CONTRACT.patch；不启用 CustomBlock、不编译执行生成 TSX。requireControlledEgress 只拦截原生 fetch，任意注入函数属于可信服务端代码；不能宣称防恶意服务端代码绕过。详细冲突/依赖/风险见 docs/phase2-core/COMPOSITION-DECISIONS.md。独立631历史证据快照见 docs/phase2-core/independent-qa631/，不归属于新代码。

## 审核顺序

1. 审查 OWNER-ENTRY-COMPOSITION.patch、安全认证/预算测试及默认关闭行为。
2. 审查共享 abort、v1/v2 响应验证、Artifact 存储不可逆边界和安装 CAS；保留 #42 成果，无新协议或 Runtime。
3. 审查 Host/Mochi 生命周期、授权撤销再授予、source-plan/reinstall；核对 #36/#41 回归。
4. 部署 owner 最小打包补丁，真实构建并启动无凭据容器，验证 health、未授权 v1/v2 零 provider 访问。
5. 独立 QA 对相同生产代码完成正式浏览器回归，再交 Tech Lead 裁决。不自动 merge/deploy。

跨团队接口见 PHASE2-CORE-INTERFACES.md。原 #40 分类与91提交清单保留于 PR40-*INVENTORY.json；旧报告归档为 PRE-REMEDIATION-REPORT.md，只作历史快照。

本聊天 `REAL_MODEL_CALLS=0`。没有沿用其他聊天付费授权、运行 live CLI、访问私密台账、执行不可信 TSX、Merge、Force Push 或部署。离线回归不证明真实模型质量、任意 TSX 安全执行或生产交付；不提供主观完成百分比。

## Final #45 + #46 update (supersedes earlier packaging/default blockers)

Local production SHA **47a0c45bc95834d575a07e986b0b3987a9accff7** includes Docker #46 **278b13008fcbd90eb874e067ca3ffc1b33fef664** via no-conflict merge9d7e31b. Docker files equal owner source. Model default owner f21a1249aa7cf4813291333d351039906112bdfd verified COMPOSED-DEFAULT-ENTRY.patch: paid-branded adapters default exact PRICING.model, offline retains legacy; explicit invalid model/env fails before paid reserve/network. Helper default does not grant authentication/budget permission. Entry blob bdab61b76c92fa775c286edeb39e70b88467fdda; Core abort/static behavior retained. Owner contextual patch replaces its initial positional draft.

Final `node tests/ai-core-night/regression.mjs`: exit0,812/812; `npm run build`: exit0; security/model/audit/gateway-composition/CustomBlock Provider combined tests: exit0,43/43. `verify-remediation.mjs`: exit0. Static old auditor against #46 curated stage: exit2 REQUIRES_CONTAINER_ACCEPTANCE, not missing-file proof and not container success. Full logs and commands.jsonl retained. Original independent QA failures remain historical; fixes verified independently on2d6f8ce are not acceptance of47a0c45. New exact production SHA sent Agent C; Docker exact CI still required. Main remains b56a26a. Final verdict **NO-GO / BLOCKED** until independent final-model/security/browser and real combination container acceptance.

Review scope/de-duplication and model precedence: docs/phase2-core/COMPOSITION-DECISIONS.md. #45 is the sole candidate; do not separately integrate #42/#44 shared entry afterward. #46 is now incorporated dependency, not evidence of a second production rewrite. Remote final candidate is mapped by exact tree during publication; PR HEAD records remote SHA, not local metadata SHA.

安全 owner 默认值修复已正式发布 #44 aa7766615e0b6bddfe9c72a6f1709a302d3629ca（原始来源032ffa19仍记录）；owner逐字节确认当前入口与其独立组合相同，SHA256 ebff44f0048f7436aca55bfcc84ec2b25c922f57d321adf120f1f23b3b0b8d78。
