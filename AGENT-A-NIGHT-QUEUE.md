# Agent A 夜间任务账本

- 开始日期：2026-10-19（Asia/Shanghai）。约六小时窗口；所有结论以实际证据为准。
- 分支：`agent-a/ai-core-night-20261019`；worktree：`/Users/nanmuxun/BlockAI/BlockCraft-AI-agent-a`。
- 基线：`4044fb185a2720eead0dc6710b0d38a215439b98`。HTTPS fetch 已尝试，缺少凭据；已连接 GitHub `fetch_commit(main)` 核对同一 SHA。
- 开放 PR：#35 Docker（不触碰）、#36 Mochi Host 测试（不覆盖其测试文件）。已有 worktree/分支通过 `git worktree list`、`git branch -r` 检查。
- Agent B：`agent-b/react-zip-night-20261019`，正在修改 `tools/project-zip-export/templates.mjs`。本分支禁止编辑导出器、模板、部署及冻结材料。
- REAL_MODEL_CALLS=0。服务测试显式注入固定 Fixture；不读取 `.env`、生产密钥或私人材料。

## 当前任务

1. 核心链路恢复与矩阵：代码检查完成，测试待逐项复核。
2. 生成客户端：统一有界响应读取、取消/超时、v1/v2 分离，补迟到响应回归。

## 下一任务

- 真实本地服务端协议 → 客户端 → Runtime → B/C 的离线垂直测试。
- Mochi 受控 AppSpec 修改适配器与确认/CAS/取消端到端测试。
- Artifact 安装/重新安装、参数持久化、v1/v2、安全审计与正式页面浏览器验收。
- 小范围提交，发布独立分支与 Draft PR，完成报告。

## 已修改文件与证据

初始文档：本账本、`AI-CORE-GAP-MATRIX.md`。每次功能提交后追加结果。

## 阻塞与可继续工作

- Git CLI HTTPS 无认证；可用已连接 GitHub 接口核对远端及发布独立分支，不能声称 fetch 成功。
- 真实 DeepSeek 付费调用未获授权：继续 Fixture 协议与错误测试。
- 任意 TSX 缺少隔离准入：保持 Viewer fail-closed，继续验证惰性 Artifact/源码版本与受控 AppSpec。
- 不因以上阻塞停止独立测试或开发。
