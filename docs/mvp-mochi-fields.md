# Mochi 字段方案 MVP

在 B 模式选中表单后，可以要求 Mochi 新增可选字段、隐藏字段或恢复已有字段。服务端调用真实 DeepSeek 生成命令，宿主校验后展示计划预览；点击确认才提交项目修改。隐藏只改变表单展示列表，保留字段定义和已有记录。必填字段不能隐藏。

## 本地运行

```sh
npm ci
npm --prefix server ci
npm run dev:mvp-fields
```

打开输出的 `/ai-create` 地址。启动器只绑定 `127.0.0.1`，通过进程内代理附加授权，不向浏览器暴露密钥。密钥来自环境变量 `DEEPSEEK_API_KEY`，或主仓库 `server/.env`。不要提交密钥或 `.env`。

默认服务保持关闭；部署组合必须显式提供授权解析器和受控付费 transport。普通服务启动不会自动开放付费字段 API。

## 本次真实调用预算

用户授权上限为人民币 5 元，启动器进一步限制为最多预留 1 元、6 次调用、并发 1、无自动重试。所有 worktree 共用 Git common directory 下的私有持久化账本；每次请求先落盘预留，结果不确定即停止后续调用。不能重置或复制账本获取额外额度。

价格来源：[DeepSeek 官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。本次核价有效期到 2026-10-22 00:00（UTC+8）；之后需重新核价和授权运行配置。报告的费用是按照 usage 和缓存未命中峰值价格计算的保守估算，不是供应商账单。

## 验证

```sh
npm run test:field-plans
npm --prefix server test
npm test
npm run build
NODE_PATH=/path/to/playwright/node_modules npm run test:field-plans:browser
```

真实模型验收使用正式 Workshop、HTTP provider、计划宿主和 runtime。先运行 `npm --prefix server run build`，再启动 `node tools/mvp-fields/serve.mjs --live --fixture`，最后设置其输出的 `MVP_ORIGIN` 运行 `node tests/field-plans/browser.cjs --live`。验收入口会真实生成社团报名应用，并执行新增、隐藏、恢复三次字段方案。浏览器报告、预览截图、C 模式截图和视频写入 `.cache/field-plans/live/`。

真实验收中还会拖动表单并核对 C 模式顺序，因此完整演示需同时集成 B/C 顺序持久化 PR。字段 PR 的离线桌面和窄屏浏览器测试可独立运行。
