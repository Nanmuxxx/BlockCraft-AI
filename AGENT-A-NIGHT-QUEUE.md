# Agent A 夜间任务账本

- 开始日期：2026-10-19（Asia/Shanghai）。约六小时窗口；所有结论以实际证据为准。
- 分支：`agent-a/ai-core-night-20261019`；worktree：`/Users/nanmuxun/BlockAI/BlockCraft-AI-agent-a`。
- 基线：`4044fb185a2720eead0dc6710b0d38a215439b98`。HTTPS fetch 已尝试，缺少凭据；已连接 GitHub `fetch_commit(main)` 核对同一 SHA。
- 开放 PR：#35 Docker（不触碰）、#36 Mochi Host 测试（不覆盖其测试文件）。已有 worktree/分支通过 `git worktree list`、`git branch -r` 检查。
- Agent B：`agent-b/react-zip-night-20261019`，正在修改 `tools/project-zip-export/templates.mjs`。本分支禁止编辑导出器、模板、部署及冻结材料。
- REAL_MODEL_CALLS=0。服务测试显式注入固定 Fixture；不读取 `.env`、生产密钥或私人材料。

## 当前任务（2026-10-19 02:32）

已完成第一轮链路恢复、生成/协议/取消修复和离线端到端验证；继续接口审计、核心回归、生产浏览器盲区与 Draft PR 准备。六小时窗口尚未结束，不声称已工作六小时。

## 已完成与 Commit

- `fd861f9`：生成客户端 128 KiB/fatal UTF-8、45 秒截止、取消、v1/v2 分离。
- `b4c8c42`：最小选中上下文模型计划适配器；服务 HTTP→客户端→Runtime→Mochi 确认→B/C 离线案例。
- `dce2212`：服务端严格 completion 包络、UTF-8；测试命令/退出码记录器。
- `40f9db5`：不服从 AbortSignal 的传输/响应体仍按时释放服务并发。
- `0544d74`：既有 Mochi 浏览器用例通过模型 JSON seam 重跑。
- `c73edba`：v1 业务质量评估拒绝合法 v2，避免错误协议验收。
- `98865fe`：客户端/服务端未使用及迟到响应体取消。
- `e7feadc`：Mochi completion 不响应取消时立即退休；修正测试漏传 requestId。
- `ad36214`：CustomBlock Provider 相同边界、混合 error/工具包络拒绝。
- 源码计划：取消不再等待永不完成 provider；修复同步 abort 重入共享 epoch（9f42962）。

修改文件精确清单使用 `git diff --name-status 4044fb1...HEAD`。未编辑 Docker、导出器模板、冻结视频、PR #36 Host 测试或 Agent B 文件。

## 测试结论

每个命令、参数、开始/结束时间、退出码见 `docs/agent-a-night/logs/commands.jsonl`，原始输出保留（含失败及修复后重跑）。早期命令见同目录 legacy 日志。

- 生成/服务/响应体释放：56/56；模型计划与服务垂直：13/13。
- 生成/质量/CustomBlock/隔离/可信样本编译：187/187；只编译仓库审核样本，未执行组件。
- CustomBlock Provider+Pipeline：26/26；源码计划：37/37。
- 桌面/手机：生成、正式离线可信番茄钟、番茄钟替换竞态、Artifact 正式入口、Artifact 安装竞态、Mochi 模型计划 fixture、Mochi 正式只读建议全部通过。
- 生产构建通过，最新 build-after-source 退出码 0；后续源码变更仍需构建。
- 曾失败：构建前置产物缺失、质量评估版本边界、测试计数设置、漏传取消 ID、dispose 错误优先级、新重入复现。均保存失败证据，已针对修复重跑。

## 阻塞与下一任务

- Git HTTPS 无本机凭据：通过已连接 GitHub Git-data API 发布独立分支/Draft PR；不能称 fetch 成功。
- 真实 DeepSeek 付费调用未授权：REAL_MODEL_CALLS=0；继续已审核 fixture 通路。
- 正式 Mochi 修改入口仍 unavailablePlanProvider；新 seam 不隐式启用付费或网络。需要独立服务鉴权/费用接口契约。
- 任意 TSX Viewer 缺少验收隔离后端：保持 execution denied。
- 会话内参数保存/重装已测，不提供跨刷新持久化。保留版本历史可能长期增长，需设计保留策略而非直接删除回滚证据。
- 下一步：更新差距矩阵及跨模块契约；相关完整回归；浏览器覆盖剩余边界；发布 Draft；持续推进安全独立队列。

- 最新完整核心回归 core-complete：568/568；正式 CustomBlock Workshop 桌面/手机均通过。
- `4c40e94`：Mochi instruction+选中上下文 UTF-8 64 KiB 出站限制；model-request-bound-fixed 14/14（首次测试使用错 fixture 层级，已保留失败）。
- 接口契约已写入 `docs/agent-a-night/AI-CORE-INTERFACE-CONTRACT.md`；生产修改传输及 Viewer 仍待独立验收。

## 第二轮进展（02:32）

- Draft PR #40 已创建并关联；通过 GitHub Git-data API 发布21个提交，逐一验证blob/tree SHA。远端HEAD `a638a31df15ccde8562807682244959380843ed9`；本地HEAD `031eac6`，文件树相同。
- `5ac2d22` 源码注册表取消39/39；`49627e8` 建议客户端传输/严格UTF-8；`baeffb1` 会话取消/同步重入25/25。
- `a0c8eec` Artifact prepare取消/替换/关闭，安装及源码相关63/63；首次夹具同摘要未触发目标查询，修正后旧代码3项超时、新代码通过，日志均保留。
- `031eac6` Mochi HTTP严格UTF-8、可信access五秒上限、断连取消；23/23。
- core-checkpoint622/622，构建0，正式Artifact桌面/移动通过。Mochi页面并发Vite时初始输入框超时；串行重跑通过（浏览器缓存冲突为待确认原因）。
- 阶段报告 `NIGHT-AGENT-A-REPORT.md` 已建立，仍持续开发；不得声称六小时已过。
- 当前：同步报告/测试账本并复核服务入口边界。下一步：审计项目文件读取与参数持久化边界，保留租约/CAS和execution denied。
