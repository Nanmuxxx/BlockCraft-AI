# PR #40 Windows 修复与 main 合并候选

2026-10-19

## 版本

- 实时 `main`：`b56a26a9803718d806bac3ddbd7fbe19e0c495c6`
- PR #40 修复 head：`3cd545f3d1ed66ca68ca449179a16b098cdc132f`
- 候选分支：`phase2/pr40-main-merge`
- 候选 head：`6ee5c2314279c2799ae6b4773af9e1d41b8d03b7`
- 候选 tree：`2f1ec405d3398a01bf9a8d476a7ec57bd412d695`
- 父提交：`3cd545f...`、`b56a26a...`

候选是在独立工作树中把实时 main 合并到完整 PR #40 修复 head 得到的。没有修改或强制更新 PR #40/#47。

## 冲突处理

唯一冲突为 `server/index.mjs`。人工核对后采用此前已审查的 main+PR #40 组合内容：

- 保留 main 的静态文件服务、路径约束、MIME/SPA、`PUBLIC_ORIGIN` 和生产监听。
- 保留 PR #40 的可中止上游读取、严格 UTF-8、completion 包络校验、迟到响应体释放。
- 保留交互 admission 的 close listener、AbortSignal 和 finally 清理。
- API key 在 `admitInteractive` 前检查。

没有使用整文件 ours/theirs 策略消除共享入口冲突；候选基于完整 PR #40 树，因此 `server/ai-abort.mjs` 等依赖也随分支保留。

## 测试

环境：Windows 11 `10.0.26300`、Node `24.19.0`、npm `11.17.0`。所有命令退出码为 0。

| 命令 | 结果 |
| --- | --- |
| `npm run test:generation` | 37/37 |
| `npm run test:trusted-interactive` | 32/32 |
| `node --test --test-timeout=2000 --test-force-exit server/server.test.mjs` | 37/37 |
| Artifact/UI/reinstall/authorization focus | 53/53 |
| `node --test tests/custom-block-generation/*.test.*` | 100/100 |
| `npm test` | 194/194 |
| `npm run build` | pass |
| `npm run test:mochi-host` | 57/57 |
| `npm run test:workshop-export` | 9/9 |
| `npm run test:trusted-pomodoro-ui` | 2/2 |

## 远端与限制

- 候选分支已 fast-forward/new-branch push 到 `origin/phase2/pr40-main-merge`。
- 未创建新 PR，也未修改 PR #40/#47，因此候选没有 GitHub CI。
- PR #40 原 Draft 仍与 main 冲突；本候选只提供可审查的合并方案。
- Windows ACL 仅在本机 Windows 11 环境验证。
- 没有合并、部署、真实模型调用或预算消耗。
