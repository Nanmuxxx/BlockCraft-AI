# PR #40 Windows 阻塞修复与主线组合验收

2026-10-19

## 1. 基线

- 仓库：`Nanmuxxx/BlockCraft-AI`
- 已实时核对 `main`：`b56a26a9803718d806bac3ddbd7fbe19e0c495c6`
- PR #40 远端 Draft head：`692b7f56e1df094f4db95e35cc3be1fc72cc3dfc`
- 修复分支：`phase2/pr40-windows-fix`
- 修复工作树：`F:\BlockCraft-AI\pr40-audit-692b7f5`
- 受测修复 tree：`e97be92a628cb12d9ea5f40f6596bdf0e09afb8d`
- 对应提交：`3cd545f3d1ed66ca68ca449179a16b098cdc132f`，父提交为 `692b7f5`

测试在提交前对上述 tree 的完整工作内容运行；提交后 tree 未变化。提交 SHA 只代表同一受测内容，不把历史 PR #40 结果当作当前结果。

## 2. 修改范围

- `server/aiGenerationPrompt.mjs`：LF/CRLF 归一化后再做 v1 协议投影，保留精确边界与字段校验。
- `server/index.mjs`：人工组合 main 的静态文件服务、`PUBLIC_ORIGIN`、生产监听与 PR #40 的可中止上游读取、严格 UTF-8、completion 包络校验、迟到响应体释放；API key 在任何交互预算预留前检查。
- `server/custom-block/store.mjs`：POSIX mode 检查保留；Windows 使用显式 PowerShell 5.1 模块路径、受保护 ACL、当前用户/SYSTEM/Administrators 白名单和复读验证，无法证明时 fail closed。
- `tests/generation/protocol-line-endings.test.mjs`：LF/CRLF 与缺失/歧义边界。
- `tests/generation/static-server.test.mjs`：组合后静态页面、资源与路径拒绝。
- `tests/trusted-interactive/budget-order.test.mjs`：空 API key 时不预留预算。
- `tests/custom-block-generation/windows-store-acl.test.mjs`：Windows ACL 私有性验证。
- 相关既有测试调整：Windows 上跳过不可用的 POSIX mode/symlink 断言，POSIX 覆盖保留；协议边界测试改为比较归一化源码。

## 3. 实际测试

环境：Windows 11 `10.0.26300`；Node `24.19.0`；npm `11.17.0`。所有命令退出码为 0，未调用真实模型。

| 命令 | 结果 |
| --- | --- |
| `npm run test:generation` | 37/37 |
| `npm run test:trusted-interactive` | 32/32 |
| `node --test --test-timeout=2000 --test-force-exit server/server.test.mjs` | 37/37 |
| `node --test tests/generated-artifact/install.test.cjs tests/generated-artifact-ui/ui.test.cjs tests/custom-block-workshop/reinstall.test.cjs tests/custom-block-workshop/authorization.test.cjs` | 53/53 |
| `node --test tests/custom-block-generation/*.test.*` | 100/100 |
| `npm test` | 192/192 |
| `npm run build` | 通过 |
| `npm run test:mochi-host` | 55/55 |
| `npm run test:workshop-export` | 9/9 |
| `npm run test:trusted-pomodoro-ui` | 2/2 |

Windows ACL 首次并行复跑暴露了 `PSModulePath` 混入 PowerShell 7 模块导致 `Get-Acl` 无法加载的问题，17 个存储相关测试失败；修复为 Windows PowerShell 5.1 专用模块路径后，单测 1/1、CustomBlock 100/100、Artifact 53/53 重跑通过。失败结果没有被删除或改写为通过。

## 4. 关键边界

- CRLF 修复只改变协议的换行归一化；缺失 pomodoro 扩展、错误版本边界或歧义结构仍被拒绝。
- 空 API key 在 access/budget 之前返回 `AI_NOT_CONFIGURED`，回归断言 `reservations === 0`，上游调用为 0。
- Windows ACL 不是“跳过检查”：目录必须非 symlink，ACL 必须受保护且 Allow SID 仅为当前用户、SYSTEM、Administrators；PowerShell/ACL 不可验证时返回 `STORE_PRIVATE_DIRECTORY_ACL_UNVERIFIED`。
- `server/index.mjs` 组合保留 main 静态文件路径与生产监听，同时保留 PR #40 的取消、严格 UTF-8、envelope 和响应体释放。
- trusted-interactive 原 30/31 的单项失败由 CRLF 协议投影触发；修复后该套件 32/32。

## 5. 远端状态与限制

- 修复分支已非强制推送为 `phase2/pr40-windows-fix`；创建 PR #47 时 head 为 `45317c2a3df3c787dd8bea60437dcb8c21ca5f3a`，功能代码提交固定为 `3cd545f3d1ed66ca68ca449179a16b098cdc132f`。
- 已创建堆叠 Draft PR #47，base 为 PR #40 分支 `agent-a/ai-core-night-20261019`，只审查本轮增量。
- PR #40 本身未被改写，仍为 Draft/open/conflicting。
- 基线分支 `692b7f5` 不包含 main 上的 `.github/workflows/docker-acceptance.yml`，因此 PR #47 没有对应 Docker CI；本地测试结果按 tree/commit 单独记录。
- Windows ACL 测试验证当前 Windows 11 环境；其他 Windows ACL/组策略环境仍需在目标部署环境复验。
- 未合并、未修改 main、未部署、未调用真实 DeepSeek，未消耗共享预算。
