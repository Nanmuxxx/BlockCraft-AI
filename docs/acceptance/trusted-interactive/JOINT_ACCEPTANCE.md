# PR #38 最终整改 / #37 联合验收

基线：origin/main `eb8b35c041fd158c9050899ed9d2804c9aaea174`。在原独立分支合并 #37，保留 `2c057094cca3ec1a848e306e7689b07e156945f2` 和 `0d5291a42207be841f44ab97390e5b876c0e213f`，无文本冲突，无强推。合并提交 `d340fd67593c45eee8546b58c89183a330feb262`。HTTPS CLI 缺少凭据，使用 GitHub Git Data API 发布相同 tree 的双 parent 合并提交；Git 对象 SHA 校验后与本地对齐。未重写原两个提交。

## 本轮变更

- Inspector 的 pomodoro 详情显示“无需数据绑定”，不新增编辑器；保留真正 CRUD 绑定异常警告。
- 新增两项 React 静态渲染测试：合法 timer 无误报/无 CRUD 编辑器；合法、缺失及重复 CRUD 绑定行为。浏览器两视口打开详情断言同样文案。
- 自动合并产生 Mochi browser 同名插件重复 import，删除重复行，保留 #37 的原导入。这是测试 harness 修复，无产品策略变化。
- INTEGRATION.md 更新 #37 最小入口 Diff、来源区分、双重 beforeContextChange 门禁及失败保留语义；仅交接方案。
- 三处共享 UI 文件相对最新 main 零 Diff。pending patch SHA256 `e73919544257f048cbf644d23a1437e89e96de007702aff3f811a8dbe45af3ff` 未变化、未应用、未提交；旧 AiCreate 工作区 Diff 保存在命名 stash 与 /tmp/blockcraft-pr38-final-backup。

## 单元 / 服务端 / 构建

当前共 **666/666**，0 fail / 0 skipped；生产构建包含 TypeScript `tsc -b`。精确命令与计数见 `joint/unit-build-results.json`，每条命令原始日志同目录。

| 分类 | 项数 | 命令 |
| --- | ---: | --- |
| AppSpec / Runtime / CRUD / Canvas / Mochi 基础 | 192 | `npm test` |
| 原服务端 | 23 | `npm --prefix server test` |
| legacy 生成 | 24 | `npm run test:generation` |
| Mochi Host | 55 | `npm run test:mochi-host` |
| Mochi Conversation | 40 | `node --test tests/mochi-ai/*.test.mjs` |
| CustomBlock / B/C / Workshop / Artifact Installer / #37 UI / #31 ZIP | 315 | 见下方 compatibility 命令 |
| trusted v2 / owner CAS / 离线服务端与客户端 / ZIP / Inspector | 17 | `npm run test:trusted-interactive` |

```sh
node --test tests/custom-block/*.test.cjs tests/custom-block-bc/*.test.cjs tests/custom-block-workshop/*.test.cjs tests/generated-artifact/*.test.cjs tests/generated-artifact-ui/*.test.cjs tests/project-zip-export/*.test.mjs tests/workshop-export/*.test.*
npm run build
```

历史 651/655 项报告保持为旧轮次，不与本轮 666 相加。#37 新增 9 项与 Inspector 新增 2 项解释 655→666。

## Chromium 证据与复现

使用已有 Chromium 151.0.7922.34，无下载浏览器。先运行：

```sh
npm --prefix server run build
node tools/project-zip-export/prepare.mjs
node server/custom-block/build-protocol.mjs
export NODE_PATH=/Users/nanmuxun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules
npm run test:trusted-interactive:browser
npm run test:trusted-interactive:reliability
node tests/generated-artifact-ui/browser.cjs
node tests/generated-artifact-ui/production-browser.cjs
npm run test:generation:browser
npm run test:mochi:browser
npm run test:workshop-export:browser
CUSTOM_WORKSHOP_QA_PORT=5298 node tests/custom-block-workshop/browser.cjs
node tests/custom-block-bc/browser.check.cjs
```

以上 9 套最终通过；命令、初次失败、最终日志索引见 `joint/browser-results.json`。单元数不包含浏览器断言数，避免重复计数。

- trusted HTTP+Fixture：1440×1000、390×844，8 次离线上游 Fixture，0 paid。配置完整验证、B 详情无需绑定、C 开始/暂停/继续/重置/完成、B/C 切换保留 anchor、失败保留 owner、v2 ZIP 整包拒绝。`browser-results.json` 及 desktop/mobile B/C 截图为本轮重跑。桌面 B 截图已人工视觉检查。
- reliability：1440/390，原生 Chromium hidden→visible 真实标签页；100ms 回调人为节流到 2000ms；双击、快速切换、恢复、完成显示仅转换一次、完成时 owner 0 写入、旧数据/其他积木保留、伪造 runnable 的 TSX 仍 unavailable。恢复显示误差 466/456ms，属于秒显示舍入及浏览器重绘时机，非系统级精度保证。详见 `reliability-browser-results.json`。
- #37：1366/390 两套各两视口，实际 /ai-create；production-browser 不注入 QA，browser 脚本仅延迟现有 install 以观察竞态。预览/取消零写入、确认双击一次安装、确认期间 B/C/首页/重新生成同步门禁、在途生成完成后门禁、旧记录/实例/state/顺序保留、Viewer unavailable/无 iframe。报告 `joint/generated-ui/report.json`、`joint/generated-production/report.json`。报告中旧 baseline 为 #37 harness 历史硬编码；本轮受测内容以 `joint/source-sha256.json` 为准。
- Mochi：1366/390，两视口、12 场景，Host/Conversation/legacy Demo，errors=0。详见 `joint/mochi/report.json`。
- #31：v1 原生 ZIP 下载/内容/协议校验，4 个视口用例，errors=0；v2 同时有纯导出及浏览器整包拒绝。详见 `joint/zip/browser-report.json`。
- legacy 生成、Workshop、独立 B/C 最终日志均通过；不运行下载 ZIP 或模型 TSX。

所有模型响应均本地固定/拦截；可信服务端 fetch 注入 Fixture，外部浏览器请求被限制。0 真实 DeepSeek 付费调用。录屏、trace 和完整附加截图保留在本机 joint 子目录；PR 仅提交日志、JSON、选定截图，避免将大型录屏打包进源码。

初次失败已保留：trusted 新断言用 getByLabel 命中两个“积木属性”，改为精确 complementary role 后通过；Mochi 自动合并重复 import 已修复重跑；独立 B/C 初次命令误写 browser.cjs（不存在），实际 browser.check.cjs 通过。没有把失败计为通过。

## 边界与结论

协议区分 AppSpec v2/pomodoro/protocolVersion=1 与 CustomBlock Artifact 源码，仍由单一 CustomProjectV2 owner/CAS 管理；本轮不改变协议、计时器算法、付费权限或 TSX 拒绝策略。共享模型与运行时全部影响继续见 CHANGED_FILES.md。

**GO：可信番茄钟离线内核可申请 Tech Lead 主线合入批准。** 尚未合并、部署。**NO-GO：正式自然语言实时交互生成上线/付费演示**。正式入口仅文档方案，生产会话/ACL/持久预算适配器未提供，v2 ZIP 尚不支持且明确整包拒绝。无音频/Notification/service worker/OS 提醒；完成是派生 UI 状态，不是持久 exactly-once 业务事件。未验收系统休眠、长时强节流、renderer freeze、实体手机或系统时钟修改。没有答题器，不扩大范围。
