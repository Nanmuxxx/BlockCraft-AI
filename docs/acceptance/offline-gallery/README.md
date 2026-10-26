# 离线图库 MVP 工程交付

2026-10-26 在 Windows 本地重新执行验收：类型检查、生产构建、224 项默认测试、117 项回归、已有 ZIP 浏览器 4 场景和 M00–M13 **离线范围 PASS**。这些是本轮实际运行结果，不引用历史报告作为通过依据。GitHub CI 的实际状态以 PR checks 和对应 Actions run 为准，本文件不预先宣称 CI 通过。

## 版本与改动范围

- 仓库：`Nanmuxxx/BlockCraft-AI`；开发分支：`codex/gallery-single-offline`。
- 固定历史审计 SHA：`c5e0f77878098fd9cfe35514992256bd7abd7343`。
- 本轮测试时 HEAD、fetch 后的 `origin/main`：`01e78916807108031e30056cd1aeb6b0c6c89358`，二者无分叉。测试针对这个 HEAD 加本功能工作区改动；精确文件摘要见 [local-results.json](local-results.json)。提交后的精确 SHA 由 PR HEAD 和 CI `tested-sha.txt` 记录，避免把基准 SHA 说成实现 SHA。
- 历史审计基准到当前 base 为 4 个既有提交（图片、README 及合并），不属于本 PR。未更新本地 main。
- 开始时暂存区为空，6 个已跟踪文件修改、11 个未跟踪文件。与前次交付的 17 个文件摘要核对，功能源码相同；本轮只调整测试的 CI 适配和可复现文档，另加工作流及交付材料，未发现额外不明改动。
- 曾报告的 `controller.ts` TS1005 已在本轮开始前修好。本轮 `tsc -b` 再次通过，未为通过测试删除既有功能。

| 文件范围 | 用途 |
|---|---|
| `src/integrations/gallery-generation/{offline.ts,controller.ts,GalleryImagePanel.tsx,gallery-generation.css}` | Canvas 示例、单候选预览、确认/取消、原生解码、容量与上下文校验 |
| `src/integrations/project-workspace/{repository.ts,session.ts,WorkspaceControls.tsx}` | 原子持久化、存储版本比较、采用收据、保存/恢复入口及提交结果核实 |
| `src/integrations/project-json/{database.ts,backups.ts}` | 共用既有备份数据库，非破坏性增加当前作品存储 |
| `src/integrations/custom-block-bc/owner.ts`、`src/model/customProjectSession.ts` | 保存期间独占发布权限；复用原有完整项目校验和单一 owner |
| `src/components/ai-create/AiCreate.tsx`、`src/components/app-builder/AppSpecWorkshop.tsx` | 离线图库入口、启动恢复、切换保护、B/C 共享状态 |
| `package.json`、`tests/gallery-generation/*` | 浏览器验收脚本、故障/容量测试、回放说明；无项目依赖变更 |
| `.github/workflows/offline-gallery.yml` | PR 自动运行离线检查、上传日志/截图/轨迹；不使用模型密钥 |
| `docs/acceptance/offline-gallery/*` | 本轮报告、命令/退出码/摘要、精简截图 |

## 实现与兼容性

入口为 `/ai-create` → “图库单张练习（离线，不调用模型）” → “打开离线图库”。既有项目也可在 B 模式添加或选择图库。

Canvas 根据描述生成配色风景 PNG，尺寸 320×240，明确标注离线示例。生成只创建冻结的候选，不改变 owner。确认时复用现有命令校验，将资源和 `gallery.imageIds` 引用一起组成下一版本，再经过既有 JSON、ZIP、图片解码与资源限制检查。

保存使用现有 `blockcraft-project-backups` 数据库 v2：保留 `projects` 备份 store，仅增加 `current-workspace`。单个 IndexedDB 事务检查 sequence，并写入完整项目 JSON 和采用收据；事务完成后才发布单一 owner 的新快照，B/C 因而读取同一 AppSpec。配额/事务失败保留旧作品；若提交已完成但界面发布失败，或结果无法核实，则锁住进一步写入并提示“恢复本机保存版本”，不把已提交数据误报为已回滚。旧备份恢复和替换前备份仍保留。

AppSpec 1/2、CustomProject 2、项目 JSON 1、可恢复项目 ZIP 1 均不改格式。JSON 保留图片 data URL 和元数据；ZIP 使用既有 manifest/project/assets 格式，包含图片二进制及哈希。采用收据仅存在本机当前记录，不带入便携项目。导入后是新工作区，需“保存到本机”才能刷新继续。React 源码 ZIP 仍是原有独立入口和限制，不能用其替代可恢复项目 ZIP。

v1→v2 升级已经在隔离数据库中验证旧备份可读。降级至只打开 v1 数据库的旧应用**未验证且不保证可用**；发布/回退应先导出项目 ZIP，关闭旧标签页，保留数据库与备份，不删除数据解决版本错误。

## 本轮实际命令与退出码

环境：Windows、Node v24.19.0、Chrome 155.0.8059.85、Playwright 1.62.1；桌面 1440px 和移动宽度 390px。测试使用全新隔离浏览器上下文，不读取个人 Chrome 配置或作品。模型 API 与外网均被拦截；实际记录外网请求 0、AI 请求 0、页面错误 0。

| 实际命令 | 退出码 | 结果 |
|---|---:|---|
| `node node_modules/typescript/bin/tsc -b` | 0 | PASS |
| `node node_modules/vite/bin/vite.js build` | 0 | PASS；主 JS 550.97 kB 的体积提示保留 |
| `node --run test` | 0 | PASS：224/224，无跳过 |
| `node tools/project-zip-export/prepare.mjs` | 0 | PASS：生成既有导出测试所需协议产物 |
| `node --test tests/project-json/*.test.cjs tests/project-package/*.test.cjs tests/custom-block-bc/*.test.cjs tests/workshop-export/*.test.*` | 首次 1；重跑 0 | 首次 113 PASS / 4 FAIL，均为沙箱 `connect EACCES 127.0.0.1`；允许本机回环连接后相同命令 117/117 PASS，未改代码或断言 |
| `node tests/project-package/browser.cjs` | 0 | PASS：已有 JSON/ZIP 浏览器 4 场景 |
| `node --run test:gallery-offline:browser` | 0 | PASS：M00–M13 离线项目 |
| 真实图像模型、计费与供应商安全验证 | — | NOT RUN：未授权，离线 MVP 不包含 |

完整命令、起止时间、退出码、日志哈希和浏览器断言结果见 [local-results.json](local-results.json)。本地完整产物位于不提交的 `.cache/gallery-pr-evidence/`；PR CI 会重新产生完整证据并以 `offline-gallery-<run_id>-<attempt>` artifact 保存 14 天。下载后应长期归档，不将大量轨迹或缓存加入源码仓库。

## M00–M13 验收矩阵

下表中的“实际”来自本轮 `browser/report.json`，已收入 `local-results.json` 的 `browser.cases`。M01–M05 通过真实按钮、下载、上传和刷新操作完成；M06–M12 在真实浏览器中调用生产模块、原生图片解码和 IndexedDB 注入故障；M13 用同一上下文的两个真实页面争写。故障注入不是点击 UI 的人工演示，未将其描述为视频验收。

| ID / 目标 | 执行步骤 | 预期 | 实际结果 / 状态 | 证据位置 |
|---|---|---|---|---|
| M00 版本 | 读取 Git、加载服务端控制器源码 | 正确工作区和代码 | HEAD/分支及源码匹配；PASS | `browser.cases[M00]`、CI `tested-sha.txt` |
| M01 预览/取消 | 生成、导出 JSON、放弃、再次生成 | 确认前不修改原作 | revision=0、0 资源；取消前后相同；PASS | `01-before.json`、`02-preview-only.json`、`03-cancelled.json`、trace |
| M02 有效图片 | 原生解码、检查目标、计算哈希 | 单张 PNG 与目标明确 | 320×240、8375 bytes、哈希已记录；PASS | `browser.cases[M02]`、`02-candidate.png` |
| M03 采用/B/C | 确认保存、检查 B 勾选、切 C | 一次资源/引用/版本提交 | revision=1、1 资源/引用/收据，B/C 字节一致；PASS | `04-adopted.json`、`05-c-mode.json`、[C 截图](adopted-c-mode.png) |
| M04 刷新 | reload 后导出、读 IDB | 完整作品可恢复 | 项目及保存记录完全相等；PASS | `06-reloaded.json`、`04-refresh-restored.png`、trace |
| M05 ZIP 恢复 | 下载、关闭上下文、新上下文导入、保存/刷新 | 包含图片且可继续编辑 | JSON 相同、重导 ZIP 逐字节相同、刷新显示；PASS | `gallery-project.zip`、`gallery-restored.zip`、[导入截图](isolated-import.png) |
| M06 失败处理 | 注入生成/取图、签名、格式、解码、容量失败 | 不改原作，不重试 | 6 类均保留旧头，每次调用 1；PASS（离线） | `browser.cases[M06]`；真实计费 NOT RUN |
| M07 保存失败 | IDB beforeWrite 注入 quota/abort；提交后注入激活失败 | 失败保留旧版；已提交可恢复 | 回滚/提交边界符合预期；PASS | `browser.cases[M07]` |
| M08 幂等 | 3 次并发确认、重复、恢复后收据重试、丢响应/读失败 | 不重复写入，未知结果锁定 | 1 张/1 收据；恢复和重试保护通过；PASS | `browser.cases[M08]` |
| M09 失效候选 | 编辑、删除图库、释放工作区、撤销再授权 | 拒绝过期候选 | 全部拒绝且保留当前作品；PASS | `browser.cases[M09]` |
| M10 取消/超时 | 延迟 provider，取消/超时后再返回 | 晚到响应无效、不重试 | 每次只调用 1 次；PASS（离线） | `browser.cases[M10]`；真实费用未知/密钥轮换 NOT RUN |
| M11 兼容 | 无/空/已有 assets 保存与 JSON/ZIP；坏引用；旧 DB | 原格式可恢复、旧备份保留 | 各类 roundtrip、坏引用拒绝、v1→v2 通过；PASS | `browser.cases[M11]`、117 项回归 |
| M12 容量 | 实际 PNG 512KiB/总1MiB/32张及+1；JSON/ZIP边界 | 边界接收、超限拒绝，旧版完整 | 所有断言通过；PASS | `browser.cases[M12]`；ZIP 容器边界与领域准入分别验证 |
| M13 多页面 | 两页读同一 sequence 并发保存 | 一成功一冲突 | 1 成功、1 STORAGE_CONFLICT、sequence=1；PASS | `browser.cases[M13]` |

可复现的操作步骤与 Playwright 安装/回放命令见 [测试说明](../../../tests/gallery-generation/README.md)。`demo-2.trace.zip` 覆盖生成→预览→取消→采用→保存→刷新→导出；`demo-3.trace.zip` 覆盖空上下文 ZIP 导入→保存→刷新。轨迹包含截图和操作快照，未生成或宣称存在 MP4。

## 已知限制与审查重点

- P0：本轮已执行的离线验收未发现阻塞错误。PR/CI 仍需以真实远端结果和负责人审核为合并依据。
- P1（范围限制，不是离线合并阻塞）：只提供 Canvas 示例，不是真实 AI 图像生成；真实供应商、成本、安全和跨供应商行为全部 NOT RUN。不得据此启用付费服务。
- P1（数据边界）：仅当前浏览器/站点的一份当前作品，无账号云同步；普通编辑需手动保存。浏览器清理/私密会话退出可能丢失本机数据，应导出 JSON/ZIP。跨设备仅通过项目文件迁移。数据库降级未验证。
- P2：最多 128 条本机采用收据，达到上限会要求导出再导入为新项目；限制与 JSON/ZIP 预算保持一致。
- P2：本地只验证 Windows Chrome；390px 是桌面浏览器视口模拟，非真实手机。Firefox、Safari、真实移动设备 NOT RUN；Linux Chromium 结果以新增 CI 为准。
- P2：生产构建的 550.97 kB 主 chunk 体积提示未调整阈值，也未为本次交付进行无关拆包。
- 人工审查重点：IndexedDB 升级/回退边界；事务完成与 UI 发布之间的恢复行为；共享 owner 的持久化租约及现有编辑入口兼容；CI 是否对应当前 PR HEAD。

本次未修改生产鉴权、密钥、预算或部署配置。未引入新的项目依赖。历史协调背景：#57；本 PR 不关闭该 Issue，也不依赖 Supervisor 自动处理。
