# 可信番茄钟正式入口集成（离线演示）

基线：`1a45d748027dea8e8e00dba336ed03b7d117284b`（PR #38 已合并）。新独立工作树 `BlockCraft-AI-trusted-pomodoro-ui`，新分支 `feature/trusted-pomodoro-ui-20261019`。

## 结果与边界

正式 `/ai-create` 已提供显式“可信番茄钟（离线演示）”选项：选择不生成、不替换项目；点击“加载离线番茄钟”才解析本地固定 JSON、执行 #38 完整 AppSpec/ProjectState 严格验证并创建既有 Runtime，进入 B 模式。B 显示名称、1500 秒及无需数据绑定，C 可开始、暂停、继续和重置。同一 Runtime 传给原 Workshop，timer 写入仍走唯一 owner/CAS。

入口及成功结果持续显示 **“离线固定 Fixture，非真实 DeepSeek 调用”**。配置固定为 25 分钟；没有根据自然语言生成内容，不把预置组件称为模型自由编写代码。固定配置 loader 不 fetch、不依赖 AI 服务、不经过源码 Artifact Installer，也不导入模型源码。未开放或启用任何可信 v2 付费路径。

默认仍为原有 v1 入口；它原有的显式提交 DeepSeek 行为保留。本轮所有 v1 浏览器请求均本地拦截返回固定结果，没有真实调用。v1 响应不提供来源证明，结果显示“原有 AppSpec v1 生成入口 · 响应未提供可验证的模型来源”，不把 Fixture 冒充实时上游。

保留 #37 双重同步 `beforeContextChange()`：请求开始前，以及 await 成功后、Runtime 创建前。模式切换也检查同一门禁；confirming 时不切模式、不加载 Fixture、不替换项目。新增取消按钮，abort 并清除 active 身份；被取消请求稍后返回时不能覆盖后续项目。网络/Schema 失败、取消和竞态拒绝只更新反馈，保留旧 Runtime、owner、业务记录、自定义积木和当前应用来源。成功创建新项目按提示替换当前项目；取消/失败后的历史反馈保持到下一次提交。

未修改 `AppSpecWorkshop.tsx`、`CustomBlockImport.tsx`、模型协议、Runtime、owner/CAS、服务端、ZIP 或 TSX Viewer 策略。v2 ZIP 继续整包拒绝；v1 ZIP 回归通过。没有新增运行器、第二个 owner、付费接口、答题器或计时器参数编辑系统。

历史 `AiCreate.pending.patch` 仍位于旧工作树、未应用、未提交到新分支，SHA256：`e73919544257f048cbf644d23a1437e89e96de007702aff3f811a8dbe45af3ff`。原比赛冻结录屏/历史验收文件零 Diff；本次证据全部放入新目录，不替换冻结版本。

## 实际代码 Diff

- `src/components/ai-create/AiCreate.tsx`：显式模式、离线分支、来源元数据、取消操作及复用 #37 门禁。
- `src/components/ai-create/trustedPomodoroFixture.ts`：本地固定 v2 JSON、复用完整验证与初始化、AbortSignal 检查，不执行网络。
- `src/components/ai-create/ai-create.css`：模式选择及来源提示的少量样式，390px 无横向溢出。
- `package.json`：新增可复现单元/浏览器验收命令。
- `tests/trusted-pomodoro-ui/{fixture.test,browser,races.browser}.cjs`：离线 loader 与正式页面正常/竞态测试。
- 本目录：结果、源码哈希、日志和选定截图。录屏及 trace 本地保留，不将大型文件提交进源码。

## 单元 / 服务端 / 构建

**668/668 通过，0 fail / 0 skipped。** 既有 666 加两项新 loader 测试；不把浏览器断言混入单元计数。精确命令、退出码与日志见 `unit-build-results.json`、`logs/`。

| 分类 | 项数 | 命令 |
| --- | ---: | --- |
| core CRUD/Runtime/Canvas/Mochi | 192 | `npm test` |
| 原服务端 | 23 | `npm --prefix server test` |
| v1 generation | 24 | `npm run test:generation` |
| Mochi Host | 55 | `npm run test:mochi-host` |
| Mochi Conversation | 40 | `node --test tests/mochi-ai/*.test.mjs` |
| CustomBlock/B/C/Workshop/Installer/#37 UI/#31 ZIP | 315 | 下方命令 |
| #38 v2/client/server/CAS/ZIP/Inspector | 17 | `npm run test:trusted-interactive` |
| 新入口 loader | 2 | `npm run test:trusted-pomodoro-ui` |

```sh
node --test tests/custom-block/*.test.cjs tests/custom-block-bc/*.test.cjs tests/custom-block-workshop/*.test.cjs tests/generated-artifact/*.test.cjs tests/generated-artifact-ui/*.test.cjs tests/project-zip-export/*.test.mjs tests/workshop-export/*.test.*
npm run build
```

`npm run build` 包含 `tsc -b` 与 Vite 生产构建，两者通过。本轮浏览器运行实际应用源代码的正式路由；没有宣称已验证线上部署。

## Chromium 浏览器

Chromium `151.0.7922.34`，五个脚本最终全部通过：新正式入口、离线配置竞态、原 #37 UI、原 #37 无注入页面、#31 ZIP。总计 12 个脚本视口用例（2+2+2+2+4），不与单元数相加。390px 为 Chromium 触摸/手机视口模拟，非实体手机。所有脚本请求限制为 loopback；模型响应本地固定/拦截，**0 次真实付费 DeepSeek**。

1. `browser/report.json`：1440×1000、390×844，正式 `/ai-create`，无 transform/QA hook/替代测试页。显式选择与点击、完整 Fixture、持续来源、B 参数、C 操作、B/C anchor 保留、v2 ZIP 零下载且明确拒绝、旧 v1 成功及实际填写记录。非法响应/上游失败/取消/取消后的迟到响应均保留记录和来源；选模式本身不替换旧项目。整个可信流程生成 API 请求为 0，无 iframe，无横向溢出。截图：`browser/entry-*.png`、`browser/b-*.png`、`browser/c-running-*.png`。
2. `races/report.json`：1440/390，同一正式路由，仅测试 Vite 插件延迟现有 Fixture/安装 Promise、注入坏 JSON 并暴露原 Runtime 以比较身份。confirming 时第一道门禁使 Fixture 加载数为 0；在途 Fixture 完成时第二道门禁拒绝，Runtime 创建总数仍为 1。确认后原记录和两个制品均保留；坏 Fixture 完整 Schema 失败不替换。取消后启动新请求，仅新请求创建 Runtime；旧 Promise 稍后完成不覆盖它。成功的可信项目没有 custom instances；B/C 不新增 revision，timers 与唯一 owner base 同步。截图：`races/confirm-gate-*.png`、`races/invalid-fixture-*.png`。
3. `generated-ui/report.json`：原 #37 完整回归，1366/390，确认双击只安装一次、B/C/首页/重新生成/卸载/beforeunload 门禁、在途 v1 生成完成门禁、旧数据和实例 state/layout/order 保留、C Viewer unavailable/无 iframe。
4. `generated-production/report.json`：原 #37 无 transform/QA bridge 的正式路由，1366/390，预览/取消无写入、确认一次安装、参数可查、TSX unavailable。
5. `zip/browser-report.json`：原 #31 4 个用例，包含正式 `/ai-create` 的 v1 ZIP 下载和内容校验；v2 拒绝由新入口脚本验证。

旧 #37 harness 的 report.baseline 字段仍为其历史常量，不代表本轮基线；本轮准确基线及受测文件哈希以本报告和 `source-sha256.json` 为准。报告里的本地视频路径指向保留的本机产物；PR 提交 JSON、日志和选定截图。

桌面/手机入口及运行截图已人工查看，离线来源文字清楚、控件可见，无横向溢出。初次验收暴露 label 包住 select 导致精确标签定位歧义，已改为独立 label；取消后切换模式时清除反馈会使现有 details 折叠，已保留最近一次反馈直到下一次提交。最终结果均在修复后重新跑完，不将初次失败计为通过。

## 复现

使用现有依赖和 bundled Playwright/Chromium，无下载：

```sh
npm --prefix server run build
node tools/project-zip-export/prepare.mjs
node server/custom-block/build-protocol.mjs
export NODE_PATH=/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules
npm run test:trusted-pomodoro-ui
npm run test:trusted-pomodoro-ui:browser
node tests/generated-artifact-ui/browser.cjs
node tests/generated-artifact-ui/production-browser.cjs
npm run test:workshop-export:browser
```

新入口脚本使用 5210、竞态 5211，原 #37 使用 5199/5299。可通过 TRUSTED_UI_EVIDENCE/TRUSTED_UI_RACE_EVIDENCE、GENERATED_UI_EVIDENCE/GENERATED_UI_PRODUCTION_EVIDENCE、EXPORT_QA_OUTPUT 指定证据目录。

人工演示：启动 `npm run dev -- --host 127.0.0.1 --port 5210 --strictPort`，打开 `/ai-create`，显式选择“可信番茄钟（离线演示）”，点击加载。此流程无需后端 AI 服务。不要选择并提交 v1 真实生成来复现离线流程。

## 交付结论

**GO：离线可信番茄钟正式入口已满足本轮验收，可提交 Draft PR 供 Tech Lead 审核。** 未合并、未部署。正式自然语言可信配置生成、真实付费 DeepSeek、公开线上部署及任意 TSX 执行仍未获放行。v2 ZIP 明确不支持；项目仅当前页面存续，刷新后清空；没有系统级提醒、音频或通知，不新增 #38 未验收的浏览器能力承诺。比赛冻结录屏继续使用原版本。
